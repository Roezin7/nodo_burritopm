import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { valor } from './logic.js';
import { aplicarMovimiento } from '../ledger/service.js';
import { asegurarRutaEnCurso, sellarParadaPorRecepcion } from './rutas.service.js';
import { avisarPedidoEnCamino } from '../push/service.js';
import { asegurarRangoEditable, asegurarSemanaEditable } from '../lib/semana-operativa.js';
import { asegurarInventarioInicialSemanal, repararPedidosHuerfanos } from '../operacion/conciliacion.js';
import type { Prisma } from '@prisma/client';

async function pedidosVinculados(tx: Prisma.TransactionClient, distribucionId: bigint) {
  const lineas = await tx.distribucion_lineas.findMany({
    where: { distribucion_id: distribucionId, pedido_linea_id: { not: null } },
    select: { pedido_linea: { select: { pedido_id: true } } },
  });
  return [...new Set(lineas.flatMap((linea) => linea.pedido_linea ? [linea.pedido_linea.pedido_id] : []).map(String))].map(BigInt);
}

async function marcarPedidosDeDistribucion(
  tx: Prisma.TransactionClient,
  distribucionId: bigint,
  estado: 'en_preparacion' | 'despachado' | 'entregado',
) {
  const ids = await pedidosVinculados(tx, distribucionId);
  if (ids.length) await tx.pedidos_operativos.updateMany({
    where: { id: { in: ids }, estado: { notIn: estado === 'despachado' ? ['cerrado', 'cancelado', 'entregado'] : ['cerrado', 'cancelado'] } },
    data: { estado },
  });
}

async function marcarPedidosRecibidosEnUbicacion(tx: Prisma.TransactionClient, distribucionId: bigint, ubicacionId: bigint) {
  const pendientes = await tx.distribucion_lineas.count({ where: { distribucion_id: distribucionId, ubicacion_destino_id: ubicacionId, cantidad_recibida: null } });
  if (pendientes) return;
  const lineas = await tx.distribucion_lineas.findMany({
    where: { distribucion_id: distribucionId, ubicacion_destino_id: ubicacionId, pedido_linea_id: { not: null } },
    select: { pedido_linea: { select: { pedido_id: true } } },
  });
  const ids = [...new Set(lineas.flatMap((l) => l.pedido_linea ? [l.pedido_linea.pedido_id.toString()] : []))].map(BigInt);
  if (ids.length) await tx.pedidos_operativos.updateMany({
    where: { id: { in: ids }, estado: { notIn: ['cerrado', 'cancelado'] } }, data: { estado: 'entregado' },
  });
}

/** Último pedido CERRADO de la sucursal: mapa product_id(string) → cantidad pedida, y su id. */
async function pedidoCerradoSucursal(ubicacionId: bigint) {
  const conteo = await prisma.conteos.findFirst({
    where: { ubicacion_id: ubicacionId, estado: 'cerrado' },
    orderBy: { cerrado_at: 'desc' },
    include: { lineas: { select: { product_id: true, qty: true } } },
  });
  const map = new Map<string, number>();
  if (conteo) for (const l of conteo.lineas) map.set(l.product_id.toString(), num0(l.qty));
  return { map, conteoId: conteo?.id ?? null };
}

type LineaCalculada = {
  ubicacion_destino_id: bigint;
  product_id: bigint;
  conteo_id: bigint | null;
  inventario_disponible: number;
  stock_objetivo: number;
  stock_seguridad: number;
  cantidad_sugerida: number;
  costo_unitario: number | null;
  costo_total: number;
};

/**
 * Para cada sucursal dada, copia su último pedido cerrado. En sucursales la cantidad capturada
 * ya es lo que el restaurante quiere recibir; no se calcula contra stock objetivo.
 * Compartido por crearDistribucion y agregarSucursales (incluir una sucursal rezagada).
 */
async function calcularLineasSucursales(sucursales: { id: bigint; nombre: string }[]) {
  const sinPedido: string[] = [];
  const lineasData: LineaCalculada[] = [];

  for (const suc of sucursales) {
    const { map: pedido, conteoId } = await pedidoCerradoSucursal(suc.id);
    if (conteoId == null) {
      sinPedido.push(suc.nombre);
      continue;
    }
    const productos = await prisma.producto_ubicacion.findMany({
      where: { ubicacion_id: suc.id, habilitado: true, products: { activo: true } },
      include: { products: { select: { id: true, nombre: true, ultimo_costo: true, costo_promedio: true } } },
    });
    for (const pu of productos) {
      const cantidad = pedido.get(pu.product_id.toString()) ?? 0;
      if (cantidad <= 0) continue;
      const costo = num(pu.products.ultimo_costo) ?? num(pu.products.costo_promedio);
      lineasData.push({
        ubicacion_destino_id: suc.id,
        product_id: pu.product_id,
        conteo_id: conteoId,
        inventario_disponible: 0,
        stock_objetivo: 0,
        stock_seguridad: 0,
        cantidad_sugerida: cantidad,
        costo_unitario: costo,
        costo_total: valor(cantidad, costo),
      });
    }
  }
  return { lineasData, sinPedido };
}

/**
 * Crea una distribución a partir de los últimos pedidos cerrados de las sucursales activas.
 * La sucursal decide directamente cuánto quiere recibir; el admin revisa y aprueba.
 */
export async function crearDistribucion(negocioId: bigint, usuarioId: bigint, ubicacionIds?: number[]) {
  // Todo sale de la bodega central (Adison): si no existe, no hay distribución posible.
  await bodegaDe(negocioId);

  const sucursales = await prisma.ubicaciones.findMany({
    where: {
      negocio_id: negocioId,
      tipo: 'sucursal',
      activo: true,
      ...(ubicacionIds && ubicacionIds.length ? { id: { in: ubicacionIds.map((n) => BigInt(n)) } } : {}),
    },
  });
  if (sucursales.length === 0) throw new HttpError(400, 'No hay sucursales activas para distribuir');

  const { lineasData, sinPedido } = await calcularLineasSucursales(sucursales);

  if (lineasData.length === 0) {
    const partes: string[] = [];
    if (sinPedido.length) partes.push(`Sucursales sin pedido cerrado: ${sinPedido.join(', ')}.`);
    throw new HttpError(
      400,
      partes.length
        ? `No hay nada que distribuir. ${partes.join(' ')}`
        : 'No hay nada que distribuir: las sucursales no pidieron producto.',
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

  return { id: Number(dist.id), lineas: lineasData.length, sin_conteo: sinPedido };
}

// Estados en los que el pedido aún se puede editar / ampliar (antes de aprobar y salir a bodega).
const ESTADOS_EDITABLES = ['calculada', 'en_revision'];

/**
 * Sucursales que pueden sumarse a un pedido aún editable: activas, con pedido cerrado y que
 * todavía no están en el pedido. Es la lista para "incluir una sucursal rezagada".
 */
export async function sucursalesAgregables(negocioId: bigint, id: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (!ESTADOS_EDITABLES.includes(dist.estado)) return [];
  if (!dist.fecha_entrega || !dist.linea_operacion) return [];
  const enPedido = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: id },
    select: { ubicacion_destino_id: true },
    distinct: ['ubicacion_destino_id'],
  });
  const yaIds = new Set(enPedido.map((l) => l.ubicacion_destino_id.toString()));
  const pedidos = await prisma.pedidos_operativos.findMany({
    where: {
      negocio_id: negocioId,
      linea_operacion: dist.linea_operacion,
      fecha_entrega: dist.fecha_entrega,
      estado: 'confirmado',
      ubicacion_id: { notIn: [...yaIds].map(BigInt) },
      lineas: { some: {} },
    },
    include: { ubicacion: { select: { id: true, nombre: true } } },
    orderBy: { ubicacion: { orden_operativo: 'asc' } },
  });
  return pedidos.map((p) => ({ id: Number(p.ubicacion.id), nombre: p.ubicacion.nombre }));
}

