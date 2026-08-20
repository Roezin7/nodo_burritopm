import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, soloAdmin, usuarioPuedeUbicacion } from '../auth/middleware.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import * as svc from './service.js';
import { idempotencyKey } from '../lib/validation.js';
import { prisma } from '../db.js';
import * as conciliacion from './conciliacion.js';
import { confirmarRecepcionesSinFaltantesEnRango, eliminarDistribucion } from '../distribuciones/service.js';
import { asegurarSemanaEditable } from '../lib/semana-operativa.js';
import { registrarAvisoAdminsBestEffort } from '../push/business-notifications.js';

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

/** Revierte los consolidados de fechas seleccionadas para corregir ventas en bloque. */
operacionRouter.post('/pedidos/reabrir-consolidados', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ linea, fechas: z.array(fecha).min(1).max(7) }).parse(req.body);
  const fechasUnicas = [...new Set(b.fechas)];
  for (const fechaEntrega of fechasUnicas) await asegurarSemanaEditable(req.auth!.negocioId, fechaEntrega);
  const consolidados = await prisma.distribuciones.findMany({
    where: {
      negocio_id: req.auth!.negocioId,
      linea_operacion: b.linea,
      fecha_entrega: { in: fechasUnicas.map((valor) => new Date(`${valor}T00:00:00.000Z`)) },
      estado: { not: 'cancelada' },
    },
    select: { id: true },
    orderBy: { id: 'desc' },
  });
  for (const consolidado of consolidados) {
    await eliminarDistribucion(req.auth!.negocioId, consolidado.id, req.auth!.usuarioId);
  }
  res.json({ eliminados: consolidados.length });
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
  const despachos = await svc.sincronizarDespachosConfirmados(req.auth!.negocioId, req.auth!.usuarioId, b.desde, b.hasta);
  const negocio = await prisma.negocios.findUnique({ where: { id: req.auth!.negocioId }, select: { reparto_habilitado: true } });
  const entregas = negocio?.reparto_habilitado
    ? { confirmadas: 0 }
    : await confirmarRecepcionesSinFaltantesEnRango(req.auth!.negocioId, req.auth!.usuarioId, b.desde, b.hasta);
  res.json({ despachos, entregas });
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

/** Integridad pedido → despacho → movimiento, para auditar antes del cierre. */
operacionRouter.get('/conciliacion/integridad', soloAdmin, asyncHandler(async (req, res) => {
  const q = z.object({ desde: fecha, hasta: fecha })
    .refine((v) => v.desde <= v.hasta, { message: 'El rango de fechas no es válido' }).parse(req.query);
  res.json(await conciliacion.auditarPedidosVsDistribuciones(req.auth!.negocioId, q.desde, q.hasta));
}));

/** Fija una fotografía inicial reconstruida sin alterar el inventario vivo. */
operacionRouter.post('/conciliacion/inicializar', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ desde: fecha, ubicacion_id: id.optional() }).parse(req.body);
  res.status(201).json(await conciliacion.fijarInventarioInicialSemanal(req.auth!.negocioId, req.auth!.usuarioId, b.desde, b.ubicacion_id ? BigInt(b.ubicacion_id) : undefined));
}));

operacionRouter.post('/compras', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({
    proveedor_id: id, ubicacion_id: id, fecha, referencia: z.string().trim().max(120).nullable().optional(),
    total_factura: z.coerce.number().nonnegative().nullable().optional(),
    idempotency_key: idempotencyKey.optional(),
    lineas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive(), peso_total_lb: z.coerce.number().nonnegative().default(0), costo_total: z.coerce.number().nonnegative(), congelado: z.boolean().optional() })).min(1),
  }).parse(req.body);
  const resultado = await svc.registrarCompra(req.auth!.negocioId, req.auth!.usuarioId, b);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'compra_registrada', entidad: 'compra', entidadId: resultado.id, actorId: req.auth!.usuarioId,
    dedupeKey: `compra:${resultado.id}:registrada`, titulo: 'Compra registrada 📦',
    cuerpo: `Se registró una compra por ${resultado.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
    url: '/semana/compras', datos: { compra_id: resultado.id, total: resultado.total, fecha: b.fecha },
  });
  res.status(201).json(resultado);
}));

/** Corrige una compra pendiente mientras sus lotes todavía estén íntegros. */
operacionRouter.patch('/compras/:id', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({
    proveedor_id: id, ubicacion_id: id, fecha, referencia: z.string().trim().max(120).nullable().optional(),
    total_factura: z.coerce.number().nonnegative().nullable().optional(),
    lineas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive(), peso_total_lb: z.coerce.number().nonnegative().default(0), costo_total: z.coerce.number().nonnegative(), congelado: z.boolean().optional() })).min(1),
  }).parse(req.body);
  const compraId = BigInt(id.parse(req.params.id));
  const resultado = await svc.editarCompra(req.auth!.negocioId, compraId, req.auth!.usuarioId, b);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'compra_modificada', entidad: 'compra', entidadId: compraId, actorId: req.auth!.usuarioId,
    dedupeKey: `compra:${compraId}:modificada:${Date.now()}`, titulo: 'Compra modificada ✏️',
    cuerpo: `Se modificó la compra por ${resultado.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
    url: '/semana/compras', datos: { compra_id: Number(compraId), total: resultado.total, fecha: b.fecha },
  });
  res.json(resultado);
}));

