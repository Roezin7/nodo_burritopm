import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, usuarioPuedeUbicacion } from '../auth/middleware.js';

export const existenciasRouter = Router();

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