/**
 * Suma una o más sucursales rezagadas a un pedido aún editable sin rehacerlo: calcula solo
 * las líneas de esas sucursales y las anexa, dejando intactas las líneas (y ajustes) ya cargadas.
 */
export async function agregarSucursales(negocioId: bigint, id: bigint, ubicacionIds: number[]) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
  if (!ESTADOS_EDITABLES.includes(dist.estado)) {
    throw new HttpError(409, 'Solo se pueden agregar sucursales a un pedido en cálculo o revisión (aún sin aprobar).');
  }
  const enPedido = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: id },
    select: { ubicacion_destino_id: true },
    distinct: ['ubicacion_destino_id'],
  });
  const yaIds = new Set(enPedido.map((l) => l.ubicacion_destino_id.toString()));

  if (!dist.fecha_entrega || !dist.linea_operacion) throw new HttpError(409, 'Este consolidado anterior no admite ventas operativas nuevas');
  const pedidos = await prisma.pedidos_operativos.findMany({
    where: {
      negocio_id: negocioId,
      ubicacion_id: { in: ubicacionIds.map(BigInt), notIn: [...yaIds].map(BigInt) },
      linea_operacion: dist.linea_operacion,
      fecha_entrega: dist.fecha_entrega,
      estado: 'confirmado',
      lineas: { some: {} },
    },
    include: { lineas: { include: { producto: true } }, ubicacion: true },
  });
  if (!pedidos.length) throw new HttpError(400, 'Esas sucursales no tienen una venta confirmada pendiente para este consolidado');

  const lineasData = pedidos.flatMap((pedido) => pedido.lineas.map((linea) => ({
    distribucion_id: id,
    ubicacion_destino_id: pedido.ubicacion_id,
    product_id: linea.product_id,
    pedido_linea_id: linea.id,
    cantidad_sugerida: linea.cantidad,
    cantidad_aprobada: linea.cantidad,
    costo_unitario: linea.producto.ultimo_costo ?? linea.producto.costo_promedio,
    costo_total: redondear2(num0(linea.cantidad) * (num(linea.producto.ultimo_costo) ?? num(linea.producto.costo_promedio) ?? 0)),
  })));
  await prisma.$transaction(async (tx) => {
    await tx.distribucion_lineas.createMany({ data: lineasData });
    const rutas = await tx.rutas.findMany({
      where: { distribucion_id: id },
      include: { plantilla: { include: { paradas: true } }, paradas: true },
      orderBy: { id: 'asc' },
    });
    for (const pedido of pedidos) {
      const punto = pedido.ubicacion.entrega_en_ubicacion_id ?? pedido.ubicacion_id;
      if (rutas.some((ruta) => ruta.paradas.some((parada) => parada.ubicacion_id === punto))) continue;
      let ruta = rutas.find((r) => r.plantilla?.paradas.some((parada) => parada.ubicacion_id === punto));
      if (!ruta) ruta = rutas.find((r) => r.plantilla_id == null);
      if (!ruta) {
        ruta = await tx.rutas.create({
          data: { negocio_id: negocioId, distribucion_id: id, fecha_entrega: dist.fecha_entrega, nombre: 'Ruta por asignar', creado_por: dist.creado_por },
          include: { plantilla: { include: { paradas: true } }, paradas: true },
        });
        rutas.push(ruta);
      }
      const orden = ruta.paradas.reduce((max, parada) => Math.max(max, parada.orden), 0) + 1;
      const nueva = await tx.ruta_paradas.create({ data: { ruta_id: ruta.id, ubicacion_id: punto, orden } });
      ruta.paradas.push(nueva);
    }
    await tx.pedidos_operativos.updateMany({ where: { id: { in: pedidos.map((p) => p.id) } }, data: { estado: 'en_preparacion' } });
  });
  return { agregadas: pedidos.map((p) => p.ubicacion.nombre), lineas: lineasData.length, sin_conteo: [] };
}

/**
 * Única reversa manual segura: devolver una preparación todavía inmóvil a revisión.
 * Los estados posteriores a carga/recepción siempre se derivan de movimientos físicos.
 */
export async function cambiarEstadoAdmin(negocioId: bigint, id: bigint, estado: EstadoDistribucionValor) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
  if (estado !== 'en_revision' || !['calculada', 'en_revision', 'aprobada', 'verificada'].includes(dist.estado)) {
    throw new HttpError(409, 'Ese estado no puede forzarse. Usa las acciones del flujo o elimina el consolidado para reconstruirlo.');
  }
  const movidas = await prisma.distribucion_lineas.count({
    where: { distribucion_id: id, OR: [{ cantidad_cargada: { gt: 0 } }, { cantidad_recibida: { not: null } }] },
  });
  if (movidas) throw new HttpError(409, 'El consolidado ya movió inventario y no puede volver manualmente a revisión');
  await prisma.distribuciones.update({ where: { id }, data: { estado } });
  return { ok: true, estado };
}

export type EstadoDistribucionValor =
  | 'borrador' | 'esperando_conteos' | 'calculada' | 'en_revision' | 'aprobada'
  | 'en_preparacion' | 'preparada' | 'verificada' | 'en_carga' | 'cargada'
  | 'en_transito' | 'parcialmente_entregada' | 'entregada' | 'cerrada'
  | 'cerrada_con_incidencias' | 'cancelada';

export async function listarDistribuciones(negocioId: bigint, desde?: string, hasta?: string) {
  await repararPedidosHuerfanos(negocioId);
  const rango = desde || hasta ? { gte: desde ? new Date(`${desde}T00:00:00.000Z`) : undefined, lte: hasta ? new Date(`${hasta}T00:00:00.000Z`) : undefined } : undefined;
  const ds = await prisma.distribuciones.findMany({
    where: { negocio_id: negocioId, fecha_entrega: rango },
    orderBy: { id: 'desc' },
    include: { _count: { select: { lineas: true } } },
  });
  return ds.map((d) => ({
    id: Number(d.id),
    nombre: d.nombre,
    estado: d.estado,
    linea: d.linea_operacion,
    fecha_entrega: d.fecha_entrega?.toISOString().slice(0, 10) ?? null,
    creado_at: d.creado_at.toISOString(),
    aprobado_at: d.aprobado_at?.toISOString() ?? null,
    total_lineas: d._count.lineas,
  }));
}

/** Renombra la distribución (etiqueta libre del admin). No toca inventario ni estado. */
export async function renombrarDistribucion(negocioId: bigint, id: bigint, nombre: string) {
  await cargarDistribucion(negocioId, id);
  const limpio = nombre.trim().slice(0, 120);
  await prisma.distribuciones.update({ where: { id }, data: { nombre: limpio || null } });
  return { ok: true, nombre: limpio || null };
}

/**
 * Elimina una distribución y TODO lo relacionado (líneas, rutas y paradas por cascada;
 * incidencias por borrado explícito), devolviendo el inventario a la bodega central para que
 * nunca quede descuadre. La reversa es FÍSICA (lo que de verdad se movió), no contable:
 *   - Línea ya recibida en sucursal → se devuelve a bodega lo que aún tenga la sucursal
 *     (min(recibido, disponible_actual)); lo que la sucursal ya consumió no se inventa.
 *   - Línea en tránsito (cargada, no recibida) → regresa de tránsito a disponible de bodega.
 *   - Línea sin cargar → no movió inventario, nada que revertir.
 * También borra los pedidos de sucursal (conteos) que alimentaron ESTA distribución, para que
 * cada sucursal pueda capturar uno nuevo; el resto de su historial de pedidos no se toca.
 * Todo en una sola transacción e idempotente por movimiento.
 */
