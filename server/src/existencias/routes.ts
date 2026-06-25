import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole, usuarioPuedeUbicacion } from '../auth/middleware.js';
import { aplicarMovimiento } from '../ledger/service.js';

export const existenciasRouter = Router();

// Retiros directos de bodega: admin + Bodega y reparto.
const bodegaCrew = requireRole('admin', 'encargado_bodega');

async function bodegaCentral(negocioId: bigint) {
  const b = await prisma.ubicaciones.findFirst({ where: { negocio_id: negocioId, tipo: 'bodega', activo: true }, orderBy: { id: 'asc' } });
  if (!b) throw new HttpError(400, 'No hay una bodega central activa');
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
      })
      .parse(req.body);

    const negocioId = req.auth!.negocioId;
    const bodega = await bodegaCentral(negocioId);
    const producto = await prisma.products.findFirst({
      where: { id: BigInt(b.product_id), negocio_id: negocioId },
      include: { existencias: { where: { ubicacion_id: bodega.id } } },
    });
    if (!producto) throw new HttpError(404, 'Producto no encontrado');

    let destino: { id: bigint; nombre: string } | null = null;
    if (b.destino_ubicacion_id != null) {
      const d = await prisma.ubicaciones.findFirst({
        where: { id: BigInt(b.destino_ubicacion_id), negocio_id: negocioId, tipo: 'sucursal', activo: true },
        select: { id: true, nombre: true },
      });
      if (!d) throw new HttpError(400, 'La sucursal destino no es válida');
      destino = d;
    }

    const costo = num(producto.existencias[0]?.costo_promedio) ?? num(producto.ultimo_costo) ?? num(producto.costo_promedio);
    const key = `retiro:${negocioId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    await prisma.$transaction((tx) =>
      aplicarMovimiento(tx, {
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
      }),
    );

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
      })
      .parse(req.body);

    const negocioId = req.auth!.negocioId;
    const bodega = await bodegaCentral(negocioId);
    const producto = await prisma.products.findFirst({
      where: { id: BigInt(b.product_id), negocio_id: negocioId },
      include: { existencias: { where: { ubicacion_id: bodega.id } } },
    });
    if (!producto) throw new HttpError(404, 'Producto no encontrado');

    const costo = b.costo_unitario ?? num(producto.existencias[0]?.costo_promedio) ?? num(producto.ultimo_costo);
    const key = `ingreso:${negocioId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

    await prisma.$transaction(async (tx) => {
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
      if (b.costo_unitario != null) {
        await tx.products.update({ where: { id: producto.id }, data: { ultimo_costo: b.costo_unitario } });
      }
    });

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
        const disp = num0(e.cantidad_disponible);
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
    if (!(await usuarioPuedeUbicacion(req, ubicacionId))) throw new HttpError(403, 'No tienes acceso a esta ubicación');

    const filas = await prisma.existencias.findMany({
      where: { ubicacion_id: ubicacionId },
      include: { products: { include: { unidad_distribucion: true } } },
      orderBy: { products: { nombre: 'asc' } },
    });
    const items = filas.map((e) => {
      const disp = num0(e.cantidad_disponible);
      const costo = num(e.costo_promedio);
      return {
        product_id: Number(e.product_id),
        nombre: e.products.nombre,
        unidad: e.products.unidad_distribucion.nombre,
        disponible: disp,
        reservada: num0(e.cantidad_reservada),
        transito: num0(e.cantidad_transito),
        costo_promedio: costo,
        valor: costo != null ? Math.round(disp * costo * 100) / 100 : 0,
      };
    });
    res.json({ items, valor_total: Math.round(items.reduce((a, i) => a + i.valor, 0) * 100) / 100 });
  }),
);
