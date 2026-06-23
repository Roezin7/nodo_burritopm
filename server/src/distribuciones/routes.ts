import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole, soloAdmin, usuarioPuedeUbicacion } from '../auth/middleware.js';
import * as svc from './service.js';

export const distribucionesRouter = Router();

const idParam = z.coerce.number().int().positive();
const sucursal = requireRole('admin', 'encargado_sucursal');

// La planeación (calcular/aprobar) es del admin; la operación de bodega la hace
// también el encargado de bodega; la recepción la hace la sucursal. Cada ruta declara su guard.
distribucionesRouter.use(requireAuth);
const bodega = requireRole('admin', 'encargado_bodega');
const etapaSchema = z.object({ items: z.array(z.object({ linea_id: z.coerce.number().int().positive(), cantidad: z.coerce.number().nonnegative() })) });

/** GET /distribuciones/recepciones?ubicacion=ID — pendientes de recibir en una sucursal. */
distribucionesRouter.get(
  '/recepciones',
  sucursal,
  asyncHandler(async (req, res) => {
    const ubicacionId = BigInt(idParam.parse(req.query.ubicacion));
    if (!(await usuarioPuedeUbicacion(req, ubicacionId))) throw new HttpError(403, 'No tienes acceso a esta ubicación');
    res.json(await svc.recepcionesPendientes(req.auth!.negocioId, ubicacionId));
  }),
);

/** POST /distribuciones/:id/recibir { ubicacion_id, items } — recepción en sucursal. */
distribucionesRouter.post(
  '/:id/recibir',
  sucursal,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = z
      .object({
        ubicacion_id: z.coerce.number().int().positive(),
        items: z.array(z.object({ linea_id: z.coerce.number().int().positive(), cantidad: z.coerce.number().nonnegative() })),
      })
      .parse(req.body);
    const ubicacionId = BigInt(b.ubicacion_id);
    if (!(await usuarioPuedeUbicacion(req, ubicacionId))) throw new HttpError(403, 'No tienes acceso a esta ubicación');
    res.json(await svc.recibirDistribucion(req.auth!.negocioId, id, ubicacionId, req.auth!.usuarioId, b.items));
  }),
);

/** GET /distribuciones — lista (admin y bodega). */
distribucionesRouter.get(
  '/',
  bodega,
  asyncHandler(async (req, res) => {
    res.json(await svc.listarDistribuciones(req.auth!.negocioId));
  }),
);

/** POST /distribuciones { ubicacion_ids? } — calcula y crea el consolidado. */
distribucionesRouter.post(
  '/',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ ubicacion_ids: z.array(z.coerce.number().int().positive()).optional() }).parse(req.body ?? {});
    res.status(201).json(await svc.crearDistribucion(req.auth!.negocioId, req.auth!.usuarioId, b.ubicacion_ids));
  }),
);

/** GET /distribuciones/:id/consolidado?vista=producto|sucursal */
distribucionesRouter.get(
  '/:id/consolidado',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const vista = z.enum(['producto', 'sucursal']).catch('producto').parse(req.query.vista);
    res.json(await svc.consolidado(req.auth!.negocioId, id, vista));
  }),
);

/** PATCH /distribuciones/:id/lineas { ajustes: [{linea_id, cantidad_aprobada}] } */
distribucionesRouter.patch(
  '/:id/lineas',
  soloAdmin,
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
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.aprobarDistribucion(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);

// ───────── Operación de bodega (admin + encargado_bodega) ─────────

/** GET /distribuciones/:id/operacion — líneas con cantidades por etapa, por sucursal. */
distribucionesRouter.get(
  '/:id/operacion',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.operacionDetalle(req.auth!.negocioId, id));
  }),
);

/** POST /distribuciones/:id/preparar — inicia preparación y reserva en bodega. */
distribucionesRouter.post(
  '/:id/preparar',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.prepararDistribucion(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);

/** PATCH /distribuciones/:id/preparacion { items } — cantidades surtidas. */
distribucionesRouter.patch(
  '/:id/preparacion',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const { items } = etapaSchema.parse(req.body);
    res.json(await svc.guardarPreparacion(req.auth!.negocioId, id, items));
  }),
);

/** POST /distribuciones/:id/preparada — cierra preparación. */
distribucionesRouter.post(
  '/:id/preparada',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.marcarPreparada(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);

/** PATCH /distribuciones/:id/verificacion { items } — cantidades verificadas (2da persona). */
distribucionesRouter.patch(
  '/:id/verificacion',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const { items } = etapaSchema.parse(req.body);
    res.json(await svc.guardarVerificacion(req.auth!.negocioId, id, items));
  }),
);

/** POST /distribuciones/:id/verificada — cierra verificación (persona distinta). */
distribucionesRouter.post(
  '/:id/verificada',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.marcarVerificada(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);

/** PATCH /distribuciones/:id/carga { items } — cantidades a cargar al camión. */
distribucionesRouter.patch(
  '/:id/carga',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const { items } = etapaSchema.parse(req.body);
    res.json(await svc.guardarCarga(req.auth!.negocioId, id, items));
  }),
);

/** POST /distribuciones/:id/cargar — confirma la carga (sale de bodega → tránsito). */
distribucionesRouter.post(
  '/:id/cargar',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.confirmarCarga(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);