export async function eliminarDistribucion(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const distribucion = await cargarDistribucion(negocioId, id);
  if (distribucion.fecha_entrega) await asegurarSemanaEditable(negocioId, distribucion.fecha_entrega.toISOString().slice(0, 10));
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });
  const bodegas = await bodegasDeProductos(negocioId, lineas.map((l) => l.product_id));
  const sello = Date.now(); // permite distinguir reversas si se reintenta
  // Pedidos de sucursal que originaron las líneas (únicos, sin nulos).
  const conteoIds = [...new Map(lineas.filter((l) => l.conteo_id != null).map((l) => [l.conteo_id!.toString(), l.conteo_id!])).values()];
  const pedidoLineaIds = lineas.filter((l) => l.pedido_linea_id != null).map((l) => l.pedido_linea_id!);
  const pedidosOperativos = pedidoLineaIds.length
    ? await prisma.pedido_operativo_lineas.findMany({
        where: { id: { in: pedidoLineaIds } },
        select: { pedido_id: true },
        distinct: ['pedido_id'],
      })
    : [];

  await prisma.$transaction(async (tx) => {
    for (const l of lineas) {
      const bodega = bodegas.get(l.product_id.toString());
      if (!bodega) throw new HttpError(400, 'No hay bodega configurada para uno de los productos');
      const costo = num(l.costo_unitario);
      const recibida = num(l.cantidad_recibida);
      const cargada = num(l.cantidad_cargada);

      if (recibida != null) {
        // Ya está en la sucursal: devolvemos a bodega lo que físicamente siga allí.
        const sucEx = await tx.existencias.findUnique({
          where: { ubicacion_id_product_id: { ubicacion_id: l.ubicacion_destino_id, product_id: l.product_id } },
        });
        const enSuc = Math.max(0, num0(sucEx?.cantidad_disponible));
        const devolver = redondear3(Math.min(recibida, enSuc));
        if (devolver > 0) {
          await aplicarMovimiento(tx, {
            negocioId,
            productId: l.product_id,
            tipo: 'cancelacion',
            cantidad: devolver,
            usuarioId,
            origenId: l.ubicacion_destino_id,
            destinoId: bodega.id,
            costoUnitario: costo,
            documentoTipo: 'distribucion_eliminada',
            documentoId: id,
            comentario: 'Devolución a bodega por distribución eliminada',
            idempotencyKey: `del:${id}:${l.id}:${sello}`,
            deltas: [
              { ubicacionId: l.ubicacion_destino_id, productId: l.product_id, disponible: -devolver },
              { ubicacionId: bodega.id, productId: l.product_id, disponible: devolver, costoUnitario: costo },
            ],
          });
        }
      } else if (cargada != null && cargada > 0) {
        // En tránsito: regresa de tránsito a disponible en la bodega (sin negativos).
        const bodEx = await tx.existencias.findUnique({
          where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: l.product_id } },
        });
        const enTransito = Math.max(0, num0(bodEx?.cantidad_transito));
        const devolver = redondear3(Math.min(cargada, enTransito));
        if (devolver > 0) {
          await aplicarMovimiento(tx, {
            negocioId,
            productId: l.product_id,
            tipo: 'cancelacion',
            cantidad: devolver,
            usuarioId,
            origenId: bodega.id,
            destinoId: bodega.id,
            costoUnitario: costo,
            documentoTipo: 'distribucion_eliminada',
            documentoId: id,
            comentario: 'Regreso de tránsito a disponible por distribución eliminada',
            idempotencyKey: `del:${id}:${l.id}:${sello}`,
            deltas: [{ ubicacionId: bodega.id, productId: l.product_id, disponible: devolver, transito: -devolver }],
          });
        }
      }
    }
    // Incidencias atadas a esta distribución (no tienen FK, se borran a mano).
    await tx.incidencias.deleteMany({ where: { negocio_id: negocioId, documento_tipo: 'distribucion', documento_id: id } });
    // La distribución arrastra por cascada: líneas, rutas y paradas.
    await tx.distribuciones.delete({ where: { id } });
    // La preparación operativa no es el pedido: al eliminarla se conserva la venta y vuelve a
    // "confirmado", permitiendo corregirla y generar de nuevo preparación/rutas sin quedar
    // atorada para siempre en "en_preparacion".
    if (pedidosOperativos.length) {
      await tx.pedidos_operativos.updateMany({
        where: { id: { in: pedidosOperativos.map((p) => p.pedido_id) }, estado: { in: ['en_preparacion', 'despachado', 'entregado'] } },
        data: { estado: 'confirmado' },
      });
    }
    // Se borran los pedidos de sucursal que alimentaron esta distribución (la sucursal puede
    // capturar uno nuevo ese mismo día). Si otro pedido maestro aún referencia el mismo conteo,
    // se conserva. Los pedidos de sucursal no mueven stock, así que no hay nada que revertir.
    if (conteoIds.length > 0) {
      const usados = await tx.distribucion_lineas.findMany({
        where: { conteo_id: { in: conteoIds } },
        select: { conteo_id: true },
      });
      const enUso = new Set(usados.map((u) => u.conteo_id?.toString()));
      const borrar = conteoIds.filter((cid) => !enUso.has(cid.toString()));
      if (borrar.length > 0) {
        await tx.conteos.deleteMany({ where: { id: { in: borrar }, negocio_id: negocioId } });
      }
    }
  });

  return { ok: true };
}

async function cargarDistribucion(negocioId: bigint, id: bigint) {
  const dist = await prisma.distribuciones.findFirst({ where: { id, negocio_id: negocioId } });
  if (!dist) throw new HttpError(404, 'Distribución no encontrada');
  return dist;
}

/**
 * Bodega central del negocio (Bodega Adison): la ÚNICA fuente de salida. Todo lo que se
 * distribuye sale de aquí. Se elige de forma DETERMINISTA (la de menor id) para que todos los
 * caminos (disponibilidad, cálculo, carga, recepción) usen exactamente la misma bodega y el
 * inventario no se descuadre. Devuelve null si el negocio aún no tiene bodega activa.
 */
