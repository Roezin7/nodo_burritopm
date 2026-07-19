import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { firmarToken } from './jwt.js';
import { requireAuth, soloAdmin } from './middleware.js';
import { idParam } from '../lib/validation.js';

export const authRouter = Router();

// Esta ruta es pública (pantalla de selección antes del login) y expone nombres/roles por
// negocio_id: un límite propio, más estricto que el general de la API, reduce su valor para
// reconocimiento dirigido o enumeración de negocios.
const limiteUsuarios = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Ubicaciones asignadas a un usuario (DTO ligero para login / gestión). */
async function ubicacionesDe(usuarioId: bigint) {
  const filas = await prisma.usuario_ubicaciones.findMany({
    where: { usuario_id: usuarioId },
    include: { ubicaciones: { select: { id: true, nombre: true, tipo: true, activo: true } } },
  });
  return filas
    .map((f) => ({
      id: Number(f.ubicaciones.id),
      nombre: f.ubicaciones.nombre,
      tipo: f.ubicaciones.tipo,
      activo: f.ubicaciones.activo,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * GET /auth/usuarios?negocio=1
 * Lista para la pantalla de login (selección visual). No expone pin_hash.
 * Por ahora el negocio es el de Ibérico (id 1); a futuro vendrá por subdominio/selección.
 */
authRouter.get(
  '/usuarios',
  limiteUsuarios,
  asyncHandler(async (req, res) => {
    const negocioId = BigInt(z.coerce.number().int().positive().catch(1).parse(req.query.negocio));
    const usuarios = await prisma.usuarios.findMany({
      where: { negocio_id: negocioId, activo: true },
      select: { id: true, nombre: true, rol: true },
      orderBy: { nombre: 'asc' },
    });
    res.json(usuarios);
  }),
);

const loginSchema = z.object({
  usuario_id: z.coerce.number().int().positive(),
  pin: z.string().regex(/^\d{4,6}$/),
});

/** POST /auth/login { usuario_id, pin } -> { token, usuario } */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { usuario_id, pin } = loginSchema.parse(req.body);
    const usuario = await prisma.usuarios.findFirst({
      where: { id: BigInt(usuario_id), activo: true },
    });
    // Mensaje genérico para no filtrar qué falló.
    if (!usuario || !(await bcrypt.compare(pin, usuario.pin_hash))) {
      throw new HttpError(401, 'Usuario o PIN incorrecto');
    }
    const token = firmarToken({
      sub: usuario.id.toString(),
      negocio_id: usuario.negocio_id.toString(),
      rol: usuario.rol,
      nombre: usuario.nombre,
      auth_version: usuario.auth_version,
    });
    res.json({
      token,
      usuario: {
        id: Number(usuario.id),
        nombre: usuario.nombre,
        rol: usuario.rol,
        requiere_cambio_pin: usuario.requiere_cambio_pin,
        ubicaciones: await ubicacionesDe(usuario.id),
      },
    });
  }),
);

/** GET /auth/me -> datos del usuario autenticado */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuario = await prisma.usuarios.findUnique({
      where: { id: req.auth!.usuarioId },
      select: { id: true, nombre: true, rol: true, negocio_id: true, requiere_cambio_pin: true },
    });
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    res.json({
      id: Number(usuario.id),
      nombre: usuario.nombre,
      rol: usuario.rol,
      requiere_cambio_pin: usuario.requiere_cambio_pin,
      negocio_id: Number(usuario.negocio_id),
      ubicaciones: await ubicacionesDe(usuario.id),
    });
  }),
);

const cambiarPinSchema = z.object({
  pin_actual: z.string().regex(/^\d{4,6}$/),
  pin_nuevo: z.string().regex(/^\d{4,6}$/).refine((pin) => !['1234', '4321'].includes(pin), { message: 'Elige un PIN distinto al temporal' }),
});

