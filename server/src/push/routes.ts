import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../auth/middleware.js';
import { env } from '../env.js';
import { borrarSuscripcion, enviarAUsuarios, guardarSuscripcion, pushHabilitado } from './service.js';

export const pushRouter = Router();

/** GET /push/clave — clave pública VAPID (vacío si push está deshabilitado). */
pushRouter.get('/clave', (_req, res) => {
  res.json({ habilitado: pushHabilitado, clave: pushHabilitado ? env.VAPID_PUBLIC_KEY : '' });
});

pushRouter.use(requireAuth);

const subSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/** POST /push/suscribir { endpoint, keys } — registra el dispositivo del usuario. */
pushRouter.post(
  '/suscribir',
  asyncHandler(async (req, res) => {
    const sub = subSchema.parse(req.body);
    await guardarSuscripcion(req.auth!.negocioId, req.auth!.usuarioId, sub);
    res.status(201).json({ ok: true });
  }),
);

/** POST /push/baja { endpoint } — elimina la suscripción. */
pushRouter.post(
  '/baja',
  asyncHandler(async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
    await borrarSuscripcion(endpoint, req.auth!.usuarioId);
    res.json({ ok: true });
  }),
);

/** POST /push/probar — envía un aviso de prueba al propio usuario. */
pushRouter.post(
  '/probar',
  asyncHandler(async (req, res) => {
    await enviarAUsuarios([req.auth!.usuarioId], { titulo: '¡Avisos activados! ✅', cuerpo: 'Aquí recibirás tus tareas del día.', url: '/' });
    res.json({ ok: true });
  }),
);
