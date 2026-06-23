import type { RequestHandler } from 'express';
import { verificarToken, type JwtPayload, type Rol } from './jwt.js';
import { HttpError } from '../middleware/error.js';

// Extiende Request con el usuario autenticado.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtPayload & { negocioId: bigint; usuarioId: bigint };
    }
  }
}

/** Exige un JWT válido; adjunta req.auth con IDs ya convertidos a BigInt. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Falta el token de autenticación');
  }
  try {
    const payload = verificarToken(header.slice(7));
    req.auth = {
      ...payload,
      negocioId: BigInt(payload.negocio_id),
      usuarioId: BigInt(payload.sub),
    };
    next();
  } catch {
    throw new HttpError(401, 'Token inválido o expirado');
  }
};

/** Exige uno de los roles dados. Usar SIEMPRE después de requireAuth. */
export const requireRole =
  (...roles: Rol[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'No autenticado');
    if (!roles.includes(req.auth.rol)) {
      throw new HttpError(403, 'No tienes permiso para esta sección');
    }
    next();
  };

/** Atajo: solo admin general (configuración, catálogo, usuarios, distribución). */
export const soloAdmin = requireRole('admin');
