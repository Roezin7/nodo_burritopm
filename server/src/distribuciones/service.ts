import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { sugerirEnvio, valor } from './logic.js';
import { aplicarMovimiento } from '../ledger/service.js';

/** Último conteo CERRADO de la ubicación: mapa product_id(string) → disponible, y su id. */
async function disponibleConteo(ubicacionId: bigint) {
  const conteo = await prisma.conteos.findFirst({
    where: { ubicacion_id: ubicacionId, estado: 'cerrado' },
    orderBy: { cerrado_at: 'desc' },
    include: { lineas: { select: { product_id: true, qty: true } } },
  });
  const map = new Map<string, number>();
  if (conteo) for (const l of conteo.lineas) map.set(l.product_id.toString(), num0(l.qty));
  return { map, conteoId: conteo?.id ?? null };
}

/**
 * Calcula y crea una distribución a partir de los últimos conteos cerrados de las
 * sucursales activas. La sugerencia surge del conteo + parámetros (la sucursal no pide).
 */
export async function crearDistribucion(negocioId: bigint, usuarioId: bigint, ubicacionIds?: number[]) {
  const sucursales = await prisma.ubicaciones.findMany({
    where: {
      negocio_id: negocioId,
      tipo: 'sucursal',
      activo: true,
      ...(ubicacionIds && ubicacionIds.length ? { id: { in: ubicacionIds.map((n) => BigInt(n)) } } : {}),
    },
  });
  if (sucursales.length === 0) throw new HttpError(400, 'No hay sucursales activas para distribuir');

  const sinConteo: string[] = [];
  const lineasData: {
    ubicacion_destino_id: bigint;
    product_id: bigint;
    conteo_id: bigint | null;
    inventario_disponible: number;
    stock_objetivo: number;
    stock_seguridad: number;
    cantidad_sugerida: number;
    costo_unitario: number | null;
    costo_total: number;
  }[] = [];

  for (const suc of sucursales) {
    const { map: disp, conteoId } = await disponibleConteo(suc.id);
    if (conteoId == null) {
      sinConteo.push(suc.nombre);
      continue;
    }
    const params = await prisma.producto_ubicacion.findMany({
      where: { ubicacion_id: suc.id, habilitado: true, products: { activo: true } },
      include: { products: { select: { id: true, ultimo_costo: true, costo_promedio: true } } },
    });
    for (const pu of params) {
      const disponible = disp.get(pu.product_id.toString()) ?? 0;
      const sugerida = sugerirEnvio({
        stock_objetivo: num0(pu.stock_objetivo),
        stock_seguridad: num0(pu.stock_seguridad),
        disponible,
        en_transito: 0,
        multiplo_distribucion: num0(pu.multiplo_distribucion) || 1,
        minimo_envio: num0(pu.minimo_envio),
      });
      if (sugerida <= 0) continue;
      const costo = num(pu.products.ultimo_costo) ?? num(pu.products.costo_promedio);
      lineasData.push({
        ubicacion_destino_id: suc.id,
        product_id: pu.product_id,
        conteo_id: conteoId,
        inventario_disponible: disponible,
        stock_objetivo: num0(pu.stock_objetivo),
        stock_seguridad: num0(pu.stock_seguridad),
        cantidad_sugerida: sugerida,
        costo_unitario: costo,
        costo_total: valor(sugerida, costo),
      });
    }
  }

  if (lineasData.length === 0) {
    throw new HttpError(
      400,
      sinConteo.length
        ? `No hay nada que distribuir. Sucursales sin conteo cerrado: ${sinConteo.join(', ')}.`
        : 'No hay nada que distribuir: todas las sucursales están en su nivel objetivo.',
    );
  }

  const dist = await prisma.$transaction(async (tx) => {
    const d = await tx.distribuciones.create({
      data: { negocio_id: negocioId, estado: 'calculada', creado_por: usuarioId },
    });
    await tx.distribucion_lineas.createMany({
      data: lineasData.map((l) => ({ distribucion_id: d.id, ...l })),
    });
    return d;
  });

  return { id: Number(dist.id), lineas: lineasData.length, sin_conteo: sinConteo };
}

