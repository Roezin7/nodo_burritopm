import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, requireRole, soloAdmin, usuarioPuedeUbicacion } from '../auth/middleware.js';
import * as svc from './service.js';
import * as rutas from './rutas.service.js';
import { prisma } from '../db.js';

export const distribucionesRouter = Router();

const idParam = z.coerce.number().int().positive();
const fechaParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const sucursal = requireRole('admin', 'encargado_sucursal');

// La planeación (calcular/aprobar) es del admin; la operación de bodega la hace
// también el encargado de bodega; la recepción la hace la sucursal. Cada ruta declara su guard.
distribucionesRouter.use(requireAuth);
const bodega = requireRole('admin', 'encargado_bodega');
const etapaSchema = z.object({ items: z.array(z.object({ linea_id: z.coerce.number().int().positive(), cantidad: z.coerce.number().nonnegative() })) });

async function exigirBodegasDeDistribucion(req: Parameters<typeof usuarioPuedeUbicacion>[0], distribucionId: bigint) {
  if (req.auth?.rol === 'admin') return;
  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: distribucionId, distribuciones: { negocio_id: req.auth!.negocioId } },
    include: { products: { select: { linea_operacion: true } } },
  });
  if (!lineas.length) throw new HttpError(404, 'Distribución no encontrada');
  const codigos = new Set(lineas.map((l) => l.products.linea_operacion === 'carne' ? 'CARN' : 'BOD'));
  const bodegas = await prisma.ubicaciones.findMany({ where: { negocio_id: req.auth!.negocioId, codigo: { in: [...codigos] }, activo: true } });
  for (const bodega of bodegas) {
    if (!(await usuarioPuedeUbicacion(req, bodega.id))) throw new HttpError(403, `No tienes acceso a ${bodega.nombre}`);
  }
}

/** GET /distribuciones/recepciones?ubicacion=ID — pendientes de recibir en una sucursal. */
distribucionesRouter.get(
  '/recepciones',
  sucursal,
  asyncHandler(async (req, res) => {
    const ubicacionId = BigInt(idParam.parse(req.query.ubicacion));
    const q = z.object({ desde: fechaParam.optional(), hasta: fechaParam.optional() }).parse(req.query);
    if (!(await usuarioPuedeUbicacion(req, ubicacionId))) throw new HttpError(403, 'No tienes acceso a esta ubicación');
    res.json(await svc.recepcionesPendientes(req.auth!.negocioId, ubicacionId, q.desde, q.hasta));
  }),
);

/** GET /distribuciones/recepciones/historial?ubicacion=ID — recepciones ya cerradas. */
distribucionesRouter.get(
  '/recepciones/historial',
  sucursal,
  asyncHandler(async (req, res) => {
    const ubicacionId = BigInt(idParam.parse(req.query.ubicacion));
    const q = z.object({ desde: fechaParam.optional(), hasta: fechaParam.optional() }).parse(req.query);
    if (!(await usuarioPuedeUbicacion(req, ubicacionId))) throw new HttpError(403, 'No tienes acceso a esta ubicación');
    res.json(await svc.recepcionesHistorial(req.auth!.negocioId, ubicacionId, q.desde, q.hasta));
  }),
);

/** GET /distribuciones/recepciones/auditoria — panorama semanal de todas las sucursales. */
distribucionesRouter.get(
  '/recepciones/auditoria',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const q = z.object({ desde: fechaParam, hasta: fechaParam })
      .refine((v) => v.desde <= v.hasta, { message: 'El rango de fechas no es válido' }).parse(req.query);
    res.json(await svc.auditoriaRecepciones(req.auth!.negocioId, q.desde, q.hasta));
  }),
);

/** POST /distribuciones/recepciones/:id/auditar — registra faltantes detectados por el admin. */
distribucionesRouter.post(
  '/recepciones/:id/auditar',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const distribucionId = BigInt(idParam.parse(req.params.id));
    const b = z.object({
      ubicacion_id: z.coerce.number().int().positive(),
      faltantes: z.array(z.object({ linea_id: z.coerce.number().int().positive(), cantidad: z.coerce.number().nonnegative() })).min(1),
    }).parse(req.body);
    res.json(await svc.auditarFaltantesRecepcion(req.auth!.negocioId, distribucionId, BigInt(b.ubicacion_id), req.auth!.usuarioId, b.faltantes));
  }),
);

/** POST /distribuciones/recepciones/auditar-todas — el admin confirma completas las pendientes. */
distribucionesRouter.post(
  '/recepciones/auditar-todas',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ desde: fechaParam, hasta: fechaParam })
      .refine((v) => v.desde <= v.hasta, { message: 'El rango de fechas no es válido' }).parse(req.body);
    res.json(await svc.confirmarRecepcionesSinFaltantesEnRango(req.auth!.negocioId, req.auth!.usuarioId, b.desde, b.hasta));
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
    const q = z.object({ desde: fechaParam.optional(), hasta: fechaParam.optional() }).parse(req.query);
    res.json(await svc.listarDistribuciones(req.auth!.negocioId, q.desde, q.hasta));
  }),
);

