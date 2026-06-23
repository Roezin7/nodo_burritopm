import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { estadoRutaDesdeParadas, estadoTrasEntrega, normalizarOrden, type EstadoParada } from './rutas.logic.js';

type Tx = Prisma.TransactionClient;

/** Cantidad que va en el camión para una línea (lo cargado, o lo mejor aprobado disponible). */
function cantidadACargar(l: {
  cantidad_cargada: Prisma.Decimal | null;
  cantidad_verificada: Prisma.Decimal | null;
  cantidad_aprobada: Prisma.Decimal | null;
  cantidad_sugerida: Prisma.Decimal;
}): number {
  return num(l.cantidad_cargada) ?? num(l.cantidad_verificada) ?? num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida);
}

async function cargarDist(negocioId: bigint, distId: bigint) {
  const dist = await prisma.distribuciones.findFirst({ where: { id: distId, negocio_id: negocioId } });
  if (!dist) throw new HttpError(404, 'Distribución no encontrada');
  return dist;
}

/** Ruta vigente (la última) de una distribución, o null. */
async function rutaDeDist(negocioId: bigint, distId: bigint) {
  return prisma.rutas.findFirst({ where: { negocio_id: negocioId, distribucion_id: distId }, orderBy: { id: 'desc' } });
}

/**
 * Crea o reescribe la ruta de una distribución: subconjunto ordenado de sucursales.
 * Solo el admin, y solo mientras la ruta esté en planificación.
 */
export async function crearOActualizarRuta(
  negocioId: bigint,
  distId: bigint,
  usuarioId: bigint,
  datos: { repartidor_id?: number | null; nombre?: string; paradas: { ubicacion_id: number; orden: number }[] },
) {
  const dist = await cargarDist(negocioId, distId);

  // Sucursales válidas: las que tienen líneas en esta distribución.
  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: distId },
    select: { ubicacion_destino_id: true },
  });
  const sucursalesValidas = new Set(lineas.map((l) => l.ubicacion_destino_id.toString()));
  for (const p of datos.paradas) {
    if (!sucursalesValidas.has(BigInt(p.ubicacion_id).toString())) {
      throw new HttpError(400, 'Una parada no corresponde a una sucursal de esta distribución');
    }
  }
  if (datos.repartidor_id != null) {
    const rep = await prisma.usuarios.findFirst({
      where: { id: BigInt(datos.repartidor_id), negocio_id: negocioId, rol: 'repartidor', activo: true },
      select: { id: true },
    });
    if (!rep) throw new HttpError(400, 'El repartidor indicado no existe o no está activo');
  }

  const existente = await rutaDeDist(negocioId, distId);
  if (existente && existente.estado !== 'planificada') {
    throw new HttpError(409, 'La ruta ya fue despachada; no se puede reorganizar');
  }

  const paradas = normalizarOrden(datos.paradas.map((p) => ({ ubicacion_id: p.ubicacion_id, orden: p.orden })));

  await prisma.$transaction(async (tx) => {
    const ruta = existente
      ? await tx.rutas.update({
          where: { id: existente.id },
          data: { repartidor_id: datos.repartidor_id != null ? BigInt(datos.repartidor_id) : null, nombre: datos.nombre ?? existente.nombre },
        })
      : await tx.rutas.create({
          data: {
            negocio_id: negocioId,
            distribucion_id: distId,
            creado_por: usuarioId,
            repartidor_id: datos.repartidor_id != null ? BigInt(datos.repartidor_id) : null,
            nombre: datos.nombre ?? `Ruta dist #${distId}`,
          },
        });
    // Reescribe las paradas (idempotente): borra y recrea con el orden nuevo.
    await tx.ruta_paradas.deleteMany({ where: { ruta_id: ruta.id } });
    if (paradas.length) {
      await tx.ruta_paradas.createMany({
        data: paradas.map((p) => ({ ruta_id: ruta.id, ubicacion_id: BigInt(p.ubicacion_id), orden: p.orden })),
      });
    }
  });

  return { ok: true, distribucion_id: Number(distId), estado_distribucion: dist.estado, paradas: paradas.length };
}