/** Revierte una compra mientras su inventario/lote todavía no haya sido utilizado. */
operacionRouter.delete('/compras/:id', soloAdmin, asyncHandler(async (req, res) => {
  const compraId = BigInt(id.parse(req.params.id));
  const resultado = await svc.eliminarCompra(req.auth!.negocioId, compraId, req.auth!.usuarioId);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'compra_eliminada', entidad: 'compra', entidadId: compraId, actorId: req.auth!.usuarioId,
    dedupeKey: `compra:${compraId}:eliminada`, titulo: 'Compra eliminada 🗑️',
    cuerpo: `Se revirtió una compra por ${resultado.total_revertido.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`,
    url: '/semana/compras', datos: { compra_id: Number(compraId), total_revertido: resultado.total_revertido },
  });
  res.json(resultado);
}));

/** Captura directa del inventario físico final, en el mismo orden del libro semanal. */
operacionRouter.put('/inventario-final', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({
    ubicacion_id: id,
    fecha,
    motivo: z.string().trim().max(500).nullable().optional(),
    lineas: z.array(z.object({ product_id: id, cantidad: z.coerce.number().nonnegative() })).min(1),
  }).parse(req.body);
  const resultado = await svc.guardarInventarioFinal(req.auth!.negocioId, req.auth!.usuarioId, b);
  const advertencia = resultado.advertencias?.length ? ` Hay ${resultado.advertencias.length} observación${resultado.advertencias.length === 1 ? '' : 'es'}.` : '';
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'conteo_inventario_guardado', entidad: 'conteo', entidadId: resultado.inventario_id, actorId: req.auth!.usuarioId,
    dedupeKey: `conteo:${resultado.inventario_id}:guardado`, titulo: 'Conteo de inventario guardado ✅',
    cuerpo: `Se guardó el conteo del ${b.fecha} con ${resultado.ajustes} ajuste${resultado.ajustes === 1 ? '' : 's'}.${advertencia}`,
    url: `/semana/inventario?semana=${b.fecha}`, datos: { conteo_id: resultado.inventario_id, ubicacion_id: b.ubicacion_id, fecha: b.fecha, ajustes: resultado.ajustes, advertencias: resultado.advertencias ?? [] },
  });
  res.json(resultado);
}));

/** Historial de inventarios finales, incluidos los ajustes creados por la versión anterior. */
operacionRouter.get('/inventarios-finales', soloAdmin, asyncHandler(async (req, res) => {
  const q = z.object({ ubicacion_id: id.optional() }).parse(req.query);
  res.json(await svc.listarInventariosFinales(req.auth!.negocioId, q.ubicacion_id ? BigInt(q.ubicacion_id) : undefined));
}));

/** Revierte y elimina una captura completa sin dejar saldos negativos. */
operacionRouter.delete('/inventarios-finales/:token', soloAdmin, asyncHandler(async (req, res) => {
  const token = z.string().regex(/^(conteo|legacy)-\d+$/).parse(req.params.token);
  const resultado = await svc.eliminarInventarioFinal(req.auth!.negocioId, token, req.auth!.usuarioId);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'conteo_inventario_revertido', entidad: 'conteo', entidadId: Number(token.split('-')[1]), actorId: req.auth!.usuarioId,
    dedupeKey: `conteo:${token}:revertido`, titulo: 'Conteo de inventario revertido ↩️',
    cuerpo: `Se revirtió el conteo ${token}.`, url: '/semana/inventario', datos: { token, resultado },
  });
  res.json(resultado);
}));

const produccionSchema = z.object({
  ubicacion_id: id, materia_prima_id: id, fecha, cajas_materia_prima: z.coerce.number().positive(), notas: z.string().trim().max(500).nullable().optional(),
  idempotency_key: idempotencyKey.optional(),
  salidas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive() })).min(1),
});

operacionRouter.post('/produccion', soloAdmin, asyncHandler(async (req, res) => {
  const b = produccionSchema.parse(req.body);
  const resultado = await svc.registrarProduccion(req.auth!.negocioId, req.auth!.usuarioId, b);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'produccion_registrada', entidad: 'produccion', entidadId: resultado.id, actorId: req.auth!.usuarioId,
    dedupeKey: `produccion:${resultado.id}:registrada`, titulo: 'Producción registrada 🏭',
    cuerpo: `Se registró producción del ${b.fecha} con ${b.salidas.length} salida${b.salidas.length === 1 ? '' : 's'}.`,
    url: `/semana/produccion?semana=${b.fecha}`, datos: { produccion_id: resultado.id, fecha: b.fecha, salidas: b.salidas.length },
  });
  res.status(201).json(resultado);
}));

