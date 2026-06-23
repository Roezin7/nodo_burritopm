import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import * as rutas from './rutas.service.js';

export const rutasRouter = Router();

const idParam = z.coerce.number().int().positive();
const repartidor = requireRole('repartidor', 'admin');

rutasRouter.use(requireAuth);

/** GET /rutas/mias — rutas en curso asignadas al repartidor autenticado. */
rutasRouter.get(
  '/mias',
  repartidor,
  asyncHandler(async (req, res) => {
    res.json(await rutas.rutasDelRepartidor(req.auth!.negocioId, req.auth!.usuarioId));
  }),
);

/** POST /rutas/:rid/paradas/:pid/entregar { items?, omitir?, notas? } — cierra una parada. */
rutasRouter.post(
  '/:rid/paradas/:pid/entregar',
  repartidor,
  asyncHandler(async (req, res) => {
    const rid = BigInt(idParam.parse(req.params.rid));
    const pid = BigInt(idParam.parse(req.params.pid));
    const b = z
      .object({
        items: z.array(z.object({ linea_id: z.coerce.number().int().positive(), cantidad: z.coerce.number().nonnegative() })).optional(),
        omitir: z.boolean().optional(),
        notas: z.string().trim().max(500).optional(),
      })
      .parse(req.body ?? {});
    res.json(await rutas.entregarParada(req.auth!.negocioId, rid, pid, req.auth!.usuarioId, b));
  }),
);
