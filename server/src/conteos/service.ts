import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { reconciliarConteo } from '../ledger/service.js';

const EDITABLES = ['borrador', 'en_captura', 'reabierto'] as const;
type EstadoEditable = (typeof EDITABLES)[number];
const esEditable = (estado: string): estado is EstadoEditable => (EDITABLES as readonly string[]).includes(estado);

// ── Programación de inventario (fecha/día en la zona horaria del negocio) ────
/** Fecha 'YYYY-MM-DD' del instante dado en la zona horaria indicada. */
function fechaISOEnTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
/** Día de la semana (0=Dom … 6=Sáb) del instante dado en la zona horaria indicada. */
function diaSemanaEnTz(d: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}
/** Próxima fecha (dentro de 14 días) cuyo día de semana esté en `dias`, o null. */
function proximaFechaProgramada(dias: number[], tz: string): string | null {
  if (!dias.length) return null;
  for (let i = 1; i <= 14; i++) {
    const d = new Date(Date.now() + i * 86400000);
    if (dias.includes(diaSemanaEnTz(d, tz))) return fechaISOEnTz(d, tz);
  }
  return null;
}
/** Convierte 'YYYY-MM-DD' a Date (medianoche UTC) para columnas @db.Date. */
const aFecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function negocioProg(negocioId: bigint) {
  const n = await prisma.negocios.findUnique({ where: { id: negocioId }, select: { zona_horaria: true, inventario_dias: true } });
  return { tz: n?.zona_horaria ?? 'America/Chicago', dias: n?.inventario_dias ?? [] };
}

async function tipoUbicacion(negocioId: bigint, ubicacionId: bigint) {
  const ubic = await prisma.ubicaciones.findFirst({
    where: { id: ubicacionId, negocio_id: negocioId },
    select: { tipo: true },
  });
  if (!ubic) throw new HttpError(404, 'Ubicación no encontrada');
  return ubic.tipo;
}

/** Lista de conteos de una ubicación, con un pequeño resumen de avance (ordenada por fecha). */
export async function listarConteos(negocioId: bigint, ubicacionId: bigint) {
  const conteos = await prisma.conteos.findMany({
    where: { negocio_id: negocioId, ubicacion_id: ubicacionId },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    include: { _count: { select: { lineas: true } }, lineas: { select: { contado: true } } },
  });
  return conteos.map((c) => ({
    id: Number(c.id),
    estado: c.estado,
    fecha: c.fecha ? c.fecha.toISOString().slice(0, 10) : null,
    creado_at: c.creado_at.toISOString(),
    cerrado_at: c.cerrado_at?.toISOString() ?? null,
    total_lineas: c._count.lineas,
    contadas: c.lineas.filter((l) => l.contado).length,
  }));
}

/**
 * Estado de la sesión de inventario de HOY para una ubicación: si hoy es día programado,
 * la fecha de hoy, el próximo día programado y el conteo de hoy (si existe) con su avance.
 */
export async function sesionDeHoy(negocioId: bigint, ubicacionId: bigint) {
  const { tz, dias } = await negocioProg(negocioId);
  const ahora = new Date();
  const hoy = fechaISOEnTz(ahora, tz);
  const programado = dias.includes(diaSemanaEnTz(ahora, tz));

  const conteo = await prisma.conteos.findFirst({
    where: { negocio_id: negocioId, ubicacion_id: ubicacionId, fecha: aFecha(hoy) },
    orderBy: { id: 'desc' },
    include: { _count: { select: { lineas: true } }, lineas: { select: { contado: true } } },
  });

  return {
    fecha: hoy,
    programado,
    dias,
    proximo: proximaFechaProgramada(dias, tz),
    conteo: conteo
      ? {
          id: Number(conteo.id),
          estado: conteo.estado,
          total_lineas: conteo._count.lineas,
          contadas: conteo.lineas.filter((l) => l.contado).length,
        }
      : null,
  };
}

/**
 * Abre (o continúa) el inventario de HOY para la ubicación: una sesión por ubicación por día.
 * Si ya existe el de hoy lo devuelve; si no, lo crea prellenado con una línea por producto
 * habilitado. Reemplaza la creación manual: el "espacio" del día se habilita solo.
 */
