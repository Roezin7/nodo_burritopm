import { z } from 'zod';

/** Valida un :id de ruta como entero positivo (uso: `idParam.parse(req.params.id)`). */
export const idParam = z.coerce.number().int().positive();

/** UUID o identificador opaco generado una sola vez por la captura cliente. */
export const idempotencyKey = z.string().trim().min(16).max(160);
