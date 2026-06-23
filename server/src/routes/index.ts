import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../middleware/error.js';
import { authRouter } from '../auth/routes.js';
import { ubicacionesRouter } from '../ubicaciones/routes.js';
import { catalogoRouter } from '../catalogo/routes.js';

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
