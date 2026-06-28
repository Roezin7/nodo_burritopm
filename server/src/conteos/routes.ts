import { Router, type Request } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole, soloAdmin, usuarioPuedeUbicacion } from '../auth/middleware.js';
import * as svc from './service.js';

export const conteosRouter = Router();

const idParam = z.coerce.number().int().positive();

// Quién puede operar conteos (además del admin): bodega y sucursal.
const puedeContar = requireRole('admin', 'encargado_bodega', 'encargado_sucursal');

/** Verifica acceso a una ubicación (lanza 403). */
async function exigirUbicacion(req: Request, ubicacionId: bigint) {
  if (!(await usuarioPuedeUbicacion(req, ubicacionId))) {
    throw new HttpError(403, 'No tienes acceso a esta ubicación');
  }
}

/** Carga el conteo del negocio y valida acceso a su ubicación. */
async function conteoConAcceso(req: Request, conteoId: bigint) {
  const conteo = await prisma.conteos.findFirst({
    where: { id: conteoId, negocio_id: req.auth!.negocioId },
    select: { id: true, ubicacion_id: true },
  });
  if (!conteo) throw new HttpError(404, 'Conteo no encontrado');
  await exigirUbicacion(req, conteo.ubicacion_id);
  return conteo;
}

/** GET /conteos?ubicacion=ID — lista de conteos de una ubicación. */
conteosRouter.get(
  '/',
  requireAuth,
  puedeContar,
  asyncHandler(async (req, res) => {
    const ubicacionId = BigInt(idParam.parse(req.query.ubicacion));
    await exigirUbicacion(req, ubicacionId);
    res.json(await svc.listarConteos(req.auth!.negocioId, ubicacionId));
  }),
);

/** GET /conteos/sesion?ubicacion=ID — estado de la sesión de inventario de hoy. */
conteosRouter.get(
  '/sesion',
  requireAuth,
  puedeContar,
  asyncHandler(async (req, res) => {
    const ubicacionId = BigInt(idParam.parse(req.query.ubicacion));
    await exigirUbicacion(req, ubicacionId);
    res.json(await svc.sesionDeHoy(req.auth!.negocioId, ubicacionId));
  }),
);

/** POST /conteos/abrir { ubicacion_id } — abre/continúa el inventario de HOY de la ubicación. */
conteosRouter.post(
  '/abrir',
  requireAuth,
  puedeContar,
  asyncHandler(async (req, res) => {
    const { ubicacion_id } = z.object({ ubicacion_id: z.coerce.number().int().positive() }).parse(req.body);
    const ubicacionId = BigInt(ubicacion_id);
    await exigirUbicacion(req, ubicacionId);
    res.status(201).json(await svc.abrirConteoDeHoy(req.auth!.negocioId, ubicacionId, req.auth!.usuarioId));
  }),
);

/** GET /conteos/:id — detalle con líneas. */
conteosRouter.get(
  '/:id',
  requireAuth,
  puedeContar,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await conteoConAcceso(req, id);
    res.json(await svc.detalleConteo(req.auth!.negocioId, id));
  }),
);

const lineaSchema = z.object({
  product_id: z.coerce.number().int().positive(),
  qty: z.coerce.number().nonnegative().optional(),
  contado: z.boolean().optional(),
  comentario: z.string().nullable().optional(),
});

/** PATCH /conteos/:id/lineas { lineas[] } — guarda avance. */
conteosRouter.patch(
  '/:id/lineas',
  requireAuth,
  puedeContar,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await conteoConAcceso(req, id);
    const { lineas } = z.object({ lineas: z.array(lineaSchema) }).parse(req.body);
    res.json(await svc.guardarLineas(req.auth!.negocioId, id, lineas));
  }),
);

/** POST /conteos/:id/cerrar — cierra el conteo. */
conteosRouter.post(
  '/:id/cerrar',
  requireAuth,
  puedeContar,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await conteoConAcceso(req, id);
    res.json(await svc.cerrarConteo(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);

/** POST /conteos/:id/reabrir — reabre un conteo cerrado (solo admin). */
conteosRouter.post(
  '/:id/reabrir',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await conteoConAcceso(req, id);
    res.json(await svc.reabrirConteo(req.auth!.negocioId, id));
  }),
);

/** DELETE /conteos/:id — elimina el inventario y revierte su efecto en el stock (solo admin). */
conteosRouter.delete(
  '/:id',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await conteoConAcceso(req, id);
    res.json(await svc.eliminarConteo(req.auth!.negocioId, id));
  }),
);
