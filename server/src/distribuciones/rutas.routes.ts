import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, requireRole, soloAdmin } from '../auth/middleware.js';
import * as rutas from './rutas.service.js';

export const rutasRouter = Router();

const idParam = z.coerce.number().int().positive();
const fechaParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangoQuery = z.object({ desde: fechaParam.optional(), hasta: fechaParam.optional() });
// Rol unificado "Bodega y reparto": el encargado de bodega también ejecuta la ruta.
const repartidor = requireRole('encargado_bodega', 'admin');

rutasRouter.use(requireAuth);

/** GET /rutas/activas — monitor del admin: todas las rutas en curso. */
rutasRouter.get(
  '/activas',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const q = rangoQuery.parse(req.query);
    res.json(await rutas.rutasActivas(req.auth!.negocioId, q.desde, q.hasta));
  }),
);

/** GET /rutas/mias — rutas en curso asignadas al repartidor autenticado. */
rutasRouter.get(
  '/mias',
  repartidor,
  asyncHandler(async (req, res) => {
    const q = rangoQuery.parse(req.query);
    res.json(await rutas.rutasDelRepartidor(req.auth!.negocioId, req.auth!.usuarioId, q.desde, q.hasta));
  }),
);

/** GET /rutas/historial — rutas ya completadas (Bodega y reparto + admin). */
rutasRouter.get(
  '/historial',
  repartidor,
  asyncHandler(async (req, res) => {
    const q = rangoQuery.parse(req.query);
    res.json(await rutas.rutasHistorial(req.auth!.negocioId, 100, q.desde, q.hasta));
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