export async function listarDistribuciones(negocioId: bigint) {
  const ds = await prisma.distribuciones.findMany({
    where: { negocio_id: negocioId },
    orderBy: { id: 'desc' },
    include: { _count: { select: { lineas: true } } },
  });
  return ds.map((d) => ({
    id: Number(d.id),
    estado: d.estado,
    creado_at: d.creado_at.toISOString(),
    aprobado_at: d.aprobado_at?.toISOString() ?? null,
    total_lineas: d._count.lineas,
  }));
}

async function cargarDistribucion(negocioId: bigint, id: bigint) {
  const dist = await prisma.distribuciones.findFirst({ where: { id, negocio_id: negocioId } });
  if (!dist) throw new HttpError(404, 'Distribución no encontrada');
  return dist;
}

/** Disponibilidad de la bodega central (último conteo cerrado de la bodega). */
async function disponibleBodega(negocioId: bigint): Promise<Map<string, number>> {
  const bodega = await prisma.ubicaciones.findFirst({ where: { negocio_id: negocioId, tipo: 'bodega', activo: true } });
  if (!bodega) return new Map();
  return (await disponibleConteo(bodega.id)).map;
}

/** Consolidado por producto o por sucursal, con disponibilidad de bodega y faltante. */
export async function consolidado(negocioId: bigint, id: bigint, vista: 'producto' | 'sucursal') {
  const dist = await cargarDistribucion(negocioId, id);
  const [lineas, bodega] = await Promise.all([
    prisma.distribucion_lineas.findMany({
      where: { distribucion_id: id },
      include: {
        products: { include: { unidad_distribucion: true, categorias: true } },
        ubicaciones: { select: { id: true, nombre: true } },
      },
    }),
    disponibleBodega(negocioId),
  ]);

  const aprob = (l: (typeof lineas)[number]) => num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida);

  if (vista === 'sucursal') {
    const m = new Map<string, { ubicacion: { id: number; nombre: string }; items: unknown[]; subtotal: number }>();
    for (const l of lineas) {
      const k = l.ubicacion_destino_id.toString();
      if (!m.has(k)) m.set(k, { ubicacion: { id: Number(l.ubicaciones.id), nombre: l.ubicaciones.nombre }, items: [], subtotal: 0 });
      const g = m.get(k)!;
      const cantidad = aprob(l);
      const v = valor(cantidad, num(l.costo_unitario));
      g.items.push({
        linea_id: Number(l.id),
        product_id: Number(l.product_id),
        nombre: l.products.nombre,
        unidad: l.products.unidad_distribucion.nombre,
        categoria: l.products.categorias?.nombre ?? null,
        disponible: num0(l.inventario_disponible),
        stock_objetivo: num0(l.stock_objetivo),
        cantidad_sugerida: num0(l.cantidad_sugerida),
        cantidad_aprobada: num(l.cantidad_aprobada),
        costo_unitario: num(l.costo_unitario),
        valor: v,
      });
      g.subtotal = Math.round((g.subtotal + v) * 100) / 100;
    }
    const grupos = [...m.values()].sort((a, b) => a.ubicacion.nombre.localeCompare(b.ubicacion.nombre, 'es'));
    return { estado: dist.estado, vista, grupos, total: redondear2(grupos.reduce((a, g) => a + g.subtotal, 0)) };
  }

  // vista === 'producto'
  const m = new Map<string, any>();
  for (const l of lineas) {
    const k = l.product_id.toString();
    if (!m.has(k)) {
      m.set(k, {
        product_id: Number(l.product_id),
        nombre: l.products.nombre,
        unidad: l.products.unidad_distribucion.nombre,
        categoria: l.products.categorias?.nombre ?? null,
        costo_unitario: num(l.costo_unitario),
        bodega_disponible: bodega.get(k) ?? 0,
        total_sugerida: 0,
        total_aprobada: 0,
        sucursales: [] as unknown[],
      });
    }
    const g = m.get(k);
    const cantidad = aprob(l);
    g.total_sugerida = redondear3(g.total_sugerida + num0(l.cantidad_sugerida));
    g.total_aprobada = redondear3(g.total_aprobada + cantidad);
    g.sucursales.push({
      ubicacion: l.ubicaciones.nombre,
      cantidad_sugerida: num0(l.cantidad_sugerida),
      cantidad_aprobada: num(l.cantidad_aprobada),
    });
  }
  const items = [...m.values()].map((g) => {
    const surtible = Math.min(g.total_aprobada, g.bodega_disponible);
    const faltante = redondear3(Math.max(0, g.total_aprobada - g.bodega_disponible));
    return {
      ...g,
      surtible: redondear3(surtible),
      faltante,
      valor: valor(g.total_aprobada, g.costo_unitario),
    };
  });
  items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return {
    estado: dist.estado,
    vista,
    items,
    total_valor: redondear2(items.reduce((a, i) => a + i.valor, 0)),
    total_faltante_valor: redondear2(items.reduce((a, i) => a + valor(i.faltante, i.costo_unitario), 0)),
  };
}

