import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { importarHistorial, resumenHistorial } from './historial.service.js';

export const inventarioRouter = Router();

inventarioRouter.use(requireAuth);

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
