import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { authRouter } from '../auth/routes.js';
import { ubicacionesRouter } from '../ubicaciones/routes.js';
import { catalogoRouter } from '../catalogo/routes.js';
import { conteosRouter } from '../conteos/routes.js';
import { distribucionesRouter } from '../distribuciones/routes.js';
import { rutasRouter } from '../distribuciones/rutas.routes.js';
import { dashboardRouter } from '../dashboard/routes.js';
import { existenciasRouter } from '../existencias/routes.js';
import { incidenciasRouter } from '../incidencias/routes.js';
import { negocioRouter } from '../negocio/routes.js';
import { pushRouter } from '../push/routes.js';
import { inventarioRouter } from '../inventario/routes.js';

export const apiRouter = Router();

apiRouter.get('/health', asyncHandler(async (_req, res) => {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  res.status(db ? 200 : 503).json({ ok: db, servicio: 'burrito-parrilla', db, ts: new Date().toISOString() });
}));

apiRouter.use('/auth', authRouter); // Bloque 0
apiRouter.use('/ubicaciones', ubicacionesRouter); // Bloque 1
apiRouter.use('/catalogo', catalogoRouter); // Bloque 3
apiRouter.use('/conteos', conteosRouter); // Bloque 5
apiRouter.use('/distribuciones', distribucionesRouter); // Bloque 6
apiRouter.use('/rutas', rutasRouter); // Bloque 12 — rutas de entrega
apiRouter.use('/dashboard', dashboardRouter); // Bloque 7
apiRouter.use('/existencias', existenciasRouter); // Bloque 8
apiRouter.use('/incidencias', incidenciasRouter); // Bloque 11
apiRouter.use('/negocio', negocioRouter); // settings de operación
apiRouter.use('/push', pushRouter); // avisos web push
apiRouter.use('/inventario', inventarioRouter); // Fase 3 — stock objetivo (motor) + historial
