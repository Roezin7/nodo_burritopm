import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, soloAdmin, usuarioPuedeUbicacion } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import * as svc from './service.js';
import { prisma } from '../db.js';

export const operacionRouter = Router();
const linea = z.enum(['carne', 'desechables']);
const id = z.coerce.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

operacionRouter.use(requireAuth);

/** Catálogos compartidos: empresas, ubicaciones, productos, proveedores y rutas. */
operacionRouter.get('/catalogo', asyncHandler(async (req, res) => {
  const esAdmin = req.auth!.rol === 'admin';
  const asignadas = esAdmin ? undefined : (await prisma.usuario_ubicaciones.findMany({ where: { usuario_id: req.auth!.usuarioId }, select: { ubicacion_id: true } })).map((r) => r.ubicacion_id);
  res.json(await svc.catalogoOperacion(req.auth!.negocioId, esAdmin, asignadas));
}));

/** Pedidos propios para restaurantes; el admin puede consultar cualquier ubicación. */
operacionRouter.get('/pedidos', requireRole('admin', 'encargado_sucursal'), asyncHandler(async (req, res) => {
  const q = z.object({ desde: fecha.optional(), hasta: fecha.optional(), linea: linea.optional(), ubicacion_id: id.optional() }).parse(req.query);
  let ubicacionId = q.ubicacion_id ? BigInt(q.ubicacion_id) : undefined;
  if (req.auth!.rol !== 'admin') {
    if (!ubicacionId) throw new HttpError(400, 'Selecciona tu ubicación');
    if (!(await usuarioPuedeUbicacion(req, ubicacionId))) throw new HttpError(403, 'No tienes acceso a esa ubicación');
  }
  res.json(await svc.listarPedidos(req.auth!.negocioId, { desde: q.desde, hasta: q.hasta, linea: q.linea, ubicacionId }));
}));

const lineaPedido = z.object({ product_id: id, cantidad: z.coerce.number().nonnegative(), notas: z.string().trim().max(300).nullable().optional() });
operacionRouter.put('/pedidos', requireRole('admin', 'encargado_sucursal'), asyncHandler(async (req, res) => {
  const b = z.object({ ubicacion_id: id, linea, fecha_entrega: fecha, confirmar: z.boolean().optional(), notas: z.string().trim().max(500).nullable().optional(), lineas: z.array(lineaPedido) }).parse(req.body);
  if (req.auth!.rol !== 'admin' && !(await usuarioPuedeUbicacion(req, BigInt(b.ubicacion_id)))) throw new HttpError(403, 'No tienes acceso a esa ubicación');
  res.json(await svc.guardarPedido(req.auth!.negocioId, req.auth!.usuarioId, b, req.auth!.rol === 'admin'));
}));

/** Convierte pedidos confirmados en distribución y genera todas las rutas del día. */
operacionRouter.post('/distribuciones', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ linea, fecha_entrega: fecha }).parse(req.body);
  res.status(201).json(await svc.crearDistribucionOperativa(req.auth!.negocioId, req.auth!.usuarioId, b.linea, b.fecha_entrega));
}));

operacionRouter.patch('/plantillas/:id', soloAdmin, asyncHandler(async (req, res) => {
  const plantillaId = BigInt(id.parse(req.params.id));
  const b = z.object({
    nombre: z.string().trim().min(1).max(120).optional(), conductor: z.string().trim().min(1).max(80).optional(), activo: z.boolean().optional(),
    paradas: z.array(z.object({ ubicacion_id: id, orden: z.coerce.number().int().nonnegative(), opcional: z.boolean().optional() })).optional(),
  }).parse(req.body);
  res.json(await svc.guardarPlantilla(req.auth!.negocioId, plantillaId, b));
}));

operacionRouter.get('/produccion', soloAdmin, asyncHandler(async (req, res) => {
  res.json(await svc.resumenProduccion(req.auth!.negocioId));
}));

operacionRouter.post('/compras', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({
    proveedor_id: id, ubicacion_id: id, fecha, referencia: z.string().trim().max(120).nullable().optional(),
    lineas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive(), peso_total_lb: z.coerce.number().positive(), costo_total: z.coerce.number().nonnegative(), congelado: z.boolean().optional() })).min(1),
  }).parse(req.body);
  res.status(201).json(await svc.registrarCompra(req.auth!.negocioId, req.auth!.usuarioId, b));
}));

operacionRouter.post('/produccion', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({
    ubicacion_id: id, materia_prima_id: id, fecha, cajas_materia_prima: z.coerce.number().positive(), notas: z.string().trim().max(500).nullable().optional(),
    salidas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive() })).min(1),
  }).parse(req.body);
  res.status(201).json(await svc.registrarProduccion(req.auth!.negocioId, req.auth!.usuarioId, b));
}));

operacionRouter.patch('/lotes/:id', soloAdmin, asyncHandler(async (req, res) => {
  const loteId = BigInt(id.parse(req.params.id));
  const { congelado } = z.object({ congelado: z.boolean() }).parse(req.body);
  res.json(await svc.cambiarCongelado(req.auth!.negocioId, loteId, congelado));
}));