/** Corrige un batch completo y recalcula FIFO, costos, yield y existencias. */
operacionRouter.patch('/produccion/:id', soloAdmin, asyncHandler(async (req, res) => {
  const b = produccionSchema.parse(req.body);
  const produccionId = BigInt(id.parse(req.params.id));
  const resultado = await svc.editarProduccion(req.auth!.negocioId, produccionId, req.auth!.usuarioId, b);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'produccion_modificada', entidad: 'produccion', entidadId: produccionId, actorId: req.auth!.usuarioId,
    dedupeKey: `produccion:${produccionId}:modificada:${Date.now()}`, titulo: 'Producción modificada ✏️',
    cuerpo: `Se corrigió producción del ${b.fecha}.`, url: `/semana/produccion?semana=${b.fecha}`, datos: { produccion_id: Number(produccionId), fecha: b.fecha },
  });
  res.json(resultado);
}));

/** Captura varios productos del mismo día sin guardar batches incompletos. */
operacionRouter.post('/produccion/lote', soloAdmin, asyncHandler(async (req, res) => {
  const b = z.object({ producciones: z.array(produccionSchema).min(1).max(12) })
    .refine((v) => new Set(v.producciones.map((p) => p.fecha)).size === 1, { message: 'Todas las producciones deben corresponder al mismo día' })
    .parse(req.body);
  const resultado = await svc.registrarProducciones(req.auth!.negocioId, req.auth!.usuarioId, b.producciones);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'produccion_lote_registrada', entidad: 'produccion', entidadId: resultado.producciones[0]?.id ?? null, actorId: req.auth!.usuarioId,
    dedupeKey: `produccion-lote:${resultado.producciones.map((p) => p.id).join('-')}:registrado`, titulo: 'Producción registrada 🏭',
    cuerpo: `Se registraron ${resultado.producciones.length} producciones del ${b.producciones[0]!.fecha}.`,
    url: `/semana/produccion?semana=${b.producciones[0]!.fecha}`, datos: { producciones: resultado.producciones.map((p) => p.id), fecha: b.producciones[0]!.fecha },
  });
  res.status(201).json(resultado);
}));

const produccionExtraordinariaSchema = z.object({
  ubicacion_id: id,
  fecha,
  notas: z.string().trim().max(500).nullable().optional(),
  idempotency_key: idempotencyKey.optional(),
  salidas: z.array(z.object({ product_id: id, cajas: z.coerce.number().positive().max(100_000) })).min(1).max(3),
});

/** Producto terminado de precio fijo, sin materia prima, costo ni yield contable. */
operacionRouter.post('/produccion-extraordinaria', soloAdmin, asyncHandler(async (req, res) => {
  const b = produccionExtraordinariaSchema.parse(req.body);
  const resultado = await svc.registrarProduccionExtraordinaria(req.auth!.negocioId, req.auth!.usuarioId, b);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'produccion_extraordinaria_registrada', entidad: 'produccion_extraordinaria', entidadId: resultado.id, actorId: req.auth!.usuarioId,
    dedupeKey: `produccion-extraordinaria:${resultado.id}:registrada`, titulo: 'Producción extraordinaria registrada 🏭',
    cuerpo: `Se registró producción extraordinaria del ${b.fecha}.`, url: `/semana/produccion?semana=${b.fecha}`, datos: { produccion_id: resultado.id, fecha: b.fecha },
  });
  res.status(201).json(resultado);
}));

operacionRouter.delete('/produccion-extraordinaria/:id', soloAdmin, asyncHandler(async (req, res) => {
  const produccionId = BigInt(id.parse(req.params.id));
  const resultado = await svc.eliminarProduccionExtraordinaria(req.auth!.negocioId, produccionId, req.auth!.usuarioId);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'produccion_extraordinaria_eliminada', entidad: 'produccion_extraordinaria', entidadId: produccionId, actorId: req.auth!.usuarioId,
    dedupeKey: `produccion-extraordinaria:${produccionId}:eliminada`, titulo: 'Producción extraordinaria eliminada 🗑️',
    cuerpo: `Se revirtió la producción extraordinaria #${produccionId}.`, url: '/semana/produccion', datos: { produccion_id: Number(produccionId), resultado },
  });
  res.json(resultado);
}));

/** Elimina un batch incorrecto y revierte materia prima, salidas y movimientos. */
operacionRouter.delete('/produccion/:id', soloAdmin, asyncHandler(async (req, res) => {
  const produccionId = BigInt(id.parse(req.params.id));
  const resultado = await svc.eliminarProduccion(req.auth!.negocioId, produccionId, req.auth!.usuarioId);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'produccion_eliminada', entidad: 'produccion', entidadId: produccionId, actorId: req.auth!.usuarioId,
    dedupeKey: `produccion:${produccionId}:eliminada`, titulo: 'Producción eliminada 🗑️',
    cuerpo: `Se revirtió la producción #${produccionId}.`, url: '/semana/produccion', datos: { produccion_id: Number(produccionId), resultado },
  });
  res.json(resultado);
}));

operacionRouter.patch('/lotes/:id', soloAdmin, asyncHandler(async (req, res) => {
  const loteId = BigInt(id.parse(req.params.id));
  const { congelado } = z.object({ congelado: z.boolean() }).parse(req.body);
  res.json(await svc.cambiarCongelado(req.auth!.negocioId, loteId, congelado));
}));
