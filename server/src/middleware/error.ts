import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

/** Clase para errores con código HTTP explícito. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Envuelve handlers async para que los rejects lleguen al errorHandler. */
export const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, detalles: err.details });
  }
  // Solo mensaje + stack: evita volcar propiedades adicionales que algunos errores (p. ej.
  // de Prisma) puedan llevar colgadas, sin perder lo necesario para depurar.
  console.error('Error no manejado:', err instanceof Error ? err.stack ?? err.message : err);
  return res.status(500).json({ error: 'Error interno del servidor' });
};