async function bodegaCentralOpcional(negocioId: bigint, linea?: 'carne' | 'desechables' | null) {
  if (linea === 'carne') {
    const carniceria = await prisma.ubicaciones.findFirst({
      where: { negocio_id: negocioId, tipo: 'bodega', activo: true, nombre: { contains: 'Carnicer', mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    });
    if (carniceria) return carniceria;
  }
  if (linea === 'desechables') {
    const adison = await prisma.ubicaciones.findFirst({
      where: { negocio_id: negocioId, tipo: 'bodega', activo: true, nombre: { contains: 'Adison', mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    });
    if (adison) return adison;
  }
  return prisma.ubicaciones.findFirst({
    where: { negocio_id: negocioId, tipo: 'bodega', activo: true },
    orderBy: { id: 'asc' },
  });
}

/** Disponibilidad en vivo desde la bodega propia de cada producto: carne desde Carnicería
 * y desechables desde Adison, incluso cuando ambos viajan juntos en una ruta de carne. */
async function bodegasDeProductos(negocioId: bigint, productIds: bigint[]) {
  const productos = await prisma.products.findMany({
    where: { negocio_id: negocioId, id: { in: productIds } },
    select: { id: true, linea_operacion: true },
  });
  const [carne, desechables, general] = await Promise.all([
    bodegaCentralOpcional(negocioId, 'carne'),
    bodegaCentralOpcional(negocioId, 'desechables'),
    bodegaCentralOpcional(negocioId),
  ]);
  const map = new Map<string, NonNullable<typeof general>>();
  for (const p of productos) {
    const bodega = p.linea_operacion === 'carne' ? carne : p.linea_operacion === 'desechables' ? desechables : general;
    if (bodega) map.set(p.id.toString(), bodega);
  }
  return map;
}

async function disponibleBodega(negocioId: bigint): Promise<Map<string, number>> {
  const productos = await prisma.products.findMany({
    where: { negocio_id: negocioId, activo: true, linea_operacion: { not: null } },
    select: { id: true },
  });
  const bodegas = await bodegasDeProductos(negocioId, productos.map((p) => p.id));
  const idsBodega = [...new Set([...bodegas.values()].map((b) => b.id.toString()))].map((id) => BigInt(id));
  if (!idsBodega.length) return new Map();
  const filas = await prisma.existencias.findMany({
    where: { ubicacion_id: { in: idsBodega }, product_id: { in: productos.map((p) => p.id) } },
    select: { ubicacion_id: true, product_id: true, cantidad_disponible: true },
  });
  const map = new Map<string, number>();
  for (const f of filas) {
    const origen = bodegas.get(f.product_id.toString());
    if (origen?.id === f.ubicacion_id) map.set(f.product_id.toString(), num0(f.cantidad_disponible));
  }
  return map;
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
        sku: l.products.sku,
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
    return { estado: dist.estado, nombre: dist.nombre, linea: dist.linea_operacion, vista, grupos, total: redondear2(grupos.reduce((a, g) => a + g.subtotal, 0)) };
  }

  // vista === 'producto'
  const m = new Map<string, any>();
  for (const l of lineas) {
    const k = l.product_id.toString();
    if (!m.has(k)) {
      m.set(k, {
        product_id: Number(l.product_id),
        sku: l.products.sku,
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
    const faltante = redondear3(Math.max(0, g.total_aprobada - g.bodega_disponible));
    return {
      ...g,
      // La disponibilidad es informativa: una captura tardía de producción no reduce la venta.
      surtible: redondear3(g.total_aprobada),
      faltante,
      valor: valor(g.total_aprobada, g.costo_unitario),
    };
  });
  items.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return {
    estado: dist.estado,
    nombre: dist.nombre,
    linea: dist.linea_operacion,
    vista,
    items,
    total_valor: redondear2(items.reduce((a, i) => a + i.valor, 0)),
    total_faltante_valor: redondear2(items.reduce((a, i) => a + valor(i.faltante, i.costo_unitario), 0)),
  };
}

/** Ajusta cantidades aprobadas (admin). Pasa la distribución a "en_revision". */
export async function ajustarLineas(negocioId: bigint, id: bigint, ajustes: { linea_id: number; cantidad_aprobada: number }[]) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
  if (!['calculada', 'en_revision'].includes(dist.estado)) {
    throw new HttpError(409, 'Solo se pueden ajustar distribuciones en cálculo o revisión');
  }
  if (!ajustes.length) throw new HttpError(400, 'Incluye al menos una línea para ajustar');
  const ids = [...new Set(ajustes.map((a) => a.linea_id))];
  if (ids.length !== ajustes.length) throw new HttpError(400, 'La misma línea aparece más de una vez');
  if (ajustes.some((a) => !Number.isFinite(a.cantidad_aprobada) || a.cantidad_aprobada < 0)) {
    throw new HttpError(400, 'Las cantidades aprobadas deben ser números positivos o cero');
  }
  const lineas = await prisma.distribucion_lineas.findMany({
    where: { id: { in: ids.map((lineaId) => BigInt(lineaId)) }, distribucion_id: id },
  });
  if (lineas.length !== ids.length) throw new HttpError(400, 'Una o más líneas no pertenecen a este consolidado');
  const porId = new Map(lineas.map((l) => [l.id.toString(), l]));
  await prisma.$transaction(
    ajustes.map((a) => {
      const l = porId.get(a.linea_id.toString());
      const costoUnit = num(l!.costo_unitario);
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
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
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

/** Aprueba juntas todas las preparaciones editables de un rango semanal. */
export async function aprobarDistribucionesEnRango(
  negocioId: bigint,
  usuarioId: bigint,
  desde: string,
  hasta: string,
) {
  await asegurarRangoEditable(negocioId, desde, hasta);
  const inicio = new Date(`${desde}T00:00:00.000Z`);
  const fin = new Date(`${hasta}T00:00:00.000Z`);
  const preparaciones = await prisma.distribuciones.findMany({
    where: {
      negocio_id: negocioId,
      fecha_entrega: { gte: inicio, lte: fin },
      estado: { in: ['calculada', 'en_revision'] },
    },
    select: { id: true },
    orderBy: { fecha_entrega: 'asc' },
  });
  for (const preparacion of preparaciones) {
    await aprobarDistribucion(negocioId, preparacion.id, usuarioId);
  }
  return { aprobadas: preparaciones.length };
}

/**
 * Confirma la carga del camión. Con reparto activo pasa a tránsito; sin reparto, el despacho
 * es también la entrega normal y queda cerrado sin exigir una confirmación administrativa.
 */
export async function confirmarCarga(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
  // Flujo v2: se carga directo desde "aprobada" (o desde "verificada" si el admin activó
  // la verificación opcional de 1 toque). Sin reservas ni etapas intermedias.
  if (!['aprobada', 'verificada'].includes(dist.estado)) {
    throw new HttpError(409, 'Solo se carga una distribución aprobada o verificada');
  }
  // Si la verificación está activa, no se carga sin haber verificado primero.
  const negocio = await prisma.negocios.findUnique({
    where: { id: negocioId },
    select: { verificacion_carga: true, reparto_habilitado: true },
  });
  if (negocio?.verificacion_carga && dist.estado !== 'verificada') {
    throw new HttpError(409, 'La verificación de carga está activa: verifica antes de cargar');
  }
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });
  const bodegas = await bodegasDeProductos(negocioId, lineas.map((l) => l.product_id));

  if (dist.fecha_entrega) {
    for (const bodega of [...new Map([...bodegas.values()].filter((b) => b.codigo === 'CARN').map((b) => [b.id.toString(), b])).values()]) {
      await asegurarInventarioInicialSemanal(negocioId, usuarioId, dist.fecha_entrega.toISOString().slice(0, 10), bodega.id);
    }
  }

  // La carga registra lo que físicamente salió aunque producción se capture después. Un saldo
  // negativo es provisional y visible en la conciliación; nunca se recorta una venta real.
  let totalCargado = 0;
  const sucursalesConCarga = new Set<string>(); // solo estas serán paradas de la ruta

  await prisma.$transaction(async (tx) => {
    for (const l of [...lineas].sort((a, b) => Number(a.id - b.id))) {
      const bodega = bodegas.get(l.product_id.toString());
      if (!bodega) throw new HttpError(400, 'No hay bodega configurada para uno de los productos');
      const aprobada = num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida);
      const solicitada = num(l.cantidad_cargada) ?? num(l.cantidad_verificada) ?? aprobada;
      const pedida = Math.max(0, Math.min(solicitada, aprobada));
      const cargada = pedida;
      const costo = num(l.costo_unitario);

      // Con reparto activo queda en tránsito. Sin reparto, Despacho es el último evento normal:
      // la existencia llega directamente al restaurante y Auditoría queda solo para excepciones.
      if (cargada > 0) {
        totalCargado = redondear3(totalCargado + cargada);
        sucursalesConCarga.add(l.ubicacion_destino_id.toString());
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
          comentario: negocio?.reparto_habilitado ? 'Carga al camión (salida de bodega)' : 'Despacho y entrega directa al restaurante',
          idempotencyKey: `carga:${l.id}`,
          deltas: negocio?.reparto_habilitado
            ? [{ ubicacionId: bodega.id, productId: l.product_id, disponible: -cargada, transito: cargada }]
            : [
                { ubicacionId: bodega.id, productId: l.product_id, disponible: -cargada },
                { ubicacionId: l.ubicacion_destino_id, productId: l.product_id, disponible: cargada, costoUnitario: costo },
              ],
          permitirDisponibleNegativo: bodega.codigo === 'CARN',
        });
      }
      if (cargada + 0.0001 < aprobada) {
        await tx.incidencias.create({
          data: {
            negocio_id: negocioId,
            tipo: 'faltante_surtido',
            prioridad: 'media',
            ubicacion_id: l.ubicacion_destino_id,
            documento_tipo: 'distribucion',
            documento_id: id,
            distribucion_linea_id: l.id,
            product_id: l.product_id,
            responsable_id: usuarioId,
            comentarios: `Aprobado ${aprobada}, cargado ${cargada} (faltante ${redondear3(aprobada - cargada)}).`,
          },
        });
      }
      const entregaDirecta = !negocio?.reparto_habilitado;
      await tx.distribucion_lineas.update({
        where: { id: l.id },
        data: {
          cantidad_cargada: cargada,
          cantidad_recibida: cargada <= 0 || entregaDirecta ? cargada : null,
          estado_linea: cargada <= 0 ? 'no_surtido' : entregaDirecta ? 'recibido' : null,
        },
      });
    }
    // Una preparación completamente en cero no genera tránsito ni ruta.
    if (totalCargado <= 0) {
      throw new HttpError(409, 'El consolidado no tiene cantidades para cargar.');
    }
    const entregaDirecta = !negocio?.reparto_habilitado;
    await tx.distribuciones.update({ where: { id }, data: { estado: entregaDirecta ? 'cerrada' : 'en_transito', cargado_por: usuarioId, cargado_at: new Date() } });
    await marcarPedidosDeDistribucion(tx, id, entregaDirecta ? 'entregado' : 'despachado');
    if (negocio?.reparto_habilitado) {
      // Con seguimiento de reparto, el camión cargado pone las rutas planeadas en curso.
      await asegurarRutaEnCurso(tx, negocioId, id, usuarioId, sucursalesConCarga);
    } else {
      // Sin seguimiento, Despacho completa la entrega normal. Las rutas quedan como referencia
      // documental y Auditoría se abre únicamente si después se reporta una diferencia.
      await tx.rutas.updateMany({
        where: { negocio_id: negocioId, distribucion_id: id, estado: 'planificada' },
        data: { estado: 'cancelada', notas: 'Reparto desactivado: entrega completada al despachar' },
      });
    }
  }, { isolationLevel: 'Serializable' });
  if (negocio?.reparto_habilitado) {
    void avisarPedidoEnCamino(id).catch(() => {}); // aviso best-effort a las sucursales
  }
  return { ok: true };
}

/** Distribuciones en tránsito con líneas destinadas a una sucursal (para recepción). */
export async function recepcionesPendientes(negocioId: bigint, ubicacionId: bigint, desde?: string, hasta?: string) {
  const rango = desde || hasta ? { gte: desde ? new Date(`${desde}T00:00:00.000Z`) : undefined, lte: hasta ? new Date(`${hasta}T00:00:00.000Z`) : undefined } : undefined;
  const dists = await prisma.distribuciones.findMany({
    where: {
      negocio_id: negocioId,
      estado: { in: ['en_transito', 'parcialmente_entregada'] },
      fecha_entrega: rango,
      lineas: { some: { ubicacion_destino_id: ubicacionId } },
    },
    include: {
      lineas: {
        where: { ubicacion_destino_id: ubicacionId },
        include: { products: { include: { unidad_distribucion: true } } },
      },
    },
    orderBy: { id: 'desc' },
  });
  return dists.map((d) => ({
    id: Number(d.id),
    estado: d.estado,
    fecha_entrega: d.fecha_entrega?.toISOString().slice(0, 10) ?? null,
    creado_at: d.creado_at.toISOString(),
    lineas: d.lineas.map((l) => ({
      linea_id: Number(l.id),
      product_id: Number(l.product_id),
      nombre: l.products.nombre,
      unidad: l.products.unidad_distribucion.nombre,
      esperado: num(l.cantidad_cargada) ?? 0,
      recibida: num(l.cantidad_recibida),
      estado_linea: l.estado_linea,
    })),
  }));
}

/** Historial de recepciones de una sucursal: distribuciones ya recibidas/cerradas que la tocaron. */
export async function recepcionesHistorial(negocioId: bigint, ubicacionId: bigint, desde?: string, hasta?: string) {
  const rango = desde || hasta ? { gte: desde ? new Date(`${desde}T00:00:00.000Z`) : undefined, lte: hasta ? new Date(`${hasta}T00:00:00.000Z`) : undefined } : undefined;
  const dists = await prisma.distribuciones.findMany({
    where: {
      negocio_id: negocioId,
      estado: { in: ['entregada', 'cerrada', 'cerrada_con_incidencias'] },
      fecha_entrega: rango,
      lineas: { some: { ubicacion_destino_id: ubicacionId, cantidad_recibida: { not: null } } },
    },
    include: {
      lineas: {
        where: { ubicacion_destino_id: ubicacionId },
        include: { products: { include: { unidad_distribucion: true } } },
      },
    },
    orderBy: { id: 'desc' },
    take: 40,
  });
  return dists.map((d) => {
    const conIncidencia = d.lineas.some((l) => l.incidencia_id != null);
    return {
      id: Number(d.id),
      estado: d.estado,
      fecha_entrega: d.fecha_entrega?.toISOString().slice(0, 10) ?? null,
      recibido_at: d.creado_at.toISOString(),
      con_incidencia: conIncidencia,
      total_lineas: d.lineas.length,
      lineas: d.lineas.map((l) => ({
        linea_id: Number(l.id),
        nombre: l.products.nombre,
        unidad: l.products.unidad_distribucion.nombre,
        esperado: num(l.cantidad_cargada) ?? 0,
        recibida: num(l.cantidad_recibida),
        estado_linea: l.estado_linea,
      })),
    };
  });
}

/** Vista administrativa de todas las recepciones de la semana, agrupadas por restaurante. */
export async function auditoriaRecepciones(negocioId: bigint, desde: string, hasta: string) {
  const dists = await prisma.distribuciones.findMany({
    where: {
      negocio_id: negocioId,
      estado: { in: ['en_transito', 'parcialmente_entregada', 'entregada', 'cerrada', 'cerrada_con_incidencias'] },
      fecha_entrega: { gte: new Date(`${desde}T00:00:00.000Z`), lte: new Date(`${hasta}T00:00:00.000Z`) },
      lineas: { some: { OR: [{ cantidad_cargada: { gt: 0 } }, { cantidad_recibida: { not: null } }] } },
    },
    include: {
      lineas: {
        where: { OR: [{ cantidad_cargada: { gt: 0 } }, { cantidad_recibida: { not: null } }] },
        include: {
          ubicaciones: { select: { id: true, nombre: true, codigo: true, orden_operativo: true } },
          products: { include: { unidad_distribucion: true } },
        },
      },
    },
    orderBy: [{ fecha_entrega: 'asc' }, { id: 'asc' }],
  });

  const resultado: {
    distribucion_id: number; estado_distribucion: string; fecha_entrega: string | null;
    ubicacion: { id: number; nombre: string; codigo: string; orden: number };
    estado: 'pendiente' | 'sin_faltantes' | 'con_faltantes'; total_faltante: number;
    lineas: { linea_id: number; product_id: number; nombre: string; unidad: string; esperado: number; recibida: number | null; faltante: number; estado_linea: string | null }[];
  }[] = [];

  for (const dist of dists) {
    const grupos = new Map<string, typeof dist.lineas>();
    for (const linea of dist.lineas) {
      const clave = linea.ubicacion_destino_id.toString();
      const grupo = grupos.get(clave) ?? [];
      grupo.push(linea);
      grupos.set(clave, grupo);
    }
    for (const lineas of grupos.values()) {
      const primera = lineas[0];
      if (!primera) continue;
      const ubicacion = primera.ubicaciones;
      const mapeadas = [...lineas].sort((a, b) => a.products.orden_operativo - b.products.orden_operativo || a.products.nombre.localeCompare(b.products.nombre, 'es')).map((l) => {
        const esperado = num(l.cantidad_cargada) ?? 0;
        const recibida = num(l.cantidad_recibida);
        return {
          linea_id: Number(l.id), product_id: Number(l.product_id), nombre: l.products.nombre,
          unidad: l.products.unidad_distribucion.nombre, esperado, recibida,
          faltante: recibida == null ? 0 : redondear3(Math.max(0, esperado - recibida)), estado_linea: l.estado_linea,
        };
      });
      const pendiente = mapeadas.some((l) => l.recibida == null);
      const totalFaltante = redondear3(mapeadas.reduce((total, l) => total + l.faltante, 0));
      resultado.push({
        distribucion_id: Number(dist.id), estado_distribucion: dist.estado,
        fecha_entrega: dist.fecha_entrega?.toISOString().slice(0, 10) ?? null,
        ubicacion: { id: Number(ubicacion.id), nombre: ubicacion.nombre, codigo: ubicacion.codigo, orden: ubicacion.orden_operativo },
        estado: pendiente ? 'pendiente' : totalFaltante > 0 ? 'con_faltantes' : 'sin_faltantes',
        total_faltante: totalFaltante,
        lineas: mapeadas,
      });
    }
  }
  return resultado.sort((a, b) => (a.fecha_entrega ?? '').localeCompare(b.fecha_entrega ?? '') || a.ubicacion.orden - b.ubicacion.orden || a.ubicacion.nombre.localeCompare(b.ubicacion.nombre, 'es'));
}

/**
 * Recepción en sucursal: por cada línea suma lo recibido a las existencias de la sucursal,
 * descuenta lo enviado del tránsito de bodega y genera una incidencia si hay diferencia.
 * Idempotente por línea. Cierra la distribución cuando todas las líneas se recibieron.
 */
export async function recibirDistribucion(
  negocioId: bigint,
  id: bigint,
  ubicacionId: bigint,
  usuarioId: bigint,
  items: { linea_id: number; cantidad: number }[],
) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
  if (!['en_transito', 'parcialmente_entregada'].includes(dist.estado)) {
    throw new HttpError(409, 'Esta distribución no está en tránsito');
  }
  if (!items.length) throw new HttpError(400, 'Incluye al menos una línea recibida');
  const ids = [...new Set(items.map((i) => i.linea_id))];
  if (ids.length !== items.length) throw new HttpError(400, 'La misma línea aparece más de una vez');
  if (items.some((i) => !Number.isFinite(i.cantidad) || i.cantidad < 0)) throw new HttpError(400, 'Las cantidades recibidas no pueden ser negativas');
  const recibidaDe = new Map(items.map((i) => [i.linea_id, i.cantidad]));

  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: id, ubicacion_destino_id: ubicacionId },
  });
  const validas = new Set(lineas.map((l) => Number(l.id)));
  if (ids.some((lineaId) => !validas.has(lineaId))) throw new HttpError(400, 'Una o más líneas no pertenecen a esta recepción');
  const bodegas = await bodegasDeProductos(negocioId, lineas.map((l) => l.product_id));

  let incidenciaEnSucursal = false;
  await prisma.$transaction(async (tx) => {
    for (const l of lineas) {
      const bodega = bodegas.get(l.product_id.toString());
      if (!bodega) throw new HttpError(400, 'No hay bodega configurada para uno de los productos');
      if (l.cantidad_recibida != null) continue; // ya recibida (idempotencia a nivel línea)
      if (!recibidaDe.has(Number(l.id))) continue;
      const recibida = Math.max(0, recibidaDe.get(Number(l.id))!);
      const enviada = num(l.cantidad_cargada) ?? 0;
      const costo = num(l.costo_unitario);

      if (enviada > 0 || recibida > 0) {
        await aplicarMovimiento(tx, {
          negocioId,
          productId: l.product_id,
          tipo: 'recepcion_parcial',
          cantidad: recibida,
          usuarioId,
          origenId: bodega.id,
          destinoId: ubicacionId,
          costoUnitario: costo,
          documentoTipo: 'distribucion',
          documentoId: id,
          comentario: 'Recepción en sucursal',
          idempotencyKey: `recepcion:${l.id}`,
          deltas: [
            { ubicacionId, productId: l.product_id, disponible: recibida, costoUnitario: costo },
            { ubicacionId: bodega.id, productId: l.product_id, transito: -enviada },
          ],
        });
      }

      const diff = redondear3(enviada - recibida);
      let incidenciaId: bigint | null = null;
      let estadoLinea = 'recibido';
      if (diff !== 0) {
        incidenciaEnSucursal = true;
        estadoLinea = recibida === 0 ? 'no_recibido' : 'incidencia';
        const inc = await tx.incidencias.create({
          data: {
            negocio_id: negocioId,
            tipo: diff > 0 ? 'faltante_recepcion' : 'sobrante_recepcion',
            prioridad: 'media',
            ubicacion_id: ubicacionId,
            documento_tipo: 'distribucion',
            documento_id: id,
            distribucion_linea_id: l.id,
            product_id: l.product_id,
            responsable_id: usuarioId,
            comentarios: `Enviado ${enviada}, recibido ${recibida} (diferencia ${diff}).`,
          },
        });
        incidenciaId = inc.id;
      }
      await tx.distribucion_lineas.update({
        where: { id: l.id },
        data: { cantidad_recibida: recibida, estado_linea: estadoLinea, incidencia_id: incidenciaId },
      });
    }

    // ¿Quedan líneas (de cualquier sucursal) sin recibir?
    const pendientes = await tx.distribucion_lineas.count({ where: { distribucion_id: id, cantidad_recibida: null } });
    const conIncidencia = await tx.distribucion_lineas.count({ where: { distribucion_id: id, incidencia_id: { not: null } } });
    const nuevoEstado = pendientes > 0 ? 'parcialmente_entregada' : conIncidencia > 0 ? 'cerrada_con_incidencias' : 'cerrada';
    await tx.distribuciones.update({ where: { id }, data: { estado: nuevoEstado } });
    await marcarPedidosDeDistribucion(tx, id, pendientes > 0 ? 'despachado' : 'entregado');
    await marcarPedidosRecibidosEnUbicacion(tx, id, ubicacionId);
    // Sella la parada de esta sucursal en la ruta (si existe).
    await sellarParadaPorRecepcion(tx, negocioId, id, ubicacionId, incidenciaEnSucursal);
  }, { isolationLevel: 'Serializable' });
  return { ok: true };
}

