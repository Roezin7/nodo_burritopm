import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { valor } from './logic.js';
import { aplicarMovimiento } from '../ledger/service.js';
import { asegurarRutaEnCurso, sellarParadaPorRecepcion } from './rutas.service.js';
import { avisarPedidoEnCamino } from '../push/service.js';

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
  const enPedido = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: id },
    select: { ubicacion_destino_id: true },
    distinct: ['ubicacion_destino_id'],
  });
  const yaIds = new Set(enPedido.map((l) => l.ubicacion_destino_id.toString()));
  const sucursales = await prisma.ubicaciones.findMany({ where: { negocio_id: negocioId, tipo: 'sucursal', activo: true } });
  const candidatas = [];
  for (const s of sucursales) {
    if (yaIds.has(s.id.toString())) continue;
    const cerrado = await prisma.conteos.findFirst({ where: { ubicacion_id: s.id, estado: 'cerrado' }, select: { id: true } });
    if (cerrado) candidatas.push({ id: Number(s.id), nombre: s.nombre });
  }
  return candidatas;
}

/**
 * Suma una o más sucursales rezagadas a un pedido aún editable sin rehacerlo: calcula solo
 * las líneas de esas sucursales y las anexa, dejando intactas las líneas (y ajustes) ya cargadas.
 */
export async function agregarSucursales(negocioId: bigint, id: bigint, ubicacionIds: number[]) {
  const dist = await cargarDistribucion(negocioId, id);
  if (!ESTADOS_EDITABLES.includes(dist.estado)) {
    throw new HttpError(409, 'Solo se pueden agregar sucursales a un pedido en cálculo o revisión (aún sin aprobar).');
  }
  const enPedido = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: id },
    select: { ubicacion_destino_id: true },
    distinct: ['ubicacion_destino_id'],
  });
  const yaIds = new Set(enPedido.map((l) => l.ubicacion_destino_id.toString()));

  const sucursales = (await prisma.ubicaciones.findMany({
    where: { negocio_id: negocioId, tipo: 'sucursal', activo: true, id: { in: ubicacionIds.map((n) => BigInt(n)) } },
  })).filter((s) => !yaIds.has(s.id.toString()));
  if (sucursales.length === 0) throw new HttpError(400, 'Esas sucursales ya están en el pedido o no existen.');

  const { lineasData, sinPedido } = await calcularLineasSucursales(sucursales);

  if (lineasData.length === 0) {
    const partes: string[] = [];
    if (sinPedido.length) partes.push(`Sin pedido cerrado: ${sinPedido.join(', ')}.`);
    throw new HttpError(400, partes.length ? `No hay nada que agregar. ${partes.join(' ')}` : 'No hay nada que agregar para esas sucursales.');
  }

  await prisma.distribucion_lineas.createMany({ data: lineasData.map((l) => ({ distribucion_id: id, ...l })) });
  const agregadas = [...new Set(lineasData.map((l) => l.ubicacion_destino_id.toString()))]
    .map((uid) => sucursales.find((s) => s.id.toString() === uid)?.nombre)
    .filter((n): n is string => Boolean(n));
  return { agregadas, lineas: lineasData.length, sin_conteo: sinPedido };
}

/** Control total del admin: fija el estado de la distribución a cualquier valor (override). */
export async function cambiarEstadoAdmin(negocioId: bigint, id: bigint, estado: EstadoDistribucionValor) {
  await cargarDistribucion(negocioId, id);
  await prisma.distribuciones.update({ where: { id }, data: { estado } });
  return { ok: true, estado };
}

export type EstadoDistribucionValor =
  | 'borrador' | 'esperando_conteos' | 'calculada' | 'en_revision' | 'aprobada'
  | 'en_preparacion' | 'preparada' | 'verificada' | 'en_carga' | 'cargada'
  | 'en_transito' | 'parcialmente_entregada' | 'entregada' | 'cerrada'
  | 'cerrada_con_incidencias' | 'cancelada';

