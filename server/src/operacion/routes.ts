import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, soloAdmin, usuarioPuedeUbicacion } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import * as svc from './service.js';
import { prisma } from '../db.js';
import * as conciliacion from './conciliacion.js';

export const operacionRouter = Router();
const linea = z.enum(['carne', 'desechables']);
const id = z.coerce.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

operacionRouter.use(requireAuth);

/** Catálogos compartidos: empresas, ubicaciones, productos, proveedores y rutas. */
operacionRouter.get('/catalogo', asyncHandler(async (req, res) => {
  const q = z.object({ fecha_referencia: fecha.optional() }).parse(req.query);
  const esAdmin = req.auth!.rol === 'admin';
  const asignadas = esAdmin ? undefined : (await prisma.usuario_ubicaciones.findMany({ where: { usuario_id: req.auth!.usuarioId }, select: { ubicacion_id: true } })).map((r) => r.ubicacion_id);
  res.json(await svc.catalogoOperacion(req.auth!.negocioId, esAdmin, asignadas, q.fecha_referencia));
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
const pedidoSchema = z.object({
  ubicacion_id: id,
  linea,
  fecha_entrega: fecha,
  actualizado_at: z.string().datetime().nullable().optional(),
  confirmar: z.boolean().optional(),
  notas: z.string().trim().max(500).nullable().optional(),
  lineas: z.array(lineaPedido),
});
operacionRouter.put('/pedidos', requireRole('admin', 'encargado_sucursal'), asyncHandler(async (req, res) => {
  const b = pedidoSchema.parse(req.body);
  if (req.auth!.rol !== 'admin' && !(await usuarioPuedeUbicacion(req, BigInt(b.ubicacion_id)))) throw new HttpError(403, 'No tienes acceso a esa ubicación');
  res.json(await svc.guardarPedido(req.auth!.negocioId, req.auth!.usuarioId, b, req.auth!.rol === 'admin'));
}));

/** Guarda en un solo paso las órdenes por restaurante y fecha capturadas en la vista semanal. */
operacionRouter.put('/pedidos/semana', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ pedidos: z.array(pedidoSchema).min(1).max(100) })
    .refine((v) => new Set(v.pedidos.map((p) => p.linea)).size === 1, { message: 'La captura semanal debe corresponder a una sola línea' })
    .parse(req.body);
  res.json(await svc.guardarPedidosSemana(req.auth!.negocioId, req.auth!.usuarioId, b.pedidos));
}));

/** Confirma en bloque los pedidos capturados de una fecha o semana. */
operacionRouter.post('/pedidos/confirmar-todos', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ linea, desde: fecha, hasta: fecha }).refine((v) => v.desde <= v.hasta, { message: 'El rango de fechas no es válido' }).parse(req.body);
  res.json(await svc.confirmarPedidosEnRango(req.auth!.negocioId, req.auth!.usuarioId, b.linea, b.desde, b.hasta));
}));

/** Convierte pedidos confirmados en distribución y genera todas las rutas del día. */
operacionRouter.post('/distribuciones', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ linea, fecha_entrega: fecha }).parse(req.body);
  res.status(201).json(await svc.crearDistribucionOperativa(req.auth!.negocioId, req.auth!.usuarioId, b.linea, b.fecha_entrega));
}));

/** Genera en un toque todas las preparaciones con pedidos confirmados de la semana. */
operacionRouter.post('/distribuciones/crear-todas', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ linea: linea.optional(), desde: fecha, hasta: fecha }).refine((v) => v.desde <= v.hasta, { message: 'El rango de fechas no es válido' }).parse(req.body);
  res.status(201).json(await svc.crearPreparacionesEnRango(req.auth!.negocioId, req.auth!.usuarioId, b.desde, b.hasta, b.linea));
}));

/** Completa de forma idempotente los despachos de pedidos que ya estaban confirmados. */
operacionRouter.post('/distribuciones/sincronizar', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ desde: fecha, hasta: fecha }).refine((v) => v.desde <= v.hasta, { message: 'El rango de fechas no es válido' }).parse(req.body);
  res.json(await svc.sincronizarDespachosConfirmados(req.auth!.negocioId, req.auth!.usuarioId, b.desde, b.hasta));
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
  const q = z.object({ desde: fecha.optional(), hasta: fecha.optional() }).parse(req.query);
  res.json(await svc.resumenProduccion(req.auth!.negocioId, q.desde, q.hasta));
}));

/** Auditoría semanal: inventario inicial + entradas − salidas = cortes de miércoles y sábado. */
operacionRouter.get('/conciliacion', soloAdmin, asyncHandler(async (req, res) => {
  const q = z.object({ desde: fecha, hasta: fecha, ubicacion_id: id.optional() })
    .refine((v) => v.desde <= v.hasta, { message: 'El rango de fechas no es válido' }).parse(req.query);
  res.json(await conciliacion.obtenerConciliacionSemanal(req.auth!.negocioId, q.desde, q.hasta, q.ubicacion_id ? BigInt(q.ubicacion_id) : undefined));
}));