/**
 * Auditoría administrativa: fija el faltante final de una recepción. Sirve tanto antes de que
 * la sucursal confirme como para corregir una confirmación equivocada dentro de la semana abierta.
 */
export async function auditarFaltantesRecepcion(
  negocioId: bigint,
  id: bigint,
  ubicacionId: bigint,
  usuarioId: bigint,
  faltantes: { linea_id: number; cantidad: number }[],
) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
  if (!['en_transito', 'parcialmente_entregada', 'entregada', 'cerrada', 'cerrada_con_incidencias'].includes(dist.estado)) {
    throw new HttpError(409, 'Esta distribución todavía no está disponible para auditoría');
  }
  if (!faltantes.length) throw new HttpError(400, 'Incluye las líneas de la recepción');
  const ids = [...new Set(faltantes.map((f) => f.linea_id))];
  if (ids.length !== faltantes.length) throw new HttpError(400, 'La misma línea aparece más de una vez');
  if (faltantes.some((f) => !Number.isFinite(f.cantidad) || f.cantidad < 0)) throw new HttpError(400, 'Los faltantes no pueden ser negativos');

  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: id, ubicacion_destino_id: ubicacionId, cantidad_cargada: { gt: 0 } },
  });
  if (!lineas.length) throw new HttpError(404, 'No hay una recepción para este restaurante');
  const validas = new Set(lineas.map((l) => Number(l.id)));
  if (ids.some((lineaId) => !validas.has(lineaId))) throw new HttpError(400, 'Una o más líneas no pertenecen a esta recepción');
  const faltanteDe = new Map(faltantes.map((f) => [f.linea_id, redondear3(f.cantidad)]));
  for (const linea of lineas) {
    const enviado = num(linea.cantidad_cargada) ?? 0;
    if ((faltanteDe.get(Number(linea.id)) ?? 0) > enviado + 0.0001) throw new HttpError(400, 'Un faltante no puede superar lo enviado');
  }
  const bodegas = await bodegasDeProductos(negocioId, lineas.map((l) => l.product_id));

  await prisma.$transaction(async (tx) => {
    // Releer dentro de la transacción evita duplicar o desfasar inventario si la sucursal
    // confirma al mismo tiempo que el administrador guarda su auditoría.
    const lineasActuales = await tx.distribucion_lineas.findMany({
      where: { distribucion_id: id, ubicacion_destino_id: ubicacionId, cantidad_cargada: { gt: 0 } },
    });
    for (const linea of lineasActuales) {
      const enviada = num(linea.cantidad_cargada) ?? 0;
      const faltante = faltanteDe.get(Number(linea.id)) ?? 0;
      const nuevaRecibida = redondear3(enviada - faltante);
      const anterior = num(linea.cantidad_recibida);
      if (anterior != null && Math.abs(anterior - nuevaRecibida) < 0.0001 && ((faltante > 0) === (linea.incidencia_id != null))) continue;

      if (linea.incidencia_id) {
        await tx.incidencias.updateMany({
          where: { id: linea.incidencia_id, estado: 'abierta' },
          data: { estado: 'resuelta', resuelto_at: new Date(), resuelto_por: usuarioId },
        });
      }
      const incidencia = faltante > 0 ? await tx.incidencias.create({
        data: {
          negocio_id: negocioId, tipo: 'faltante_recepcion_auditoria', prioridad: 'media', ubicacion_id: ubicacionId,
          documento_tipo: 'distribucion', documento_id: id, distribucion_linea_id: linea.id, product_id: linea.product_id,
          responsable_id: usuarioId, comentarios: `Auditoría: enviado ${enviada}, recibido ${nuevaRecibida}, faltante ${faltante}.`,
        },
      }) : null;
      const costo = num(linea.costo_unitario);
      if (anterior == null) {
        const bodega = bodegas.get(linea.product_id.toString());
        if (!bodega) throw new HttpError(400, 'No hay bodega configurada para uno de los productos');
        await aplicarMovimiento(tx, {
          negocioId, productId: linea.product_id, tipo: 'recepcion_parcial', cantidad: nuevaRecibida, usuarioId,
          origenId: bodega.id, destinoId: ubicacionId, costoUnitario: costo, documentoTipo: 'distribucion', documentoId: id,
          comentario: 'Recepción fijada por auditoría administrativa', idempotencyKey: `recepcion:${linea.id}`,
          deltas: [
            { ubicacionId, productId: linea.product_id, disponible: nuevaRecibida, costoUnitario: costo },
            { ubicacionId: bodega.id, productId: linea.product_id, transito: -enviada },
          ],
        });
      } else {
        const delta = redondear3(nuevaRecibida - anterior);
        if (Math.abs(delta) > 0.0001) {
          await aplicarMovimiento(tx, {
            negocioId, productId: linea.product_id, tipo: 'correccion', cantidad: Math.abs(delta), usuarioId,
            origenId: delta < 0 ? ubicacionId : null, destinoId: delta > 0 ? ubicacionId : null,
            costoUnitario: costo, documentoTipo: 'distribucion', documentoId: id,
            comentario: `Corrección por auditoría: ${anterior} → ${nuevaRecibida}`,
            idempotencyKey: `auditoria-recepcion:${linea.id}:${linea.incidencia_id ?? 0}:${incidencia?.id ?? 0}:${nuevaRecibida}`,
            deltas: [{ ubicacionId, productId: linea.product_id, disponible: delta, costoUnitario: costo }],
            permitirDisponibleNegativo: true,
          });
        }
      }
      await tx.distribucion_lineas.update({
        where: { id: linea.id },
        data: { cantidad_recibida: nuevaRecibida, estado_linea: faltante > 0 ? (nuevaRecibida === 0 ? 'no_recibido' : 'incidencia') : 'recibido', incidencia_id: incidencia?.id ?? null },
      });
    }

    const pendientes = await tx.distribucion_lineas.count({ where: { distribucion_id: id, cantidad_recibida: null } });
    const conIncidencia = await tx.distribucion_lineas.count({ where: { distribucion_id: id, incidencia_id: { not: null } } });
    await tx.distribuciones.update({
      where: { id }, data: { estado: pendientes > 0 ? 'parcialmente_entregada' : conIncidencia > 0 ? 'cerrada_con_incidencias' : 'cerrada' },
    });
    await marcarPedidosDeDistribucion(tx, id, pendientes > 0 ? 'despachado' : 'entregado');
    await marcarPedidosRecibidosEnUbicacion(tx, id, ubicacionId);
    const incidenciaEnSucursal = await tx.distribucion_lineas.count({ where: { distribucion_id: id, ubicacion_destino_id: ubicacionId, incidencia_id: { not: null } } });
    await sellarParadaPorRecepcion(tx, negocioId, id, ubicacionId, incidenciaEnSucursal > 0);
  }, { isolationLevel: 'Serializable' });
  return { ok: true };
}