/** Aprueba todas las preparaciones editables de una semana. */
distribucionesRouter.post(
  '/aprobar-todas',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ desde: fechaParam, hasta: fechaParam }).refine((v) => v.desde <= v.hasta, { message: 'El rango de fechas no es válido' }).parse(req.body);
    res.json(await svc.aprobarDistribucionesEnRango(req.auth!.negocioId, req.auth!.usuarioId, b.desde, b.hasta));
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

/** GET /distribuciones/:id/agregables — sucursales rezagadas que pueden sumarse al pedido. */
distribucionesRouter.get(
  '/:id/agregables',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.sucursalesAgregables(req.auth!.negocioId, id));
  }),
);

/** POST /distribuciones/:id/sucursales { ubicacion_ids } — incluye sucursales rezagadas sin rehacer. */
distribucionesRouter.post(
  '/:id/sucursales',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const { ubicacion_ids } = z.object({ ubicacion_ids: z.array(z.coerce.number().int().positive()).min(1) }).parse(req.body);
    res.json(await svc.agregarSucursales(req.auth!.negocioId, id, ubicacion_ids));
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

/** PATCH /distribuciones/:id/estado — reversa segura antes de mover inventario. */
distribucionesRouter.patch(
  '/:id/estado',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const { estado } = z.object({ estado: z.literal('en_revision') }).parse(req.body);
    res.json(await svc.cambiarEstadoAdmin(req.auth!.negocioId, id, estado));
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

/** PATCH /distribuciones/:id { nombre } — renombra la distribución (etiqueta del admin). */
distribucionesRouter.patch(
  '/:id',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const { nombre } = z.object({ nombre: z.string().trim().max(120) }).parse(req.body);
    res.json(await svc.renombrarDistribucion(req.auth!.negocioId, id, nombre));
  }),
);

/** DELETE /distribuciones/:id — elimina la distribución y devuelve el inventario a bodega. */
distribucionesRouter.delete(
  '/:id',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await svc.eliminarDistribucion(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);

// ───────── Operación de bodega (admin + encargado_bodega) ─────────

/** GET /distribuciones/:id/operacion — líneas con cantidades por etapa, por sucursal. */
distribucionesRouter.get(
  '/:id/operacion',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await exigirBodegasDeDistribucion(req, id);
    res.json(await svc.operacionDetalle(req.auth!.negocioId, id));
  }),
);

/** PATCH /distribuciones/:id/carga { items } — surtido: cantidades a cargar al camión. */
distribucionesRouter.patch(
  '/:id/carga',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await exigirBodegasDeDistribucion(req, id);
    const { items } = etapaSchema.parse(req.body);
    res.json(await svc.guardarCarga(req.auth!.negocioId, id, items));
  }),
);

/** POST /distribuciones/:id/verificada — verificación opcional de 1 toque (sin persona distinta). */
distribucionesRouter.post(
  '/:id/verificada',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await exigirBodegasDeDistribucion(req, id);
    res.json(await svc.marcarVerificada(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);

/** POST /distribuciones/:id/cargar — confirma la carga (sale de bodega → tránsito). */
distribucionesRouter.post(
  '/:id/cargar',
  bodega,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    await exigirBodegasDeDistribucion(req, id);
    res.json(await svc.confirmarCarga(req.auth!.negocioId, id, req.auth!.usuarioId));
  }),
);

// ───────── Ruta de entrega (admin planea; bodega/repartidor consultan) ─────────

/** GET /distribuciones/:id/ruta — detalle de la ruta (paradas + items). */
distribucionesRouter.get(
  '/:id/ruta',
  requireRole('admin', 'encargado_bodega'),
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await rutas.rutaDetalle(req.auth!.negocioId, id));
  }),
);

/** GET /distribuciones/:id/rutas — todas las rutas de la distribución (Sur/Norte/etc.). */
distribucionesRouter.get(
  '/:id/rutas',
  requireRole('admin', 'encargado_bodega'),
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    res.json(await rutas.rutasDeDistribucion(req.auth!.negocioId, id));
  }),
);

/** PUT /distribuciones/:id/ruta { repartidor_id?, nombre?, paradas:[{ubicacion_id,orden}] } */
distribucionesRouter.put(
  '/:id/ruta',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = z
      .object({
        repartidor_id: z.coerce.number().int().positive().nullable().optional(),
        nombre: z.string().trim().min(1).max(120).optional(),
        paradas: z.array(z.object({ ubicacion_id: z.coerce.number().int().positive(), orden: z.coerce.number().int().nonnegative() })),
      })
      .parse(req.body);
    res.json(await rutas.crearOActualizarRuta(req.auth!.negocioId, id, req.auth!.usuarioId, b));
  }),
);
