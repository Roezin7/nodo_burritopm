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
      select: { id: true, nombre: true, zona_horaria: true, verificacion_carga: true },
    });
    if (!n) throw new HttpError(404, 'Negocio no encontrado');
    res.json({ id: Number(n.id), nombre: n.nombre, zona_horaria: n.zona_horaria, verificacion_carga: n.verificacion_carga });
  }),
);

/** PATCH /negocio { verificacion_carga } — solo admin. */
negocioRouter.patch(
  '/',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ verificacion_carga: z.boolean() }).parse(req.body);
    await prisma.negocios.update({ where: { id: req.auth!.negocioId }, data: { verificacion_carga: b.verificacion_carga } });
    res.json({ ok: true, verificacion_carga: b.verificacion_carga });
  }),
);
