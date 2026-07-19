import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole, usuarioPuedeUbicacion } from '../auth/middleware.js';
import { aplicarMovimiento } from '../ledger/service.js';
import { prepararSalidaFifo, registrarSalidaFifo } from '../inventario/fifo.js';
import { idempotencyKey } from '../lib/validation.js';
import { transaccionSerializable } from '../lib/transaccion.js';
import { randomUUID } from 'node:crypto';

export const existenciasRouter = Router();

// Retiros directos de bodega: admin + Bodega y reparto.
const bodegaCrew = requireRole('admin', 'encargado_bodega');

async function bodegaDeProducto(negocioId: bigint, linea: 'carne' | 'desechables' | null) {
  const codigo = linea === 'carne' ? 'CARN' : linea === 'desechables' ? 'BOD' : null;
  if (!codigo) throw new HttpError(400, 'El producto no tiene una línea operativa configurada');
  const b = await prisma.ubicaciones.findFirst({ where: { negocio_id: negocioId, codigo, tipo: 'bodega', activo: true } });
  if (!b) throw new HttpError(400, `No hay un almacén ${codigo} activo`);
  return b;
}

/**
 * POST /existencias/retiro { product_id, cantidad, destino_ubicacion_id?, motivo? }
 * Retiro directo de la bodega fuera del flujo normal (emergencias). Si va a una sucursal es
 * transferencia (baja bodega, sube sucursal); si no, salida directa (consumo). Mueve el ledger
 * para que el inventario no se descuadre.
 */
existenciasRouter.post(
  '/retiro',
  requireAuth,
  bodegaCrew,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        product_id: z.coerce.number().int().positive(),
        cantidad: z.coerce.number().positive(),
        destino_ubicacion_id: z.coerce.number().int().positive().nullable().optional(),
        motivo: z.string().trim().max(300).optional(),
        idempotency_key: idempotencyKey.optional(),
      })
      .parse(req.body);

    const negocioId = req.auth!.negocioId;
    const producto = await prisma.products.findFirst({
      where: { id: BigInt(b.product_id), negocio_id: negocioId },
    });
    if (!producto) throw new HttpError(404, 'Producto no encontrado');
    if (producto.es_cargo_compra) throw new HttpError(409, 'Este concepto es únicamente contable y no tiene inventario.');
    if (producto.tipo_operativo === 'materia_prima') throw new HttpError(409, 'La materia prima solo se corrige desde Compras, Producción o Inventario final para conservar sus lotes.');
    const bodega = await bodegaDeProducto(negocioId, producto.linea_operacion);
    if (req.auth!.rol !== 'admin' && !(await usuarioPuedeUbicacion(req, bodega.id))) throw new HttpError(403, 'No tienes acceso a este almacén');
    const existencia = await prisma.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: producto.id } } });

    let destino: { id: bigint; nombre: string } | null = null;
    if (b.destino_ubicacion_id != null) {
      const d = await prisma.ubicaciones.findFirst({
        where: { id: BigInt(b.destino_ubicacion_id), negocio_id: negocioId, tipo: 'sucursal', activo: true },
        select: { id: true, nombre: true },
      });
      if (!d) throw new HttpError(400, 'La sucursal destino no es válida');
      destino = d;
    }

    const key = b.idempotency_key ?? `retiro:${negocioId}:${randomUUID()}`;

    await transaccionSerializable(async (tx) => {
      const existente = await tx.movimientos_inventario.findUnique({ where: { idempotency_key: key } });
      if (existente) {
        const coincide = existente.negocio_id === negocioId && existente.usuario_id === req.auth!.usuarioId
          && existente.product_id === producto.id && existente.ubicacion_origen_id === bodega.id
          && existente.ubicacion_destino_id === (destino?.id ?? null) && num0(existente.cantidad) === b.cantidad
          && existente.documento_tipo === 'retiro' && (existente.comentario ?? null) === (b.motivo ?? null);
        if (!coincide) throw new HttpError(409, 'Esta llave de captura ya fue usada por un retiro diferente.');
        return;
      }
      const fifo = producto.linea_operacion === 'desechables'
        ? await prepararSalidaFifo(tx, { negocioId, ubicacionId: bodega.id, productId: producto.id, cantidad: b.cantidad, producto: producto.nombre })
        : null;
      const costo = fifo?.costo_unitario ?? num(existencia?.costo_promedio) ?? num(producto.ultimo_costo) ?? num(producto.costo_promedio);
      const aplicada = await aplicarMovimiento(tx, {
        negocioId,
        productId: producto.id,
        tipo: destino ? 'transferencia' : 'consumo',
        cantidad: b.cantidad,
        usuarioId: req.auth!.usuarioId,
        origenId: bodega.id,
        destinoId: destino?.id ?? null,
        costoUnitario: costo,
        documentoTipo: 'retiro',
        comentario: b.motivo,
        idempotencyKey: key,
        deltas: destino
          ? [
              { ubicacionId: bodega.id, productId: producto.id, disponible: -b.cantidad },
              { ubicacionId: destino.id, productId: producto.id, disponible: b.cantidad, costoUnitario: costo },
            ]
          : [{ ubicacionId: bodega.id, productId: producto.id, disponible: -b.cantidad }],
      });
      if (aplicada && fifo) {
        const movimiento = await tx.movimientos_inventario.findUnique({ where: { idempotency_key: key }, select: { id: true } });
        if (!movimiento) throw new HttpError(500, 'No se pudo vincular el retiro a sus lotes FIFO');
        await registrarSalidaFifo(tx, { movimientoId: movimiento.id, ubicacionId: bodega.id, productId: producto.id, consumos: fifo.consumos });
      }
    }, { reintentarUnico: true });

    res.status(201).json({ ok: true, destino: destino?.nombre ?? null });
  }),
);

