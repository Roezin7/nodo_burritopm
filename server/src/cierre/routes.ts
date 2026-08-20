import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { asyncHandler } from '../middleware/error.js';
import * as svc from './service.js';
import { generarExcel } from './excel.js';
import { registrarAvisoAdminsBestEffort } from '../push/business-notifications.js';

export const cierreRouter = Router();
const id = z.coerce.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const tipoExcel = z.enum(['weekly-order', 'disposables', 'production', 'billing', 'lbt', 'aurora']);
cierreRouter.use(requireAuth, soloAdmin);

cierreRouter.get('/', asyncHandler(async (req, res) => res.json(await svc.listarCierres(req.auth!.negocioId))));

cierreRouter.get('/cartera', asyncHandler(async (req, res) => {
  res.json(await svc.listarCartera(req.auth!.negocioId));
}));

cierreRouter.post('/creditos-lisle', asyncHandler(async (req, res) => {
  const body = z.object({
    fecha_semana: fecha,
    monto: z.coerce.number().positive().max(1_000_000),
    descripcion: z.string().trim().min(3).max(180),
    idempotency_key: z.string().trim().min(8).max(160),
  }).parse(req.body);
  res.status(201).json(await svc.registrarCreditoLisle(req.auth!.negocioId, req.auth!.usuarioId, body));
}));

cierreRouter.delete('/creditos-lisle/:id', asyncHandler(async (req, res) => {
  res.json(await svc.eliminarCreditoLisle(req.auth!.negocioId, BigInt(id.parse(req.params.id)), req.auth!.usuarioId));
}));

cierreRouter.post('/vista-previa', asyncHandler(async (req, res) => {
  const { fecha_cierre } = z.object({ fecha_cierre: fecha }).parse(req.body);
  res.json(await svc.vistaPreviaCierre(req.auth!.negocioId, req.auth!.usuarioId, fecha_cierre));
}));

cierreRouter.post('/cerrar', asyncHandler(async (req, res) => {
  const { fecha_cierre } = z.object({ fecha_cierre: fecha }).parse(req.body);
  const resultado = await svc.cerrarSemana(req.auth!.negocioId, req.auth!.usuarioId, fecha_cierre);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'semana_cerrada', entidad: 'semana', entidadId: resultado.semana_id, actorId: req.auth!.usuarioId,
    dedupeKey: `semana:${resultado.semana_id}:cerrada`, titulo: 'Semana cerrada ✅',
    cuerpo: resultado.productos_con_faltante > 0
      ? `La semana ${resultado.semana} quedó cerrada con ${resultado.productos_con_faltante} producto${resultado.productos_con_faltante === 1 ? '' : 's'} con faltante.`
      : `La semana ${resultado.semana} quedó cerrada correctamente.`,
    url: `/semana/cierre?semana=${fecha_cierre}`, datos: { semana_id: resultado.semana_id, semana: resultado.semana, anio: resultado.anio, facturas: resultado.facturas, cajas_perdidas: resultado.cajas_perdidas, productos_con_faltante: resultado.productos_con_faltante },
  });
  res.status(201).json(resultado);
}));

cierreRouter.post('/:id/reabrir', asyncHandler(async (req, res) => {
  const semanaId = BigInt(id.parse(req.params.id));
  const resultado = await svc.reabrirSemana(req.auth!.negocioId, semanaId, req.auth!.usuarioId);
  await registrarAvisoAdminsBestEffort(req.auth!.negocioId, {
    tipo: 'semana_reabierta', entidad: 'semana', entidadId: semanaId, actorId: req.auth!.usuarioId,
    dedupeKey: `semana:${semanaId}:reabierta:${Date.now()}`, titulo: 'Semana reabierta ↩️',
    cuerpo: 'La semana fue reabierta para corregir operación, inventario o facturación.', url: '/semana/cierre',
    datos: { semana_id: Number(semanaId), inventarios_finales_revertidos: resultado.inventarios_finales_revertidos },
  });
  res.json(resultado);
}));

cierreRouter.get('/facturas/:id', asyncHandler(async (req, res) => {
  res.json(await svc.detalleFactura(req.auth!.negocioId, BigInt(id.parse(req.params.id))));
}));

cierreRouter.post('/facturas/:id/pagar', asyncHandler(async (req, res) => {
  res.status(409).json({ error: 'Las cuentas por cobrar salen automáticamente después de su ciclo de tres semanas; no requieren cobro manual.' });
}));

cierreRouter.post('/facturas/pagar-lote', asyncHandler(async (req, res) => {
  res.status(409).json({ error: 'Las cuentas por cobrar salen automáticamente después de su ciclo de tres semanas; no requieren cobro manual.' });
}));

cierreRouter.delete('/facturas/:id/pago', asyncHandler(async (req, res) => {
  res.status(409).json({ error: 'La cobranza de restaurantes es automática; únicamente los pagos a proveedores se modifican manualmente.' });
}));

cierreRouter.post('/compras/:id/pagar', asyncHandler(async (req, res) => {
  const { fecha_pago, monto } = z.object({
    fecha_pago: fecha,
    monto: z.coerce.number().positive().max(1_000_000).optional(),
  }).parse(req.body);
  res.json(await svc.pagarCompra(req.auth!.negocioId, BigInt(id.parse(req.params.id)), req.auth!.usuarioId, fecha_pago, monto));
}));

cierreRouter.post('/compras/pagar-lote', asyncHandler(async (req, res) => {
  const b = z.object({ ids: z.array(id).min(1).max(200), fecha_pago: fecha }).parse(req.body);
  res.json(await svc.pagarComprasLote(req.auth!.negocioId, b.ids.map(BigInt), req.auth!.usuarioId, b.fecha_pago));
}));

cierreRouter.delete('/compras/:id/pago', asyncHandler(async (req, res) => {
  res.json(await svc.revertirPagoCompra(req.auth!.negocioId, BigInt(id.parse(req.params.id)), req.auth!.usuarioId));
}));

cierreRouter.get('/:id/excel/:tipo', asyncHandler(async (req, res) => {
  const semanaId = BigInt(id.parse(req.params.id));
  const tipo = tipoExcel.parse(req.params.tipo);
  const buffer = await generarExcel(req.auth!.negocioId, semanaId, tipo);
  const nombres = { 'weekly-order': '1. Weekly Order 2026 3Q.xlsx', disposables: '2. Disposables 2026 3Q.xlsx', production: '3. Production 2026 3Q.xlsx', billing: '4. Billing 2026 3Q.xlsx', lbt: '5. LBT 2026 3Q.xlsx', aurora: '6. Taqueria Aurora 2026 3Q.xlsx' } as const;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombres[tipo]}"`);
  res.send(buffer);
}));
