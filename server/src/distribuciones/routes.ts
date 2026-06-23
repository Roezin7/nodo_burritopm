import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import * as svc from './service.js';

export const distribucionesRouter = Router();

const idParam = z.coerce.number().int().positive();

// Toda la distribución es del admin general.
distribucionesRouter.use(requireAuth, soloAdmin);

/** GET /distribuciones — lista. */
distribucionesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await svc.listarDistribuciones(req.auth!.negocioId));
  }),
);

/** POST /distribuciones { ubicacion_ids? } — calcula y crea el consolidado. */
distribucionesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = z.object({ ubicacion_ids: z.array(z.coerce.number().int().positive()).optional() }).parse(req.body ?? {});
    res.status(201).json(await svc.crearDistribucion(req.auth!.negocioId, req.auth!.usuarioId, b.ubicacion_ids));
  }),
);

/** GET /distribuciones/:id/consolidado?vista=producto|sucursal */
distribucionesRouter.get(
  '/:id/consolidado',
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const vista = z.enum(['producto', 'sucursal']).catch('producto').parse(req.query.vista);
    res.json(await svc.consolidado(req.auth!.negocioId, id, vista));
  }),
);

/** PATCH /distribuciones/:id/lineas { ajustes: [{linea_id, cantidad_aprobada}] } */
distribucionesRouter.patch(
  '/:id/lineas',
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = z
      .object({
        ajustes: z.array(z.object({ linea_id: z.coerce.number().int().positive(), cantidad_aprobada: z.coerce.number().nonnegative() })),
      })
      .parse(req.body);
    res.json(await svc.ajustarLineas(req.auth!.negocioId, id, b.ajustes));
  }),
);

/** POST /distribuciones/:id/aprobar */
distribucionesRouter.post(
  '/:id/aprobar',
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.aprobarDistribucion(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);