/** El admin puede validar de una vez todas las recepciones pendientes de una semana.
 * Equivale a confirmar que lo cargado llegó completo; las recepciones con una auditoría
 * previa no se pisan y se corrigen individualmente. */
export async function confirmarRecepcionesSinFaltantesEnRango(
  negocioId: bigint,
  usuarioId: bigint,
  desde: string,
  hasta: string,
) {
  const registros = await auditoriaRecepciones(negocioId, desde, hasta);
  // Nunca completar automáticamente una recepción que ya contiene una diferencia conocida.
  // Esos casos sí pertenecen a Auditoría y deben conservar sus faltantes capturados.
  const pendientes = registros.filter((registro) => registro.estado === 'pendiente' && registro.total_faltante <= 0);
  let confirmadas = 0;
  for (const registro of pendientes) {
    await auditarFaltantesRecepcion(
      negocioId,
      BigInt(registro.distribucion_id),
      BigInt(registro.ubicacion.id),
      usuarioId,
      registro.lineas.map((linea) => ({ linea_id: linea.linea_id, cantidad: 0 })),
    );
    confirmadas += 1;
  }
  return { confirmadas };
}

/**
 * Auto-cierre del tránsito sin confirmar: distribuciones cargadas hace más de `horas`
 * y todavía en tránsito se cierran solas dando por recibido lo enviado (recibida = cargada,
 * sin incidencia). Así el inventario "en tránsito" de la bodega no queda atascado para siempre
 * cuando una sucursal olvida confirmar. Idempotente y reutiliza recibirDistribucion.
 */