export async function listarDistribuciones(negocioId: bigint) {
  const ds = await prisma.distribuciones.findMany({
    where: { negocio_id: negocioId },
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
  await cargarDistribucion(negocioId, id);
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });
  const bodegas = await bodegasDeProductos(negocioId, lineas.map((l) => l.product_id));
  const sello = Date.now(); // permite distinguir reversas si se reintenta
  // Pedidos de sucursal que originaron las líneas (únicos, sin nulos).
  const conteoIds = [...new Map(lineas.filter((l) => l.conteo_id != null).map((l) => [l.conteo_id!.toString(), l.conteo_id!])).values()];

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

/** Aprueba juntas todas las preparaciones editables de un rango semanal. */
export async function aprobarDistribucionesEnRango(
  negocioId: bigint,
  usuarioId: bigint,
  desde: string,
  hasta: string,
) {
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
 * Confirma la carga del camión: lo verificado (o lo cargado ajustado) sale de la bodega
 * y pasa a tránsito. Registra un movimiento de transferencia por línea (idempotente).
 */
export async function confirmarCarga(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  // Flujo v2: se carga directo desde "aprobada" (o desde "verificada" si el admin activó
  // la verificación opcional de 1 toque). Sin reservas ni etapas intermedias.
  if (!['aprobada', 'verificada'].includes(dist.estado)) {
    throw new HttpError(409, 'Solo se carga una distribución aprobada o verificada');
  }
  // Si la verificación está activa, no se carga sin haber verificado primero.
  const negocio = await prisma.negocios.findUnique({ where: { id: negocioId }, select: { verificacion_carga: true } });
  if (negocio?.verificacion_carga && dist.estado !== 'verificada') {
    throw new HttpError(409, 'La verificación de carga está activa: verifica antes de cargar');
  }
  const lineas = await prisma.distribucion_lineas.findMany({ where: { distribucion_id: id } });
  const bodegas = await bodegasDeProductos(negocioId, lineas.map((l) => l.product_id));

  // Tope por producto: la bodega no puede cargar más de lo que tiene en existencias. Vamos
  // descontando del "restante" línea por línea (orden estable por id) para que la suma cargada
  // de cada producto nunca exceda lo disponible → el inventario no se descuadra (sin negativos).
  const restante = await disponibleBodega(negocioId);
  let totalCargado = 0;
  const sucursalesConCarga = new Set<string>(); // solo estas serán paradas de la ruta

  await prisma.$transaction(async (tx) => {
    for (const l of [...lineas].sort((a, b) => Number(a.id - b.id))) {
      const bodega = bodegas.get(l.product_id.toString());
      if (!bodega) throw new HttpError(400, 'No hay bodega configurada para uno de los productos');
      const pedida = num(l.cantidad_cargada) ?? num(l.cantidad_verificada) ?? num(l.cantidad_aprobada) ?? num0(l.cantidad_sugerida);
      const pk = l.product_id.toString();
      const disp = redondear3(restante.get(pk) ?? 0);
      const cargada = Math.max(0, Math.min(pedida, disp)); // nunca más de lo disponible
      restante.set(pk, redondear3(disp - cargada));
      const costo = num(l.costo_unitario);

      // Lo realmente cargado sale de disponible y entra a tránsito (movimiento idempotente).
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
          comentario: 'Carga al camión (salida de bodega)',
          idempotencyKey: `carga:${l.id}`,
          deltas: [{ ubicacionId: bodega.id, productId: l.product_id, disponible: -cargada, transito: cargada }],
        });
      }
      // Persistimos lo realmente cargado (clamp): es lo que viaja y lo que la sucursal recibirá.
      await tx.distribucion_lineas.update({ where: { id: l.id }, data: { cantidad_cargada: cargada } });
    }
    // Sin existencias en bodega no hay nada que salga: no se genera tránsito ni ruta (rollback).
    if (totalCargado <= 0) {
      throw new HttpError(409, 'No hay existencias en la bodega central para surtir esta distribución. Registra un ingreso antes de cargar.');
    }
    await tx.distribuciones.update({ where: { id }, data: { estado: 'en_transito', cargado_por: usuarioId, cargado_at: new Date() } });
    // El camión cargado pone la ruta en curso (la crea si no se planeó una). Solo las sucursales
    // que de verdad recibieron carga se convierten en paradas.
    await asegurarRutaEnCurso(tx, negocioId, id, usuarioId, sucursalesConCarga);
  });
  void avisarPedidoEnCamino(id).catch(() => {}); // aviso best-effort a las sucursales
  return { ok: true };
}

/** Distribuciones en tránsito con líneas destinadas a una sucursal (para recepción). */
export async function recepcionesPendientes(negocioId: bigint, ubicacionId: bigint) {
  const dists = await prisma.distribuciones.findMany({
    where: {
      negocio_id: negocioId,
      estado: { in: ['en_transito', 'parcialmente_entregada'] },
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
export async function recepcionesHistorial(negocioId: bigint, ubicacionId: bigint) {
  const dists = await prisma.distribuciones.findMany({
    where: {
      negocio_id: negocioId,
      estado: { in: ['entregada', 'cerrada', 'cerrada_con_incidencias'] },
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
  if (!['en_transito', 'parcialmente_entregada'].includes(dist.estado)) {
    throw new HttpError(409, 'Esta distribución no está en tránsito');
  }
  const recibidaDe = new Map(items.map((i) => [i.linea_id, i.cantidad]));

  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: id, ubicacion_destino_id: ubicacionId },
  });
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
    // Sella la parada de esta sucursal en la ruta (si existe).
    await sellarParadaPorRecepcion(tx, negocioId, id, ubicacionId, incidenciaEnSucursal);
  });
  return { ok: true };
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
    estado: dist.estado,
    linea: dist.linea_operacion,
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
  if (!['aprobada', 'verificada'].includes(dist.estado)) {
    throw new HttpError(409, 'Solo se puede ajustar el surtido antes de salir a ruta');
  }
  const validas = new Set(
    (await prisma.distribucion_lineas.findMany({
      where: { id: { in: items.map((a) => BigInt(a.linea_id)) }, distribucion_id: id },
      select: { id: true },
    })).map((l) => l.id.toString()),
  );
  await prisma.$transaction(
    items
      .filter((i) => validas.has(i.linea_id.toString()))
      .map((i) => prisma.distribucion_lineas.update({ where: { id: BigInt(i.linea_id) }, data: { cantidad_cargada: i.cantidad } })),
  );
  return { ok: true, guardadas: items.length };
}

/**
 * Verificación opcional de 1 toque (sin restricción de persona). Solo aplica cuando el admin la
 * activó. Sella verificado_por/at y deja la distribución lista para confirmar carga.
 */
export async function marcarVerificada(negocioId: bigint, id: bigint, usuarioId: bigint) {
  const dist = await cargarDistribucion(negocioId, id);
  if (dist.estado !== 'aprobada') throw new HttpError(409, 'Solo se verifica una distribución aprobada');
  await prisma.distribuciones.update({
    where: { id },
    data: { estado: 'verificada', verificado_por: usuarioId, verificado_at: new Date() },
  });
  return { ok: true };
}