/**
 * POST /existencias/ingreso { product_id, cantidad, costo_unitario?, motivo? }
 * Entrada de inventario a la bodega (compra/recepción de proveedor). Sube la disponibilidad
 * de bodega y recalcula el costo promedio; si llega costo, actualiza el último costo del producto.
 */
existenciasRouter.post(
  '/ingreso',
  requireAuth,
  bodegaCrew,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        product_id: z.coerce.number().int().positive(),
        cantidad: z.coerce.number().positive(),
        costo_unitario: z.coerce.number().nonnegative().nullable().optional(),
        motivo: z.string().trim().max(300).optional(),
        idempotency_key: idempotencyKey.optional(),
      })
      .parse(req.body);

    const negocioId = req.auth!.negocioId;
    const producto = await prisma.products.findFirst({
      where: { id: BigInt(b.product_id), negocio_id: negocioId },
    });
    if (!producto) throw new HttpError(404, 'Producto no encontrado');
    if (producto.es_cargo_compra) throw new HttpError(409, 'Este concepto es únicamente contable y no tiene inventario.');
    if (producto.tipo_operativo === 'materia_prima') throw new HttpError(409, 'Registra la materia prima en Compras para crear el lote con cajas, peso y costo.');
    const bodega = await bodegaDeProducto(negocioId, producto.linea_operacion);
    if (req.auth!.rol !== 'admin' && !(await usuarioPuedeUbicacion(req, bodega.id))) throw new HttpError(403, 'No tienes acceso a este almacén');
    const existencia = await prisma.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: producto.id } } });

    const costo = b.costo_unitario ?? num(existencia?.costo_promedio) ?? num(producto.ultimo_costo);
    if (producto.linea_operacion === 'desechables' && costo == null) {
      throw new HttpError(400, 'Indica el costo unitario para crear el lote FIFO de desechables.');
    }
    const key = b.idempotency_key ?? `ingreso:${negocioId}:${randomUUID()}`;

    await transaccionSerializable(async (tx) => {
      const existente = await tx.movimientos_inventario.findUnique({ where: { idempotency_key: key } });
      if (existente) {
        const coincide = existente.negocio_id === negocioId && existente.usuario_id === req.auth!.usuarioId
          && existente.product_id === producto.id && existente.ubicacion_destino_id === bodega.id
          && num0(existente.cantidad) === b.cantidad && existente.documento_tipo === 'ingreso'
          && (b.costo_unitario == null || num(existente.costo_unitario) === b.costo_unitario)
          && (existente.comentario ?? null) === (b.motivo ?? null);
        if (!coincide) throw new HttpError(409, 'Esta llave de captura ya fue usada por un ingreso diferente.');
        return;
      }
      await aplicarMovimiento(tx, {
        negocioId,
        productId: producto.id,
        tipo: 'compra_recibida',
        cantidad: b.cantidad,
        usuarioId: req.auth!.usuarioId,
        destinoId: bodega.id,
        costoUnitario: costo,
        documentoTipo: 'ingreso',
        comentario: b.motivo,
        idempotencyKey: key,
        deltas: [{ ubicacionId: bodega.id, productId: producto.id, disponible: b.cantidad, costoUnitario: costo }],
      });
      if (producto.linea_operacion === 'desechables') {
        await tx.lotes_materia_prima.create({
          data: {
            negocio_id: negocioId, ubicacion_id: bodega.id, product_id: producto.id,
            fecha: new Date(), congelado: false,
            cajas_iniciales: b.cantidad, cajas_disponibles: b.cantidad,
            peso_inicial_lb: 0, peso_disponible_lb: 0,
            costo_inicial: Math.round(b.cantidad * costo! * 100) / 100,
            costo_disponible: Math.round(b.cantidad * costo! * 100) / 100,
          },
        });
      }
      if (b.costo_unitario != null) {
        // El precio del producto sigue a la compra: último costo = lo que se pagó ahora,
        // y el costo promedio del catálogo se alinea con el promedio ponderado de bodega.
        const ex = await tx.existencias.findUnique({
          where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: producto.id } },
          select: { costo_promedio: true },
        });
        await tx.products.update({
          where: { id: producto.id },
          data: { ultimo_costo: b.costo_unitario, costo_promedio: ex?.costo_promedio ?? b.costo_unitario },
        });
      }
    }, { reintentarUnico: true });

    res.status(201).json({ ok: true });
  }),
);

