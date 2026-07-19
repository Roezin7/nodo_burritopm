import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { idParam } from '../lib/validation.js';

export const ubicacionesRouter = Router();

const tipo = z.enum(['bodega', 'sucursal']);

interface UbicacionDTO {
  id: number;
  nombre: string;
  codigo: string;
  direccion: string | null;
  tipo: 'bodega' | 'sucursal';
  activo: boolean;
  empresa_cliente_id: number | null;
  entrega_en_ubicacion_id: number | null;
  orden_operativo: number;
}

function dto(u: {
  id: bigint;
  nombre: string;
  codigo: string;
  direccion: string | null;
  tipo: 'bodega' | 'sucursal';
  activo: boolean;
  empresa_cliente_id: bigint | null;
  entrega_en_ubicacion_id: bigint | null;
  orden_operativo: number;
}): UbicacionDTO {
  return {
    id: Number(u.id), nombre: u.nombre, codigo: u.codigo, direccion: u.direccion, tipo: u.tipo, activo: u.activo,
    empresa_cliente_id: u.empresa_cliente_id ? Number(u.empresa_cliente_id) : null,
    entrega_en_ubicacion_id: u.entrega_en_ubicacion_id ? Number(u.entrega_en_ubicacion_id) : null,
    orden_operativo: u.orden_operativo,
  };
}

async function validarReferencias(negocioId: bigint, empresaId?: number | null, entregaId?: number | null) {
  if (empresaId) {
    const existe = await prisma.empresas_clientes.count({ where: { id: BigInt(empresaId), negocio_id: negocioId, activo: true } });
    if (!existe) throw new HttpError(400, 'La empresa seleccionada no pertenece al negocio');
  }
  if (entregaId) {
    const existe = await prisma.ubicaciones.count({ where: { id: BigInt(entregaId), negocio_id: negocioId, tipo: 'sucursal', activo: true } });
    if (!existe) throw new HttpError(400, 'El punto de entrega seleccionado no es válido');
  }
}

/** Empresas disponibles para facturar y agrupar restaurantes. */
ubicacionesRouter.get('/empresas', requireAuth, asyncHandler(async (req, res) => {
  const empresas = await prisma.empresas_clientes.findMany({
    where: { negocio_id: req.auth!.negocioId, activo: true }, orderBy: { codigo: 'asc' },
    select: { id: true, codigo: true, nombre: true },
  });
  res.json(empresas.map((e) => ({ ...e, id: Number(e.id) })));
}));

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
  empresa_cliente_id: z.coerce.number().int().positive().nullable().optional(),
  entrega_en_ubicacion_id: z.coerce.number().int().positive().nullable().optional(),
  orden_operativo: z.coerce.number().int().min(0).max(9999).optional(),
});

/** POST /ubicaciones — crea bodega o sucursal (admin). */
ubicacionesRouter.post(
  '/',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const b = crearSchema.parse(req.body);
    await validarReferencias(req.auth!.negocioId, b.empresa_cliente_id, b.entrega_en_ubicacion_id);
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
        empresa_cliente_id: b.tipo === 'sucursal' && b.empresa_cliente_id ? BigInt(b.empresa_cliente_id) : null,
        entrega_en_ubicacion_id: b.tipo === 'sucursal' && b.entrega_en_ubicacion_id ? BigInt(b.entrega_en_ubicacion_id) : null,
        orden_operativo: b.orden_operativo ?? 999,
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
  empresa_cliente_id: z.coerce.number().int().positive().nullable().optional(),
  entrega_en_ubicacion_id: z.coerce.number().int().positive().nullable().optional(),
  orden_operativo: z.coerce.number().int().min(0).max(9999).optional(),
});

/** PATCH /ubicaciones/:id — edita / activa / desactiva (admin). */
ubicacionesRouter.patch(
  '/:id',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = editarSchema.parse(req.body);
    await validarReferencias(req.auth!.negocioId, b.empresa_cliente_id, b.entrega_en_ubicacion_id);
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
        empresa_cliente_id: b.tipo === 'bodega' ? null : b.empresa_cliente_id === undefined ? undefined : b.empresa_cliente_id ? BigInt(b.empresa_cliente_id) : null,
        entrega_en_ubicacion_id: b.tipo === 'bodega' ? null : b.entrega_en_ubicacion_id === undefined ? undefined : b.entrega_en_ubicacion_id ? BigInt(b.entrega_en_ubicacion_id) : null,
        orden_operativo: b.orden_operativo,
      },
    });
    res.json(dto(u));
  }),
);