/** Detalle de la ruta de una distribución: paradas ordenadas con sus items y totales. */
export async function rutaDetalle(negocioId: bigint, distId: bigint) {
  await cargarDist(negocioId, distId);
  const ruta = await rutaDeDist(negocioId, distId);
  if (!ruta) return null;

  const [paradas, lineas, repartidor] = await Promise.all([
    prisma.ruta_paradas.findMany({
      where: { ruta_id: ruta.id },
      include: { ubicaciones: { select: { id: true, nombre: true, direccion: true } } },
      orderBy: { orden: 'asc' },
    }),
    prisma.distribucion_lineas.findMany({
      where: { distribucion_id: distId },
      include: { products: { include: { unidad_distribucion: true } } },
    }),
    ruta.repartidor_id
      ? prisma.usuarios.findUnique({ where: { id: ruta.repartidor_id }, select: { id: true, nombre: true } })
      : Promise.resolve(null),
  ]);

  const itemsPorUbic = new Map<string, unknown[]>();
  for (const l of lineas) {
    const k = l.ubicacion_destino_id.toString();
    if (!itemsPorUbic.has(k)) itemsPorUbic.set(k, []);
    itemsPorUbic.get(k)!.push({
      linea_id: Number(l.id),
      product_id: Number(l.product_id),
      nombre: l.products.nombre,
      unidad: l.products.unidad_distribucion.nombre,
      esperado: cantidadACargar(l),
      recibida: num(l.cantidad_recibida),
    });
  }

  return {
    ruta_id: Number(ruta.id),
    distribucion_id: Number(distId),
    nombre: ruta.nombre,
    estado: ruta.estado,
    repartidor: repartidor ? { id: Number(repartidor.id), nombre: repartidor.nombre } : null,
    despachada_at: ruta.despachada_at?.toISOString() ?? null,
    paradas: paradas.map((p) => ({
      parada_id: Number(p.id),
      ubicacion: { id: Number(p.ubicaciones.id), nombre: p.ubicaciones.nombre, direccion: p.ubicaciones.direccion },
      orden: p.orden,
      estado: p.estado as EstadoParada,
      entregada_at: p.entregada_at?.toISOString() ?? null,
      confirmada_at: p.confirmada_at?.toISOString() ?? null,
      notas: p.notas,
      items: itemsPorUbic.get(p.ubicaciones.id.toString()) ?? [],
    })),
  };
}

/** Rutas en curso asignadas a un repartidor (su tablero del día). */
export async function rutasDelRepartidor(negocioId: bigint, repartidorId: bigint) {
  const rutas = await prisma.rutas.findMany({
    where: { negocio_id: negocioId, repartidor_id: repartidorId, estado: { in: ['en_curso', 'completada'] } },
    orderBy: { id: 'desc' },
  });
  return Promise.all(rutas.map((r) => rutaDetalle(negocioId, r.distribucion_id)));
}

/** Recalcula el estado de la ruta a partir de sus paradas (dentro de una transacción). */
async function recomputarRuta(tx: Tx, rutaId: bigint) {
  const ruta = await tx.rutas.findUnique({ where: { id: rutaId } });
  if (!ruta) return;
  const paradas = await tx.ruta_paradas.findMany({ where: { ruta_id: rutaId }, select: { estado: true } });
  const nuevo = estadoRutaDesdeParadas(paradas.map((p) => p.estado as EstadoParada), ruta.despachada_at != null);
  if (nuevo !== ruta.estado) {
    await tx.rutas.update({
      where: { id: rutaId },
      data: { estado: nuevo, completada_at: nuevo === 'completada' ? new Date() : ruta.completada_at },
    });
  }
}

/**
 * El repartidor cierra una parada. Por defecto la marca "entregada" (1 toque). Si reporta un
 * problema, `items` trae lo realmente entregado por línea: si hay faltante respecto a lo cargado,
 * la parada queda "con_incidencia" y se abre una incidencia por línea (informativa). No mueve
 * inventario: el stock lo concilia la confirmación de la sucursal (recibir).
 */