/** GET /existencias/movimientos?tipo=ingreso|retiro — últimos movimientos directos de bodega. */
existenciasRouter.get(
  '/movimientos',
  requireAuth,
  bodegaCrew,
  asyncHandler(async (req, res) => {
    const tipo = z.enum(['ingreso', 'retiro']).catch('retiro').parse(req.query.tipo);
    const movs = await prisma.movimientos_inventario.findMany({
      where: { negocio_id: req.auth!.negocioId, documento_tipo: tipo },
      include: {
        products: { include: { unidad_distribucion: true } },
        ubicacion_destino: { select: { nombre: true } },
      },
      orderBy: { id: 'desc' },
      take: 50,
    });
    res.json(
      movs.map((m) => ({
        id: Number(m.id),
        tipo,
        fecha: m.fecha.toISOString(),
        producto: m.products.nombre,
        unidad: m.products.unidad_distribucion.nombre,
        cantidad: num0(m.cantidad),
        destino: tipo === 'retiro' ? (m.ubicacion_destino?.nombre ?? null) : null,
        motivo: m.comentario,
      })),
    );
  }),
);


/**
 * GET /existencias/valuacion — valor del inventario EN VIVO por ubicación (admin).
 * Cuánto dinero hay parado en cada sucursal y en la bodega, según existencias actuales.
 */
existenciasRouter.get(
  '/valuacion',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const negocioId = req.auth!.negocioId;
    const ubicaciones = await prisma.ubicaciones.findMany({
      where: { negocio_id: negocioId, activo: true },
      orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
      include: { existencias: { select: { cantidad_disponible: true, costo_promedio: true } } },
    });
    const filas = ubicaciones.map((u) => {
      let valor = 0;
      let skus = 0;
      for (const e of u.existencias) {
        const disp = Math.max(0, num0(e.cantidad_disponible));
        if (disp > 0) skus++;
        const costo = num(e.costo_promedio);
        if (costo != null) valor += disp * costo;
      }
      return { id: Number(u.id), nombre: u.nombre, tipo: u.tipo, skus, valor: Math.round(valor * 100) / 100 };
    });
    res.json({ ubicaciones: filas, valor_total: Math.round(filas.reduce((a, f) => a + f.valor, 0) * 100) / 100 });
  }),
);