export async function abrirConteoDeHoy(negocioId: bigint, ubicacionId: bigint, usuarioId: bigint) {
  const { tz } = await negocioProg(negocioId);
  const hoy = aFecha(fechaISOEnTz(new Date(), tz));

  const existente = await prisma.conteos.findFirst({
    where: { negocio_id: negocioId, ubicacion_id: ubicacionId, fecha: hoy },
    orderBy: { id: 'desc' },
  });
  if (existente) return { id: Number(existente.id), reusado: true };

  const habilitados = await prisma.producto_ubicacion.findMany({
    where: { ubicacion_id: ubicacionId, habilitado: true, products: { activo: true } },
    include: { products: { select: { id: true, unidad_distribucion_id: true } } },
  });
  if (habilitados.length === 0) {
    throw new HttpError(400, 'Esta ubicación no tiene productos habilitados. Configúralos en el catálogo por ubicación.');
  }

  const conteo = await prisma.$transaction(async (tx) => {
    const c = await tx.conteos.create({
      data: { negocio_id: negocioId, ubicacion_id: ubicacionId, estado: 'en_captura', creado_por: usuarioId, fecha: hoy },
    });
    await tx.conteo_lineas.createMany({
      data: habilitados.map((h) => ({
        conteo_id: c.id,
        product_id: h.products.id,
        unidad_id: h.products.unidad_distribucion_id,
        qty: 0,
        factor: 1,
        contado: false,
      })),
    });
    return c;
  });
  return { id: Number(conteo.id), reusado: false };
}

/** Detalle de un conteo con sus líneas (info de producto y categoría). */
export async function detalleConteo(negocioId: bigint, conteoId: bigint) {
  const conteo = await prisma.conteos.findFirst({
    where: { id: conteoId, negocio_id: negocioId },
    include: { ubicaciones: { select: { id: true, nombre: true, tipo: true } } },
  });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');

  const lineas = await prisma.conteo_lineas.findMany({
    where: { conteo_id: conteoId },
    include: { products: { include: { categorias: true, unidad_distribucion: true } } },
  });
  const esBodega = conteo.ubicaciones.tipo === 'bodega';
  const params = esBodega
    ? await prisma.producto_ubicacion.findMany({
        where: { ubicacion_id: conteo.ubicacion_id },
        select: { product_id: true, stock_objetivo: true },
      })
    : [];
  const objetivoDe = new Map(params.map((p) => [p.product_id.toString(), num0(p.stock_objetivo)]));

  return {
    id: Number(conteo.id),
    estado: conteo.estado,
    editable: esEditable(conteo.estado),
    fecha: conteo.fecha ? conteo.fecha.toISOString().slice(0, 10) : null,
    ubicacion: { id: Number(conteo.ubicaciones.id), nombre: conteo.ubicaciones.nombre, tipo: conteo.ubicaciones.tipo },
    creado_at: conteo.creado_at.toISOString(),
    cerrado_at: conteo.cerrado_at?.toISOString() ?? null,
    lineas: lineas
      .map((l) => ({
        product_id: Number(l.product_id),
        nombre: l.products.nombre,
        sku: l.products.sku,
        categoria: l.products.categorias?.nombre ?? null,
        unidad: l.products.unidad_distribucion.nombre,
        qty: num0(l.qty),
        contado: l.contado,
        atipico: l.atipico,
        comentario: l.comentario,
        stock_objetivo: objetivoDe.get(l.product_id.toString()) ?? 0,
      }))
      .sort((a, b) => (a.categoria ?? '').localeCompare(b.categoria ?? '', 'es') || a.nombre.localeCompare(b.nombre, 'es')),
  };
}

export interface LineaInput {
  product_id: number;
  qty?: number;
  contado?: boolean;
  comentario?: string | null;
}

/** Guarda avance del conteo/pedido (solo si es editable). En bodega marca atípicos contra objetivo. */
export async function guardarLineas(negocioId: bigint, conteoId: bigint, lineas: LineaInput[]) {
  const conteo = await prisma.conteos.findFirst({ where: { id: conteoId, negocio_id: negocioId } });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');
  if (!esEditable(conteo.estado)) throw new HttpError(409, 'El conteo ya está cerrado; pide reabrirlo para editarlo.');

  const esBodega = (await tipoUbicacion(negocioId, conteo.ubicacion_id)) === 'bodega';
  const objetivos = esBodega
    ? await prisma.producto_ubicacion.findMany({
        where: { ubicacion_id: conteo.ubicacion_id },
        select: { product_id: true, stock_objetivo: true },
      })
    : [];
  const objetivoDe = new Map(objetivos.map((p) => [p.product_id.toString(), num0(p.stock_objetivo)]));

  await prisma.$transaction(
    lineas.map((l) => {
      const objetivo = objetivoDe.get(l.product_id.toString()) ?? 0;
      const qty = l.qty ?? 0;
      const atipico = esBodega && objetivo > 0 && qty > objetivo * 4;
      return prisma.conteo_lineas.update({
        where: { conteo_id_product_id: { conteo_id: conteoId, product_id: BigInt(l.product_id) } },
        data: {
          qty: l.qty === undefined ? undefined : qty,
          contado: l.contado,
          comentario: l.comentario === undefined ? undefined : l.comentario,
          atipico: l.qty === undefined ? undefined : atipico,
        },
      });
    }),
  );
  if (conteo.estado === 'borrador') {
    await prisma.conteos.update({ where: { id: conteoId }, data: { estado: 'en_captura' } });
  }
  return { ok: true, guardadas: lineas.length };
}