export async function entregarParada(
  negocioId: bigint,
  rutaId: bigint,
  paradaId: bigint,
  usuarioId: bigint,
  datos: { items?: { linea_id: number; cantidad: number }[]; omitir?: boolean; notas?: string },
) {
  const ruta = await prisma.rutas.findFirst({ where: { id: rutaId, negocio_id: negocioId } });
  if (!ruta) throw new HttpError(404, 'Ruta no encontrada');
  if (ruta.estado !== 'en_curso') throw new HttpError(409, 'La ruta no está en curso');
  const parada = await prisma.ruta_paradas.findFirst({ where: { id: paradaId, ruta_id: rutaId } });
  if (!parada) throw new HttpError(404, 'Parada no encontrada');
  if (parada.estado === 'entregada' || parada.estado === 'confirmada') {
    throw new HttpError(409, 'Esta parada ya fue entregada');
  }

  const entregado = new Map((datos.items ?? []).map((i) => [i.linea_id, Math.max(0, i.cantidad)]));
  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: ruta.distribucion_id, ubicacion_destino_id: parada.ubicacion_id },
  });

  let hayFaltante = false;
  const faltantes: { linea: (typeof lineas)[number]; esperado: number; entregada: number }[] = [];
  if (datos.items && !datos.omitir) {
    for (const l of lineas) {
      if (!entregado.has(Number(l.id))) continue;
      const esperado = cantidadACargar(l);
      const ent = entregado.get(Number(l.id))!;
      if (ent < esperado) {
        hayFaltante = true;
        faltantes.push({ linea: l, esperado, entregada: ent });
      }
    }
  }

  const nuevoEstado = estadoTrasEntrega({ omitida: datos.omitir, hayFaltante });

  await prisma.$transaction(async (tx) => {
    for (const f of faltantes) {
      await tx.incidencias.create({
        data: {
          negocio_id: negocioId,
          tipo: 'faltante_entrega',
          prioridad: 'media',
          ubicacion_id: parada.ubicacion_id,
          documento_tipo: 'distribucion',
          documento_id: ruta.distribucion_id,
          distribucion_linea_id: f.linea.id,
          product_id: f.linea.product_id,
          responsable_id: usuarioId,
          comentarios: `Repartidor entregó ${f.entregada} de ${f.esperado} (faltante ${f.esperado - f.entregada}).`,
        },
      });
    }
    await tx.ruta_paradas.update({
      where: { id: paradaId },
      data: { estado: nuevoEstado, entregada_por: usuarioId, entregada_at: new Date(), notas: datos.notas ?? parada.notas },
    });
    await recomputarRuta(tx, rutaId);
  });

  return { ok: true, estado_parada: nuevoEstado, incidencias: faltantes.length };
}

/**
 * Despacha la ruta de una distribución (la pasa a en_curso) cuando el camión se carga.
 * Se invoca dentro de la transacción de confirmarCarga. Sin ruta planificada, no hace nada.
 */
export async function despacharRutaDeDist(tx: Tx, negocioId: bigint, distId: bigint) {
  const ruta = await tx.rutas.findFirst({
    where: { negocio_id: negocioId, distribucion_id: distId, estado: 'planificada' },
    orderBy: { id: 'desc' },
  });
  if (!ruta) return;
  await tx.rutas.update({ where: { id: ruta.id }, data: { estado: 'en_curso', despachada_at: new Date() } });
}

/**
 * Sella la parada de una sucursal cuando confirma su recepción. Se invoca dentro de la
 * transacción de recibirDistribucion. Marca confirmada (o con_incidencia) y recomputa la ruta.
 */
export async function sellarParadaPorRecepcion(
  tx: Tx,
  negocioId: bigint,
  distId: bigint,
  ubicacionId: bigint,
  conIncidencia: boolean,
) {
  const ruta = await tx.rutas.findFirst({
    where: { negocio_id: negocioId, distribucion_id: distId },
    orderBy: { id: 'desc' },
  });
  if (!ruta) return;
  const parada = await tx.ruta_paradas.findFirst({ where: { ruta_id: ruta.id, ubicacion_id: ubicacionId } });
  if (!parada) return;
  await tx.ruta_paradas.update({
    where: { id: parada.id },
    data: { estado: conIncidencia ? 'con_incidencia' : 'confirmada', confirmada_at: new Date() },
  });
  await recomputarRuta(tx, ruta.id);
}