/** GET /existencias?ubicacion=ID — saldo actual por producto en una ubicación. */
existenciasRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ubicacionId = BigInt(z.coerce.number().int().positive().parse(req.query.ubicacion));
    const semanaReferencia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(req.query.semana);
    if (!(await usuarioPuedeUbicacion(req, ubicacionId))) throw new HttpError(403, 'No tienes acceso a esta ubicación');

    const ubicacion = await prisma.ubicaciones.findFirst({ where: { id: ubicacionId, negocio_id: req.auth!.negocioId } });
    if (!ubicacion) throw new HttpError(404, 'Ubicación no encontrada');
    const linea = ubicacion.codigo === 'CARN' ? 'carne' : ubicacion.codigo === 'BOD' ? 'desechables' : undefined;
    const diaSemana = semanaReferencia ? new Date(`${semanaReferencia}T00:00:00.000Z`) : null;
    const semana = diaSemana ? await prisma.semanas_operativas.findFirst({
      where: { negocio_id: req.auth!.negocioId, inicia_at: { lte: diaSemana }, termina_at: { gte: diaSemana } },
      select: { id: true, estado: true },
    }) : null;
    const snapshot = semana ? await prisma.inventario_semanal.findMany({ where: { semana_id: semana.id, ubicacion_id: ubicacionId } }) : [];
    const usarSnapshot = semana?.estado === 'cerrada';
    const snapshotIds = snapshot.map((e) => e.product_id);
    const [productos, filas] = await Promise.all([
      prisma.products.findMany({
        where: {
          negocio_id: req.auth!.negocioId,
          linea_operacion: linea,
          es_cargo_compra: false,
          OR: snapshotIds.length ? [{ activo: true }, { id: { in: snapshotIds } }] : [{ activo: true }],
        },
        include: { unidad_distribucion: true },
        orderBy: [{ linea_operacion: 'asc' }, { orden_operativo: 'asc' }, { nombre: 'asc' }],
      }),
      usarSnapshot ? Promise.resolve(snapshot) : prisma.existencias.findMany({ where: { ubicacion_id: ubicacionId } }),
    ]);
    const porProducto = new Map(filas.map((e) => [e.product_id.toString(), e]));
    const items = productos.map((producto) => {
      const e = porProducto.get(producto.id.toString());
      const saldoReal = num0(e?.cantidad_disponible);
      const disp = Math.max(0, saldoReal);
      const transito = Math.max(0, num0(e?.cantidad_transito));
      const costo = num(e?.costo_promedio) ?? (usarSnapshot ? null : num(producto.ultimo_costo) ?? num(producto.costo_promedio));
      return {
        product_id: Number(producto.id),
        nombre: producto.nombre,
        sku: producto.sku,
        linea: producto.linea_operacion,
        tipo: producto.tipo_operativo,
        unidad: producto.unidad_distribucion.nombre,
        disponible: disp,
        reservada: Math.max(0, num0(e?.cantidad_reservada)),
        transito,
        faltante: Math.max(0, -saldoReal),
        costo_promedio: costo,
        valor: costo != null ? Math.round((disp + transito) * costo * 100) / 100 : 0,
      };
    });
    res.json({
      items,
      valor_total: Math.round(items.reduce((a, i) => a + i.valor, 0) * 100) / 100,
      cajas_perdidas: Math.round(items.reduce((a, i) => a + i.faltante, 0) * 1000) / 1000,
      fuente: usarSnapshot ? 'cierre_semanal' : 'actual',
      semana_estado: semana?.estado ?? null,
    });
  }),
);