/** Cierra el conteo/pedido. Solo bodega reconcilia existencias; sucursal registra un pedido. */
export async function cerrarConteo(negocioId: bigint, conteoId: bigint, usuarioId: bigint) {
  const conteo = await prisma.conteos.findFirst({ where: { id: conteoId, negocio_id: negocioId } });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');
  if (!esEditable(conteo.estado)) throw new HttpError(409, 'El conteo ya está cerrado');
  await prisma.conteos.update({
    where: { id: conteoId },
    data: { estado: 'cerrado', cerrado_por: usuarioId, cerrado_at: new Date() },
  });
  if ((await tipoUbicacion(negocioId, conteo.ubicacion_id)) === 'bodega') {
    // Un conteo cerrado de bodega es la verdad física: sincroniza sus existencias.
    await reconciliarConteo(negocioId, conteoId, usuarioId, conteo.ubicacion_id);
  }
  return { ok: true };
}

/** Reabre un conteo cerrado (solo admin). Queda en estado "reabierto" (editable). */
export async function reabrirConteo(negocioId: bigint, conteoId: bigint) {
  const conteo = await prisma.conteos.findFirst({ where: { id: conteoId, negocio_id: negocioId } });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');
  if (conteo.estado !== 'cerrado') throw new HttpError(409, 'Solo se puede reabrir un conteo cerrado');
  await prisma.conteos.update({ where: { id: conteoId }, data: { estado: 'reabierto', cerrado_por: null, cerrado_at: null } });
  return { ok: true };
}

/**
 * Elimina un inventario (conteo). Si ya estaba cerrado (reconciliado), REVIERTE su efecto en
 * las existencias para dejar el stock como estaba antes, y borra sus movimientos de ajuste.
 * Si nunca se cerró, solo borra la sesión. Las líneas caen por cascada. Todo atómico.
 */
export async function eliminarConteo(negocioId: bigint, conteoId: bigint) {
  const conteo = await prisma.conteos.findFirst({ where: { id: conteoId, negocio_id: negocioId } });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');

  const movs = await prisma.movimientos_inventario.findMany({
    where: { negocio_id: negocioId, documento_tipo: 'conteo', documento_id: conteoId },
    select: { product_id: true, tipo: true, cantidad: true },
  });
  const ajustesLote = await prisma.conteo_ajustes_lote.findMany({ where: { conteo_id: conteoId } });
  // Neto firmado que el conteo aplicó a existencias por producto (+ sumó, − restó).
  const neto = new Map<string, number>();
  for (const m of movs) {
    const signo = m.tipo === 'ajuste_negativo' ? -1 : 1;
    const k = m.product_id.toString();
    neto.set(k, (neto.get(k) ?? 0) + signo * num0(m.cantidad));
  }

  await prisma.$transaction(async (tx) => {
    for (const [pid, d] of neto) {
      if (d === 0) continue;
      const existencia = await tx.existencias.findUnique({
        where: { ubicacion_id_product_id: { ubicacion_id: conteo.ubicacion_id, product_id: BigInt(pid) } },
      });
      const siguiente = num0(existencia?.cantidad_disponible) - d;
      await tx.existencias.updateMany({
        where: { ubicacion_id: conteo.ubicacion_id, product_id: BigInt(pid) },
        // Al reabrir una semana puede quedar un déficit provisional hasta recapturar la
        // producción. Es preferible mostrarlo en auditoría a inventar existencias.
        data: { cantidad_disponible: siguiente },
      });
    }
    for (const ajuste of ajustesLote) {
      await tx.lotes_materia_prima.update({
        where: { id: ajuste.lote_id },
        data: {
          cajas_disponibles: { increment: ajuste.cajas },
          peso_disponible_lb: { increment: ajuste.peso_lb },
          costo_disponible: { increment: ajuste.costo },
        },
      });
    }
    await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocioId, documento_tipo: 'conteo', documento_id: conteoId } });
    await tx.conteos.delete({ where: { id: conteoId } });
  }, { isolationLevel: 'Serializable' });
  return { ok: true };
}