/** Fija una fotografía inicial reconstruida sin alterar el inventario vivo. */
operacionRouter.post('/conciliacion/inicializar', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ desde: fecha, ubicacion_id: id.optional() }).parse(req.body);
  res.status(201).json(await conciliacion.fijarInventarioInicialSemanal(req.auth!.negocioId, req.auth!.usuarioId, b.desde, b.ubicacion_id ? BigInt(b.ubicacion_id) : undefined));
}));

operacionRouter.post('/compras', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({
    proveedor_id: id, ubicacion_id: id, fecha, referencia: z.string().trim().max(120).nullable().optional(),
    lineas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive(), peso_total_lb: z.coerce.number().nonnegative().default(0), costo_total: z.coerce.number().nonnegative(), congelado: z.boolean().optional() })).min(1),
  }).parse(req.body);
  res.status(201).json(await svc.registrarCompra(req.auth!.negocioId, req.auth!.usuarioId, b));
}));

/** Corrige una compra pendiente mientras sus lotes todavía estén íntegros. */
operacionRouter.patch('/compras/:id', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({
    proveedor_id: id, ubicacion_id: id, fecha, referencia: z.string().trim().max(120).nullable().optional(),
    lineas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive(), peso_total_lb: z.coerce.number().nonnegative().default(0), costo_total: z.coerce.number().nonnegative(), congelado: z.boolean().optional() })).min(1),
  }).parse(req.body);
  res.json(await svc.editarCompra(req.auth!.negocioId, BigInt(id.parse(req.params.id)), req.auth!.usuarioId, b));
}));

/** Revierte una compra mientras su inventario/lote todavía no haya sido utilizado. */
operacionRouter.delete('/compras/:id', soloAdmin, asyncHandler(async (req, res) => {
  res.json(await svc.eliminarCompra(req.auth!.negocioId, BigInt(id.parse(req.params.id)), req.auth!.usuarioId));
}));

/** Captura directa del inventario físico final, en el mismo orden del libro semanal. */
operacionRouter.put('/inventario-final', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({
    ubicacion_id: id,
    fecha,
    motivo: z.string().trim().max(500).nullable().optional(),
    lineas: z.array(z.object({ product_id: id, cantidad: z.coerce.number().nonnegative() })).min(1),
  }).parse(req.body);
  res.json(await svc.guardarInventarioFinal(req.auth!.negocioId, req.auth!.usuarioId, b));
}));

/** Historial de inventarios finales, incluidos los ajustes creados por la versión anterior. */
operacionRouter.get('/inventarios-finales', soloAdmin, asyncHandler(async (req, res) => {
  const q = z.object({ ubicacion_id: id.optional() }).parse(req.query);
  res.json(await svc.listarInventariosFinales(req.auth!.negocioId, q.ubicacion_id ? BigInt(q.ubicacion_id) : undefined));
}));

/** Revierte y elimina una captura completa sin dejar saldos negativos. */
operacionRouter.delete('/inventarios-finales/:token', soloAdmin, asyncHandler(async (req, res) => {
  const token = z.string().regex(/^(conteo|legacy)-\d+$/).parse(req.params.token);
  res.json(await svc.eliminarInventarioFinal(req.auth!.negocioId, token, req.auth!.usuarioId));
}));

const produccionSchema = z.object({
  ubicacion_id: id, materia_prima_id: id, fecha, cajas_materia_prima: z.coerce.number().positive(), notas: z.string().trim().max(500).nullable().optional(),
  salidas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive() })).min(1),
});

operacionRouter.post('/produccion', soloAdmin, asyncHandler(async (req, res) => {
  const b = produccionSchema.parse(req.body);
  res.status(201).json(await svc.registrarProduccion(req.auth!.negocioId, req.auth!.usuarioId, b));
}));

/** Captura varios productos del mismo día sin guardar batches incompletos. */
operacionRouter.post('/produccion/lote', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ producciones: z.array(produccionSchema).min(1).max(12) })
    .refine((v) => new Set(v.producciones.map((p) => p.fecha)).size === 1, { message: 'Todas las producciones deben corresponder al mismo día' })
    .parse(req.body);
  res.status(201).json(await svc.registrarProducciones(req.auth!.negocioId, req.auth!.usuarioId, b.producciones));
}));

/** Elimina un batch incorrecto y revierte materia prima, salidas y movimientos. */
operacionRouter.delete('/produccion/:id', soloAdmin, asyncHandler(async (req, res) => {
  res.json(await svc.eliminarProduccion(req.auth!.negocioId, BigInt(id.parse(req.params.id)), req.auth!.usuarioId));
}));

operacionRouter.patch('/lotes/:id', soloAdmin, asyncHandler(async (req, res) => {
  const loteId = BigInt(id.parse(req.params.id));
  const { congelado } = z.object({ congelado: z.boolean() }).parse(req.body);
  res.json(await svc.cambiarCongelado(req.auth!.negocioId, loteId, congelado));
}));
