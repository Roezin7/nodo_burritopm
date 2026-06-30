import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { sugerirStockObjetivo } from './stockObjetivo.service.js';
import { importarHistorial, resumenHistorial } from './historial.service.js';

export const inventarioRouter = Router();

inventarioRouter.use(requireAuth);

/** GET /inventario/stock-objetivo/sugerencia?ubicacion=ID&nivel_servicio=97.5&lead_time=1 */
inventarioRouter.get(
  '/stock-objetivo/sugerencia',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const ubicacionId = BigInt(z.coerce.number().int().positive().parse(req.query.ubicacion));
    const nivelServicio = z.coerce.number().min(50).max(99.9).optional().parse(req.query.nivel_servicio);
    const leadTimeDias = z.coerce.number().int().min(0).max(30).optional().parse(req.query.lead_time);
    res.json(await sugerirStockObjetivo(req.auth!.negocioId, ubicacionId, { nivelServicio, leadTimeDias }));
  }),
);

const filaSchema = z.object({
  ubicacion_id: z.coerce.number().int().positive().optional(),
  sucursal: z.string().optional(),
  product_id: z.coerce.number().int().positive().optional(),
  sku: z.string().optional(),
  producto: z.string().optional(),
  fecha: z.string(),
  cantidad: z.coerce.number(),
});

/** POST /inventario/historial/import { items[], reemplazar? } — carga pedidos históricos (PDFs migrados). */
inventarioRouter.post(
  '/historial/import',
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z.object({ items: z.array(filaSchema).min(1).max(50000), reemplazar: z.boolean().optional() }).parse(req.body);
    if (b.items.length === 0) throw new HttpError(400, 'No hay filas para importar');
    res.json(await importarHistorial(req.auth!.negocioId, b.items, b.reemplazar ?? false));
  }),
);

/** GET /inventario/historial/resumen — qué historial hay cargado (por sucursal y rango). */
inventarioRouter.get(
  '/historial/resumen',
  soloAdmin,
  asyncHandler(async (req, res) => {
    res.json(await resumenHistorial(req.auth!.negocioId));
  }),
);