/** Ajusta cantidades aprobadas (admin). Pasa la distribución a "en_revision". */
export async function ajustarLineas(negocioId: bigint, id: bigint, ajustes: { linea_id: number; cantidad_aprobada: number }[]) {
  const dist = await cargarDistribucion(negocioId, id);
  if (!['calculada', 'en_revision'].includes(dist.estado)) {
    throw new HttpError(409, 'Solo se pueden ajustar distribuciones en cálculo o revisión');
  }
  const lineas = await prisma.distribucion_lineas.findMany({
    where: { id: { in: ajustes.map((a) => BigInt(a.linea_id)) }, distribucion_id: id },
  });
  const porId = new Map(lineas.map((l) => [l.id.toString(), l]));
  await prisma.$transaction(
    ajustes.map((a) => {
      const l = porId.get(a.linea_id.toString());
      const costoUnit = l ? num(l.costo_unitario) : null;
      return prisma.distribucion_lineas.update({
        where: { id: BigInt(a.linea_id) },
        data: { cantidad_aprobada: a.cantidad_aprobada, costo_total: valor(a.cantidad_aprobada, costoUnit) },
      });
    }),
  );
  if (dist.estado === 'calculada') {
    await prisma.distribuciones.update({ where: { id }, data: { estado: 'en_revision' } });
  }
  return { ok: true, ajustadas: ajustes.length };
}

/** Aprueba la distribución: fija cantidad_aprobada (= sugerida si no se tocó) y la congela. */
export async function aprobarDistribucion(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (!['calculada', 'en_revision'].includes(dist.estado)) {
    throw new HttpError(409, 'Esta distribución ya no puede aprobarse en su estado actual');
  }
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });
  await prisma.$transaction([
    ...lineas
      .filter((l) => l.cantidad_aprobada == null)
      .map((l) =>
        prisma.distribucion_lineas.update({
          where: { id: l.id },
          data: { cantidad_aprobada: l.cantidad_sugerida, costo_total: valor(num0(l.cantidad_sugerida), num(l.costo_unitario)) },
        }),
      ),
    prisma.distribuciones.update({
      where: { id },
      data: { estado: 'aprobada', aprobado_por: usuarioId, aprobado_at: new Date() },
    }),
  ]);
  return { ok: true };
}

/**
 * Confirma la carga del camión: lo verificado (o lo cargado ajustado) sale de la bodega
 * y pasa a tránsito. Registra un movimiento de transferencia por línea (idempotente).
 */
