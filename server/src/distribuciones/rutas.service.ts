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
      where: { id: BigInt(datos.repartidor_id), negocio_id: negocioId, rol: 'encargado_bodega', activo: true },
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

/**
 * Monitor del admin: TODO lo que está en la calle. Se basa en las distribuciones en tránsito
 * (no solo en rutas formalmente planeadas): si la distribución tiene ruta, usa su detalle; si no,
 * sintetiza las paradas desde las sucursales destino y su estado de recepción.
 */
export async function rutasActivas(negocioId: bigint) {
  const dists = await prisma.distribuciones.findMany({
    where: { negocio_id: negocioId, estado: { in: ['en_transito', 'parcialmente_entregada'] } },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  const out = [];
  for (const d of dists) {
    const ruta = await rutaDeDist(negocioId, d.id);
    out.push(ruta ? await rutaDetalle(negocioId, d.id) : await rutaSintetica(negocioId, d.id));
  }
  return out;
}

/** Ruta "sintética" para una distribución en tránsito que se cargó sin ruta planeada. */
async function rutaSintetica(negocioId: bigint, distId: bigint) {
  const dist = await prisma.distribuciones.findFirst({ where: { id: distId, negocio_id: negocioId } });
  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: distId },
    include: {
      products: { include: { unidad_distribucion: true } },
      ubicaciones: { select: { id: true, nombre: true, direccion: true } },
    },
  });

  const porUbic = new Map<string, { ubic: { id: number; nombre: string; direccion: string | null }; items: unknown[]; lineas: typeof lineas }>();
  for (const l of lineas) {
    const k = l.ubicacion_destino_id.toString();
    if (!porUbic.has(k)) {
      porUbic.set(k, {
        ubic: { id: Number(l.ubicaciones.id), nombre: l.ubicaciones.nombre, direccion: l.ubicaciones.direccion },
        items: [],
        lineas: [] as typeof lineas,
      });
    }
    const g = porUbic.get(k)!;
    g.items.push({
      linea_id: Number(l.id),
      product_id: Number(l.product_id),
      nombre: l.products.nombre,
      unidad: l.products.unidad_distribucion.nombre,
      esperado: cantidadACargar(l),
      recibida: num(l.cantidad_recibida),
    });
    g.lineas.push(l);
  }

  const paradas = [...porUbic.values()]
    .sort((a, b) => a.ubic.nombre.localeCompare(b.ubic.nombre, 'es'))
    .map((g, i) => {
      const todasRecibidas = g.lineas.every((l) => l.cantidad_recibida != null);
      const conIncidencia = g.lineas.some((l) => l.incidencia_id != null);
      const estado: EstadoParada = todasRecibidas ? (conIncidencia ? 'con_incidencia' : 'confirmada') : 'pendiente';
      return {
        parada_id: g.ubic.id, // sintético: id de la sucursal
        ubicacion: g.ubic,
        orden: i + 1,
        estado,
        entregada_at: null,
        confirmada_at: null,
        notas: null,
        items: g.items,
      };
    });

  return {
    ruta_id: -Number(distId), // sintético (negativo) para distinguir de rutas reales
    distribucion_id: Number(distId),
    nombre: `Pedido #${distId}`,
    estado: 'en_curso',
    repartidor: null,
    despachada_at: dist?.cargado_at?.toISOString() ?? null,
    paradas,
  };
}

/**
 * Tablero del repartidor ("Bodega y reparto"): rutas en curso que puede entregar —
 * las sin asignar (autocreadas al cargar) o asignadas a él. Rol unificado: la cuadrilla
 * de reparto ve lo que está en la calle sin depender de una asignación explícita.
 */
export async function rutasDelRepartidor(negocioId: bigint, repartidorId: bigint) {
  const rutas = await prisma.rutas.findMany({
    where: {
      negocio_id: negocioId,
      estado: 'en_curso',
      OR: [{ repartidor_id: null }, { repartidor_id: repartidorId }],
    },
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
 * Asegura que la distribución tenga una ruta EN CURSO cuando el camión se carga.
 * - Si el admin ya planeó una ruta, la despacha (planificada → en_curso).
 * - Si no hay ruta, crea una automáticamente con todas las sucursales destino como paradas
 *   (orden alfabético), sin repartidor asignado, para que la cuadrilla de reparto la entregue.
 * Se invoca dentro de la transacción de confirmarCarga.
 */
export async function asegurarRutaEnCurso(tx: Tx, negocioId: bigint, distId: bigint, usuarioId: bigint) {
  const existente = await tx.rutas.findFirst({
    where: { negocio_id: negocioId, distribucion_id: distId },
    orderBy: { id: 'desc' },
  });
  if (existente) {
    if (existente.estado === 'planificada') {
      await tx.rutas.update({ where: { id: existente.id }, data: { estado: 'en_curso', despachada_at: new Date() } });
    }
    return;
  }
  const lineas = await tx.distribucion_lineas.findMany({
    where: { distribucion_id: distId },
    select: { ubicacion_destino_id: true, ubicaciones: { select: { nombre: true } } },
  });
  const sucursales = new Map<string, { id: bigint; nombre: string }>();
  for (const l of lineas) sucursales.set(l.ubicacion_destino_id.toString(), { id: l.ubicacion_destino_id, nombre: l.ubicaciones.nombre });
  const ordenadas = [...sucursales.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  if (ordenadas.length === 0) return;

  const ruta = await tx.rutas.create({
    data: {
      negocio_id: negocioId,
      distribucion_id: distId,
      creado_por: usuarioId,
      estado: 'en_curso',
      despachada_at: new Date(),
      nombre: `Ruta dist #${distId}`,
    },
  });
  await tx.ruta_paradas.createMany({
    data: ordenadas.map((s, i) => ({ ruta_id: ruta.id, ubicacion_id: s.id, orden: i + 1 })),
  });
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
