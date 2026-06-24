import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';

export const negocioRouter = Router();

negocioRouter.use(requireAuth);

/** GET /negocio — settings de operación (cualquier usuario autenticado los lee). */
negocioRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const n = await prisma.negocios.findUnique({
      where: { id: req.auth!.negocioId },
      select: { id: true, nombre: true, zona_horaria: true, verificacion_carga: true, inventario_dias: true },
    });
    if (!n) throw new HttpError(404, 'Negocio no encontrado');
    res.json({
      id: Number(n.id),
      nombre: n.nombre,
      zona_horaria: n.zona_horaria,
      verificacion_carga: n.verificacion_carga,
      inventario_dias: [...n.inventario_dias].sort((a, b) => a - b),
    });
  }),
);

/** PATCH /negocio { verificacion_carga?, inventario_dias? } — solo admin. */
negocioRouter.patch(
  '/',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        verificacion_carga: z.boolean().optional(),
        inventario_dias: z.array(z.coerce.number().int().min(0).max(6)).optional(),
      })
      .parse(req.body);
    const data: { verificacion_carga?: boolean; inventario_dias?: number[] } = {};
    if (b.verificacion_carga !== undefined) data.verificacion_carga = b.verificacion_carga;
    if (b.inventario_dias !== undefined) data.inventario_dias = [...new Set(b.inventario_dias)].sort((a, b2) => a - b2);
    await prisma.negocios.update({ where: { id: req.auth!.negocioId }, data });
    res.json({ ok: true, ...data });
  }),
);