export async function confirmarCarga(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.estado !== 'verificada') throw new HttpError(409, 'Solo se carga una distribución verificada');
  const bodega = await bodegaDe(negocioId);
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });

  await prisma.$transaction(async (tx) => {
    for (const l of lineas) {
      const cargada = num(l.cantidad_cargada) ?? num(l.cantidad_verificada) ?? num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida);
      const reservado = num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida);
      const costo = num(l.costo_unitario);

      // Libera la reserva de TODA línea (el pedido se cierra al cargar), aunque no se cargue.
      if (reservado > 0) {
        const ex = await tx.existencias.findUnique({
          where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: l.product_id } },
        });
        if (ex) {
          await tx.existencias.update({
            where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: l.product_id } },
            data: { cantidad_reservada: redondear3(Math.max(0, num0(ex.cantidad_reservada) - reservado)) },
          });
        }
      }

      // Lo realmente cargado sale de disponible y entra a tránsito (movimiento idempotente).
      if (cargada > 0) {
        await aplicarMovimiento(tx, {
          negocioId,
          productId: l.product_id,
          tipo: 'transferencia',
          cantidad: cargada,
          usuarioId,
          origenId: bodega.id,
          destinoId: l.ubicacion_destino_id,
          costoUnitario: costo,
          documentoTipo: 'distribucion',
          documentoId: id,
          comentario: 'Carga al camión (salida de bodega)',
          idempotencyKey: `carga:${l.id}`,
          deltas: [{ ubicacionId: bodega.id, productId: l.product_id, disponible: -cargada, transito: cargada }],
        });
      }
      await tx.distribucion_lineas.update({ where: { id: l.id }, data: { cantidad_cargada: cargada } });
    }
    await tx.distribuciones.update({ where: { id }, data: { estado: 'en_transito', cargado_por: usuarioId, cargado_at: new Date() } });
  });
  return { ok: true };
}

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const redondear3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

// ===========================================================================
//  FASE 2 — operación de bodega: preparación, verificación, carga, recepción
// ===========================================================================

/** Detalle operativo: líneas con todas las cantidades por etapa, agrupadas por sucursal. */
export async function operacionDetalle(negocioId: bigint, id: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: id },
    include: {
      products: { include: { unidad_distribucion: true, categorias: true } },
      ubicaciones: { select: { id: true, nombre: true } },
    },
  });
  const grupos = new Map<string, { ubicacion: { id: number; nombre: string }; items: unknown[] }>();
  for (const l of lineas) {
    const k = l.ubicacion_destino_id.toString();
    if (!grupos.has(k)) grupos.set(k, { ubicacion: { id: Number(l.ubicaciones.id), nombre: l.ubicaciones.nombre }, items: [] });
    grupos.get(k)!.items.push({
      linea_id: Number(l.id),
      product_id: Number(l.product_id),
      nombre: l.products.nombre,
      unidad: l.products.unidad_distribucion.nombre,
      categoria: l.products.categorias?.nombre ?? null,
      cantidad_aprobada: num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida),
      cantidad_preparada: num(l.cantidad_preparada),
      cantidad_verificada: num(l.cantidad_verificada),
      cantidad_cargada: num(l.cantidad_cargada),
      cantidad_recibida: num(l.cantidad_recibida),
      estado_linea: l.estado_linea,
    });
  }
  return {
    id: Number(dist.id),
    estado: dist.estado,
    preparado_por: dist.preparado_por ? Number(dist.preparado_por) : null,
    verificado_por: dist.verificado_por ? Number(dist.verificado_por) : null,
    grupos: [...grupos.values()].sort((a, b) => a.ubicacion.nombre.localeCompare(b.ubicacion.nombre, 'es')),
  };
}

async function bodegaDe(negocioId: bigint) {
  const b = await prisma.ubicaciones.findFirst({ where: { negocio_id: negocioId, tipo: 'bodega', activo: true } });
  if (!b) throw new HttpError(400, 'No hay una bodega central activa');
  return b;
}

