import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { reconciliarConteo } from '../ledger/service.js';

const EDITABLES = ['borrador', 'en_captura', 'reabierto'] as const;
type EstadoEditable = (typeof EDITABLES)[number];
const esEditable = (estado: string): estado is EstadoEditable => (EDITABLES as readonly string[]).includes(estado);

/** Lista de conteos de una ubicación, con un pequeño resumen de avance. */
export async function listarConteos(negocioId: bigint, ubicacionId: bigint) {
  const conteos = await prisma.conteos.findMany({
    where: { negocio_id: negocioId, ubicacion_id: ubicacionId },
    orderBy: { id: 'desc' },
    include: { _count: { select: { lineas: true } }, lineas: { select: { contado: true } } },
  });
  return conteos.map((c) => ({
    id: Number(c.id),
    estado: c.estado,
    creado_at: c.creado_at.toISOString(),
    cerrado_at: c.cerrado_at?.toISOString() ?? null,
    total_lineas: c._count.lineas,
    contadas: c.lineas.filter((l) => l.contado).length,
  }));
}

/**
 * Crea un conteo nuevo (estado en_captura) prellenado con una línea por cada producto
 * habilitado en la ubicación. Si ya hay un conteo editable abierto, lo devuelve en vez
 * de crear otro (un solo conteo abierto por ubicación).
 */
export async function crearConteo(negocioId: bigint, ubicacionId: bigint, usuarioId: bigint) {
  const abierto = await prisma.conteos.findFirst({
    where: { negocio_id: negocioId, ubicacion_id: ubicacionId, estado: { in: ['borrador', 'en_captura', 'reabierto'] } },
    orderBy: { id: 'desc' },
  });
  if (abierto) return { id: Number(abierto.id), reusado: true };

  const habilitados = await prisma.producto_ubicacion.findMany({
    where: { ubicacion_id: ubicacionId, habilitado: true, products: { activo: true } },
    include: { products: { select: { id: true, unidad_distribucion_id: true } } },
  });
  if (habilitados.length === 0) {
    throw new HttpError(400, 'Esta ubicación no tiene productos habilitados. Configúralos en Stock objetivo.');
  }

  const conteo = await prisma.$transaction(async (tx) => {
    const c = await tx.conteos.create({
      data: { negocio_id: negocioId, ubicacion_id: ubicacionId, estado: 'en_captura', creado_por: usuarioId },
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

/** Detalle de un conteo con sus líneas (info de producto, categoría, objetivo). */
export async function detalleConteo(negocioId: bigint, conteoId: bigint) {
  const conteo = await prisma.conteos.findFirst({
    where: { id: conteoId, negocio_id: negocioId },
    include: { ubicaciones: { select: { id: true, nombre: true, tipo: true } } },
  });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');

  const [lineas, params] = await Promise.all([
    prisma.conteo_lineas.findMany({
      where: { conteo_id: conteoId },
      include: { products: { include: { categorias: true, unidad_distribucion: true } } },
    }),
    prisma.producto_ubicacion.findMany({
      where: { ubicacion_id: conteo.ubicacion_id },
      select: { product_id: true, stock_objetivo: true },
    }),
  ]);
  const objetivoDe = new Map(params.map((p) => [p.product_id.toString(), num0(p.stock_objetivo)]));

  return {
    id: Number(conteo.id),
    estado: conteo.estado,
    editable: esEditable(conteo.estado),
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

/** Guarda avance del conteo (solo si es editable). Marca atípicos (qty > 4× objetivo). */
export async function guardarLineas(negocioId: bigint, conteoId: bigint, lineas: LineaInput[]) {
  const conteo = await prisma.conteos.findFirst({ where: { id: conteoId, negocio_id: negocioId } });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');
  if (!esEditable(conteo.estado)) throw new HttpError(409, 'El conteo ya está cerrado; pide reabrirlo para editarlo.');

  const objetivos = await prisma.producto_ubicacion.findMany({
    where: { ubicacion_id: conteo.ubicacion_id },
    select: { product_id: true, stock_objetivo: true },
  });
  const objetivoDe = new Map(objetivos.map((p) => [p.product_id.toString(), num0(p.stock_objetivo)]));

  await prisma.$transaction(
    lineas.map((l) => {
      const objetivo = objetivoDe.get(l.product_id.toString()) ?? 0;
      const qty = l.qty ?? 0;
      const atipico = objetivo > 0 && qty > objetivo * 4;
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

/** Cierra el conteo (fotografía inmutable). */
export async function cerrarConteo(negocioId: bigint, conteoId: bigint, usuarioId: bigint) {
  const conteo = await prisma.conteos.findFirst({ where: { id: conteoId, negocio_id: negocioId } });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');
  if (!esEditable(conteo.estado)) throw new HttpError(409, 'El conteo ya está cerrado');
  await prisma.conteos.update({
    where: { id: conteoId },
    data: { estado: 'cerrado', cerrado_por: usuarioId, cerrado_at: new Date() },
  });
  // Un conteo cerrado es la verdad física: sincroniza las existencias de la ubicación.
  await reconciliarConteo(negocioId, conteoId, usuarioId, conteo.ubicacion_id);
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