export async function autoCerrarTransitoVencido(negocioId: bigint, horas: number) {
  if (!horas || horas <= 0) return { cerradas: 0 };
  const limite = new Date(Date.now() - horas * 3600 * 1000);
  const dists = await prisma.distribuciones.findMany({
    where: {
      negocio_id: negocioId,
      estado: { in: ['en_transito', 'parcialmente_entregada'] },
      cargado_at: { not: null, lt: limite },
    },
    select: {
      id: true,
      aprobado_por: true,
      creado_por: true,
      lineas: {
        where: { cantidad_recibida: null },
        select: { id: true, ubicacion_destino_id: true, cantidad_cargada: true },
      },
    },
  });

  let cerradas = 0;
  for (const d of dists) {
    const usuarioId = d.aprobado_por ?? d.creado_por;
    // Agrupa las líneas pendientes por sucursal: recibirDistribucion trabaja por ubicación.
    const porUbic = new Map<string, { linea_id: number; cantidad: number }[]>();
    for (const l of d.lineas) {
      const k = l.ubicacion_destino_id.toString();
      if (!porUbic.has(k)) porUbic.set(k, []);
      porUbic.get(k)!.push({ linea_id: Number(l.id), cantidad: num(l.cantidad_cargada) ?? 0 });
    }
    for (const [ubic, items] of porUbic) {
      try {
        await recibirDistribucion(negocioId, d.id, BigInt(ubic), usuarioId, items);
      } catch {
        // best-effort: si una sucursal falla, seguimos con las demás y el resto del lote.
      }
    }
    cerradas += 1;
  }
  return { cerradas };
}