/** Inicia la preparación: reserva en bodega la cantidad aprobada de cada línea. */
export async function prepararDistribucion(negocioId: bigint, id: bigint, _usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.estado !== 'aprobada') throw new HttpError(409, 'Solo se preparan distribuciones aprobadas');
  const bodega = await bodegaDe(negocioId);
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });
  await prisma.$transaction(async (tx) => {
    for (const l of lineas) {
      const aprob = num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida);
      if (aprob <= 0) continue;
      const ex = await tx.existencias.findUnique({
        where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: l.product_id } },
      });
      await tx.existencias.upsert({
        where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: l.product_id } },
        create: { negocio_id: negocioId, ubicacion_id: bodega.id, product_id: l.product_id, cantidad_reservada: aprob },
        update: { cantidad_reservada: redondear3(num0(ex?.cantidad_reservada) + aprob) },
      });
    }
    await tx.distribuciones.update({ where: { id }, data: { estado: 'en_preparacion' } });
  });
  return { ok: true };
}

const lineasDeDist = (id: bigint, ajustes: { linea_id: number }[]) =>
  prisma.distribucion_lineas.findMany({ where: { id: { in: ajustes.map((a) => BigInt(a.linea_id)) }, distribucion_id: id } });

/** Guarda cantidades de una etapa (preparada/verificada/cargada) sobre líneas de la distribución. */
async function guardarEtapa(
  negocioId: bigint,
  id: bigint,
  estadosValidos: string[],
  campo: 'cantidad_preparada' | 'cantidad_verificada' | 'cantidad_cargada',
  items: { linea_id: number; cantidad: number }[],
) {
  const dist = await cargarDistribucion(negocioId, id);
  if (!estadosValidos.includes(dist.estado)) throw new HttpError(409, 'La distribución no está en la etapa correcta');
  const validas = new Set((await lineasDeDist(id, items)).map((l) => l.id.toString()));
  await prisma.$transaction(
    items
      .filter((i) => validas.has(i.linea_id.toString()))
      .map((i) => prisma.distribucion_lineas.update({ where: { id: BigInt(i.linea_id) }, data: { [campo]: i.cantidad } })),
  );
  return { ok: true, guardadas: items.length };
}

export const guardarPreparacion = (negocioId: bigint, id: bigint, items: { linea_id: number; cantidad: number }[]) =>
  guardarEtapa(negocioId, id, ['en_preparacion'], 'cantidad_preparada', items);

export const guardarVerificacion = (negocioId: bigint, id: bigint, items: { linea_id: number; cantidad: number }[]) =>
  guardarEtapa(negocioId, id, ['preparada'], 'cantidad_verificada', items);

export const guardarCarga = (negocioId: bigint, id: bigint, items: { linea_id: number; cantidad: number }[]) =>
  guardarEtapa(negocioId, id, ['verificada'], 'cantidad_cargada', items);

/** Cierra la preparación: las líneas sin cantidad usan la aprobada. */
export async function marcarPreparada(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.estado !== 'en_preparacion') throw new HttpError(409, 'La distribución no está en preparación');
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });
  await prisma.$transaction([
    ...lineas
      .filter((l) => l.cantidad_preparada == null)
      .map((l) =>
        prisma.distribucion_lineas.update({
          where: { id: l.id },
          data: { cantidad_preparada: l.cantidad_aprobada ?? l.cantidad_sugerida },
        }),
      ),
    prisma.distribuciones.update({ where: { id }, data: { estado: 'preparada', preparado_por: usuarioId, preparado_at: new Date() } }),
  ]);
  return { ok: true };
}

/** Cierra la verificación (doble chequeo): debe hacerla una persona distinta a quien preparó. */
export async function marcarVerificada(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.estado !== 'preparada') throw new HttpError(409, 'La distribución no está preparada');
  if (dist.preparado_por != null && dist.preparado_por === usuarioId) {
    throw new HttpError(409, 'La verificación debe hacerla una persona distinta a quien preparó');
  }
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });
  await prisma.$transaction([
    ...lineas
      .filter((l) => l.cantidad_verificada == null)
      .map((l) =>
        prisma.distribucion_lineas.update({ where: { id: l.id }, data: { cantidad_verificada: l.cantidad_preparada } }),
      ),
    prisma.distribuciones.update({ where: { id }, data: { estado: 'verificada', verificado_por: usuarioId, verificado_at: new Date() } }),
  ]);
  return { ok: true };
}
