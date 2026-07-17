import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';

export const ubicacionesRouter = Router();

const tipo = z.enum(['bodega', 'sucursal']);
const idParam = z.coerce.number().int().positive();

interface UbicacionDTO {
  id: number;
  nombre: string;
  codigo: string;
  direccion: string | null;
  tipo: 'bodega' | 'sucursal';
  activo: boolean;
}

function dto(u: {
  id: bigint;
  nombre: string;
  codigo: string;
  direccion: string | null;
  tipo: 'bodega' | 'sucursal';
  activo: boolean;
}): UbicacionDTO {
  return { id: Number(u.id), nombre: u.nombre, codigo: u.codigo, direccion: u.direccion, tipo: u.tipo, activo: u.activo };
}

/** GET /ubicaciones — lista (incluye inactivas) para gestión. Cualquier usuario autenticado. */
ubicacionesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ubic = await prisma.ubicaciones.findMany({
      where: { negocio_id: req.auth!.negocioId },
      orderBy: [{ activo: 'desc' }, { tipo: 'asc' }, { orden_operativo: 'asc' }, { nombre: 'asc' }],
    });
    res.json(ubic.map(dto));
  }),
);

const crearSchema = z.object({
  nombre: z.string().min(1),
  codigo: z.string().min(1).max(20),
  direccion: z.string().optional(),
  tipo,
});

/** POST /ubicaciones — crea bodega o sucursal (admin). */
ubicacionesRouter.post(
  '/',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = crearSchema.parse(req.body);
    const codigo = b.codigo.trim().toUpperCase();
    const dup = await prisma.ubicaciones.findFirst({
      where: { negocio_id: req.auth!.negocioId, codigo },
    });
    if (dup) throw new HttpError(409, `Ya existe una ubicación con el código ${codigo}`);
    const u = await prisma.ubicaciones.create({
      data: {
        negocio_id: req.auth!.negocioId,
        nombre: b.nombre.trim(),
        codigo,
        direccion: b.direccion?.trim() || null,
        tipo: b.tipo,
      },
    });
    res.status(201).json(dto(u));
  }),
);

const editarSchema = z.object({
  nombre: z.string().min(1).optional(),
  codigo: z.string().min(1).max(20).optional(),
  direccion: z.string().nullable().optional(),
  tipo: tipo.optional(),
  activo: z.boolean().optional(),
});

/** PATCH /ubicaciones/:id — edita / activa / desactiva (admin). */
ubicacionesRouter.patch(
  '/:id',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = editarSchema.parse(req.body);
    const actual = await prisma.ubicaciones.findFirst({
      where: { id, negocio_id: req.auth!.negocioId },
    });
    if (!actual) throw new HttpError(404, 'Ubicación no encontrada');

    const codigo = b.codigo ? b.codigo.trim().toUpperCase() : undefined;
    if (codigo && codigo !== actual.codigo) {
      const dup = await prisma.ubicaciones.findFirst({
        where: { negocio_id: req.auth!.negocioId, codigo, id: { not: id } },
      });
      if (dup) throw new HttpError(409, `Ya existe una ubicación con el código ${codigo}`);
    }

    const u = await prisma.ubicaciones.update({
      where: { id },
      data: {
        nombre: b.nombre?.trim(),
        codigo,
        direccion: b.direccion === undefined ? undefined : b.direccion?.trim() || null,
        tipo: b.tipo,
        activo: b.activo,
      },
    });
    res.json(dto(u));
  }),
);
