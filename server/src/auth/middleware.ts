import type { RequestHandler } from 'express';
import { verificarToken, type JwtPayload, type Rol } from './jwt.js';
import { HttpError } from '../middleware/error.js';
import { prisma } from '../db.js';

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
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new HttpError(401, 'Falta el token de autenticación'));
    return;
  }
  try {
    const payload = verificarToken(header.slice(7));
    const usuarioId = BigInt(payload.sub);
    const usuario = await prisma.usuarios.findFirst({
      where: { id: usuarioId, activo: true },
      select: { negocio_id: true, nombre: true, rol: true, auth_version: true },
    });
    if (!usuario
      || usuario.negocio_id.toString() !== payload.negocio_id
      || usuario.auth_version !== payload.auth_version) {
      throw new HttpError(401, 'La sesión ya no es válida');
    }
    req.auth = {
      ...payload, nombre: usuario.nombre, rol: usuario.rol,
      negocioId: usuario.negocio_id,
      usuarioId,
    };
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'Token inválido o expirado'));
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

/** IDs de las ubicaciones asignadas a un usuario (vacío = ninguna). */
export async function ubicacionesDeUsuario(usuarioId: bigint): Promise<bigint[]> {
  const filas = await prisma.usuario_ubicaciones.findMany({
    where: { usuario_id: usuarioId },
    select: { ubicacion_id: true },
  });
  return filas.map((f) => f.ubicacion_id);
}

/**
 * ¿Puede el usuario operar sobre esta ubicación? El admin siempre puede; el resto solo
 * sobre ubicaciones que tenga asignadas. Valida además que la ubicación sea del negocio.
 */
export async function usuarioPuedeUbicacion(
  req: Parameters<RequestHandler>[0],
  ubicacionId: bigint,
): Promise<boolean> {
  if (!req.auth) return false;
  const ubic = await prisma.ubicaciones.findFirst({
    where: { id: ubicacionId, negocio_id: req.auth.negocioId },
    select: { id: true },
  });
  if (!ubic) return false;
  if (req.auth.rol === 'admin') return true;
  const asignadas = await ubicacionesDeUsuario(req.auth.usuarioId);
  return asignadas.some((id) => id === ubicacionId);
}

/**
 * Middleware: exige acceso a la ubicación indicada por `:<param>` en la ruta (default
 * "ubicacionId"). Usar después de requireAuth. El admin pasa siempre.
 */
export const requireUbicacion =
  (param = 'ubicacionId'): RequestHandler =>
  async (req, _res, next) => {
    try {
      const raw = req.params[param];
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Ubicación inválida');
      if (!(await usuarioPuedeUbicacion(req, BigInt(n)))) {
        throw new HttpError(403, 'No tienes acceso a esta ubicación');
      }
      next();
    } catch (e) {
      next(e);
    }
  };