const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const redondear3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

// ===========================================================================
//  OPERACIÓN DE BODEGA v2 — surtir + carga en un paso (verificación opcional)
// ===========================================================================

/** Detalle operativo: líneas con todas las cantidades por etapa, agrupadas por sucursal. */
export async function operacionDetalle(negocioId: bigint, id: bigint) {
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
  const grupos = new Map<string, { ubicacion: { id: number; nombre: string }; items: unknown[] }>();
  // Carga total: suma por producto de la cantidad que va al camión, entre todas las sucursales.
  const total = new Map<string, { product_id: number; sku: string; nombre: string; unidad: string; categoria: string | null; total_aprobada: number; total_a_cargar: number; bodega_disponible: number }>();
  for (const l of lineas) {
    const k = l.ubicacion_destino_id.toString();
    if (!grupos.has(k)) grupos.set(k, { ubicacion: { id: Number(l.ubicaciones.id), nombre: l.ubicaciones.nombre }, items: [] });
    const aprobada = num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida);
    const aCargar = num(l.cantidad_cargada) ?? num(l.cantidad_verificada) ?? num(l.cantidad_preparada) ?? aprobada;
    grupos.get(k)!.items.push({
      linea_id: Number(l.id),
      product_id: Number(l.product_id),
      sku: l.products.sku,
      nombre: l.products.nombre,
      unidad: l.products.unidad_distribucion.nombre,
      categoria: l.products.categorias?.nombre ?? null,
      cantidad_aprobada: aprobada,
      cantidad_preparada: num(l.cantidad_preparada),
      cantidad_verificada: num(l.cantidad_verificada),
      cantidad_cargada: num(l.cantidad_cargada),
      cantidad_recibida: num(l.cantidad_recibida),
      estado_linea: l.estado_linea,
    });
    const pk = l.product_id.toString();
    if (!total.has(pk)) {
      total.set(pk, {
        product_id: Number(l.product_id),
        sku: l.products.sku,
        nombre: l.products.nombre,
        unidad: l.products.unidad_distribucion.nombre,
        categoria: l.products.categorias?.nombre ?? null,
        total_aprobada: 0,
        total_a_cargar: 0,
        bodega_disponible: bodega.get(pk) ?? 0,
      });
    }
    const t = total.get(pk)!;
    t.total_aprobada = redondear3(t.total_aprobada + aprobada);
    t.total_a_cargar = redondear3(t.total_a_cargar + aCargar);
  }
  // Lo que la bodega NO puede surtir (pide más de lo que hay): se marca como faltante.
  const totalCarga = [...total.values()]
    .map((t) => ({ ...t, faltante: redondear3(Math.max(0, t.total_a_cargar - t.bodega_disponible)) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return {
    id: Number(dist.id),
    nombre: dist.nombre,
    estado: dist.estado,
    linea: dist.linea_operacion,
    fecha_entrega: dist.fecha_entrega?.toISOString().slice(0, 10) ?? null,
    preparado_por: dist.preparado_por ? Number(dist.preparado_por) : null,
    verificado_por: dist.verificado_por ? Number(dist.verificado_por) : null,
    total_carga: totalCarga,
    grupos: [...grupos.values()].sort((a, b) => a.ubicacion.nombre.localeCompare(b.ubicacion.nombre, 'es')),
  };
}

async function bodegaDe(negocioId: bigint, linea?: 'carne' | 'desechables' | null) {
  const b = await bodegaCentralOpcional(negocioId, linea);
  if (!b) throw new HttpError(400, 'No hay una bodega central activa');
  return b;
}

/**
 * Surtido: guarda la cantidad que realmente se cargará por línea (campo cantidad_cargada).
 * Disponible mientras la distribución no haya salido a ruta (aprobada o verificada).
 */
export async function guardarCarga(negocioId: bigint, id: bigint, items: { linea_id: number; cantidad: number }[]) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
  if (!['aprobada', 'verificada'].includes(dist.estado)) {
    throw new HttpError(409, 'Solo se puede ajustar el surtido antes de salir a ruta');
  }
  if (!items.length) throw new HttpError(400, 'Incluye al menos una línea para surtir');
  const ids = [...new Set(items.map((i) => i.linea_id))];
  if (ids.length !== items.length) throw new HttpError(400, 'La misma línea aparece más de una vez');
  if (items.some((i) => !Number.isFinite(i.cantidad) || i.cantidad < 0)) throw new HttpError(400, 'Las cantidades a cargar no pueden ser negativas');
  const lineas = await prisma.distribucion_lineas.findMany({
      where: { id: { in: ids.map((lineaId) => BigInt(lineaId)) }, distribucion_id: id },
      select: { id: true, cantidad_aprobada: true, cantidad_sugerida: true },
    });
  if (lineas.length !== ids.length) throw new HttpError(400, 'Una o más líneas no pertenecen a este consolidado');
  const porId = new Map(lineas.map((l) => [Number(l.id), l]));
  for (const item of items) {
    const linea = porId.get(item.linea_id)!;
    const maxima = num(linea.cantidad_aprobada) ?? num0(linea.cantidad_sugerida);
    if (item.cantidad > maxima + 0.0001) throw new HttpError(400, `La carga de la línea ${item.linea_id} no puede superar las ${maxima} unidades aprobadas`);
  }
  await prisma.$transaction(
    items.map((i) => prisma.distribucion_lineas.update({ where: { id: BigInt(i.linea_id) }, data: { cantidad_cargada: i.cantidad } })),
  );
  return { ok: true, guardadas: items.length };
}

/**
 * Verificación opcional de 1 toque (sin restricción de persona). Solo aplica cuando el admin la
 * activó. Sella verificado_por/at y deja la distribución lista para confirmar carga.
 */
export async function marcarVerificada(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.fecha_entrega) await asegurarSemanaEditable(negocioId, dist.fecha_entrega.toISOString().slice(0, 10));
  if (dist.estado !== 'aprobada') throw new HttpError(409, 'Solo se verifica una distribución aprobada');
  await prisma.distribuciones.update({
    where: { id },
    data: { estado: 'verificada', verificado_por: usuarioId, verificado_at: new Date() },
  });
  return { ok: true };
}