/** POST /auth/cambiar-pin { pin_actual, pin_nuevo } */
authRouter.post(
  '/cambiar-pin',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { pin_actual, pin_nuevo } = cambiarPinSchema.parse(req.body);
    const usuario = await prisma.usuarios.findUnique({ where: { id: req.auth!.usuarioId } });
    if (!usuario || !(await bcrypt.compare(pin_actual, usuario.pin_hash))) {
      throw new HttpError(401, 'PIN actual incorrecto');
    }
    await prisma.usuarios.update({
      where: { id: usuario.id },
      data: { pin_hash: await bcrypt.hash(pin_nuevo, 10), auth_version: { increment: 1 }, requiere_cambio_pin: false },
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
//  Administración de usuarios (solo admin)
// ---------------------------------------------------------------------------
const rol = z.enum(['admin', 'encargado_bodega', 'encargado_sucursal']);

/**
 * Valida que los ids de ubicación pertenezcan al negocio y devuelve los BigInt.
 * Lanza 400 si alguno no existe en el negocio.
 */
async function validarUbicaciones(negocioId: bigint, ids: number[]): Promise<bigint[]> {
  if (ids.length === 0) return [];
  const bigIds = [...new Set(ids)].map((n) => BigInt(n));
  const ok = await prisma.ubicaciones.findMany({
    where: { id: { in: bigIds }, negocio_id: negocioId },
    select: { id: true },
  });
  if (ok.length !== bigIds.length) throw new HttpError(400, 'Alguna ubicación no pertenece al negocio');
  return bigIds;
}

/** Reemplaza las asignaciones de ubicación de un usuario. */
async function setUbicaciones(usuarioId: bigint, ubicacionIds: bigint[]) {
  await prisma.$transaction([
    prisma.usuario_ubicaciones.deleteMany({ where: { usuario_id: usuarioId } }),
    prisma.usuario_ubicaciones.createMany({
      data: ubicacionIds.map((ubicacion_id) => ({ usuario_id: usuarioId, ubicacion_id })),
      skipDuplicates: true,
    }),
  ]);
}

/** GET /auth/admin/usuarios — lista completa (incluye inactivos) para gestión. */
authRouter.get(
  '/admin/usuarios',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const usuarios = await prisma.usuarios.findMany({
      where: { negocio_id: req.auth!.negocioId },
      select: {
        id: true,
        nombre: true,
        rol: true,
        activo: true,
        ubicaciones_asignadas: { select: { ubicacion_id: true } },
      },
      orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
    });
    res.json(
      usuarios.map((u) => ({
        id: Number(u.id),
        nombre: u.nombre,
        rol: u.rol,
        activo: u.activo,
        ubicacion_ids: u.ubicaciones_asignadas.map((a) => Number(a.ubicacion_id)),
      })),
    );
  }),
);

/** POST /auth/admin/usuarios { nombre, rol, pin, ubicacion_ids? } — crea un usuario. */
authRouter.post(
  '/admin/usuarios',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        nombre: z.string().min(1),
        rol,
        pin: z.string().regex(/^\d{4,6}$/),
        ubicacion_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
      })
      .parse(req.body);
    const ubic = await validarUbicaciones(req.auth!.negocioId, b.ubicacion_ids);
    const u = await prisma.usuarios.create({
      data: { negocio_id: req.auth!.negocioId, nombre: b.nombre, rol: b.rol, pin_hash: await bcrypt.hash(b.pin, 10) },
    });
    if (ubic.length) await setUbicaciones(u.id, ubic);
    res.status(201).json({ id: Number(u.id) });
  }),
);

/** Evita dejar al negocio sin ningún admin activo. */
async function quedaAlgunAdmin(negocioId: bigint, exceptoId: bigint): Promise<boolean> {
  const n = await prisma.usuarios.count({ where: { negocio_id: negocioId, rol: 'admin', activo: true, id: { not: exceptoId } } });
  return n > 0;
}

/** PATCH /auth/admin/usuarios/:id { nombre?, rol?, activo?, ubicacion_ids? } */
authRouter.patch(
  '/admin/usuarios/:id',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = z
      .object({
        nombre: z.string().min(1).optional(),
        rol: rol.optional(),
        activo: z.boolean().optional(),
        ubicacion_ids: z.array(z.coerce.number().int().positive()).optional(),
      })
      .parse(req.body);
    const usuario = await prisma.usuarios.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    // No permitir quitar el último admin (ni desactivándolo ni cambiándolo de rol).
    const dejaDeSerAdmin = (b.rol && b.rol !== 'admin') || b.activo === false;
    if (usuario.rol === 'admin' && dejaDeSerAdmin && !(await quedaAlgunAdmin(req.auth!.negocioId, id))) {
      throw new HttpError(409, 'No puedes dejar el negocio sin ningún administrador activo.');
    }
    if (b.ubicacion_ids !== undefined) {
      const ubic = await validarUbicaciones(req.auth!.negocioId, b.ubicacion_ids);
      await setUbicaciones(id, ubic);
    }
    const revocarSesiones = (b.rol !== undefined && b.rol !== usuario.rol)
      || (b.activo !== undefined && b.activo !== usuario.activo);
    await prisma.usuarios.update({
      where: { id },
      data: { nombre: b.nombre, rol: b.rol, activo: b.activo, auth_version: revocarSesiones ? { increment: 1 } : undefined },
    });
    res.json({ ok: true });
  }),
);

/** DELETE /auth/admin/usuarios/:id — elimina un usuario (no a sí mismo ni al último admin). */
authRouter.delete(
  '/admin/usuarios/:id',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    if (id === req.auth!.usuarioId) throw new HttpError(409, 'No puedes eliminar tu propio usuario.');
    const usuario = await prisma.usuarios.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    if (usuario.rol === 'admin' && !(await quedaAlgunAdmin(req.auth!.negocioId, id))) {
      throw new HttpError(409, 'No puedes eliminar al último administrador.');
    }
    // usuario_ubicaciones se borra en cascada; las referencias históricas son sueltas.
    await prisma.usuarios.delete({ where: { id } });
    res.json({ ok: true });
  }),
);

/** POST /auth/admin/usuarios/:id/reset-pin { pin_nuevo } — el admin restablece el PIN. */
authRouter.post(
  '/admin/usuarios/:id/reset-pin',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const { pin_nuevo } = z.object({ pin_nuevo: z.string().regex(/^\d{4,6}$/) }).parse(req.body);
    const usuario = await prisma.usuarios.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!usuario) throw new HttpError(404, 'Usuario no encontrado');
    await prisma.usuarios.update({
      where: { id },
      data: { pin_hash: await bcrypt.hash(pin_nuevo, 10), auth_version: { increment: 1 }, requiere_cambio_pin: ['1234', '4321'].includes(pin_nuevo) },
    });
    res.json({ ok: true });
  }),
);
