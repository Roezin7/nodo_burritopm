import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncHandler, HttpError } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { idParam } from '../lib/validation.js';

export const incidenciasRouter = Router();

/** GET /incidencias?estado=abierta|todas — lista de incidencias (admin). */
incidenciasRouter.get(
  '/',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const estado = z.enum(['abierta', 'resuelta', 'todas']).catch('abierta').parse(req.query.estado);
    const incidencias = await prisma.incidencias.findMany({
      where: { negocio_id: req.auth!.negocioId, ...(estado === 'todas' ? {} : { estado }) },
      orderBy: { id: 'desc' },
    });
    // Nombres de producto/ubicación para mostrar.
    const prodIds = [...new Set(incidencias.map((i) => i.product_id).filter(Boolean))] as bigint[];
    const ubicIds = [...new Set(incidencias.map((i) => i.ubicacion_id).filter(Boolean))] as bigint[];
    const [prods, ubics] = await Promise.all([
      prisma.products.findMany({ where: { negocio_id: req.auth!.negocioId, id: { in: prodIds } }, select: { id: true, nombre: true } }),
      prisma.ubicaciones.findMany({ where: { negocio_id: req.auth!.negocioId, id: { in: ubicIds } }, select: { id: true, nombre: true } }),
    ]);
    const pName = new Map(prods.map((p) => [p.id.toString(), p.nombre]));
    const uName = new Map(ubics.map((u) => [u.id.toString(), u.nombre]));
    res.json(
      incidencias.map((i) => ({
        id: Number(i.id),
        tipo: i.tipo,
        prioridad: i.prioridad,
        estado: i.estado,
        ubicacion: i.ubicacion_id ? uName.get(i.ubicacion_id.toString()) ?? null : null,
        producto: i.product_id ? pName.get(i.product_id.toString()) ?? null : null,
        documento_tipo: i.documento_tipo,
        documento_id: i.documento_id ? Number(i.documento_id) : null,
        comentarios: i.comentarios,
        creado_at: i.creado_at.toISOString(),
        resuelto_at: i.resuelto_at?.toISOString() ?? null,
      })),
    );
  }),
);

/** POST /incidencias/:id/resolver { comentario? } — marca resuelta (admin). */
incidenciasRouter.post(
  '/:id/resolver',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const id = BigInt(idParam.parse(req.params.id));
    const b = z.object({ comentario: z.string().optional() }).parse(req.body ?? {});
    const inc = await prisma.incidencias.findFirst({ where: { id, negocio_id: req.auth!.negocioId } });
    if (!inc) throw new HttpError(404, 'Incidencia no encontrada');
    await prisma.incidencias.update({
      where: { id },
      data: {
        estado: 'resuelta',
        resuelto_at: new Date(),
        resuelto_por: req.auth!.usuarioId,
        comentarios: b.comentario ? `${inc.comentarios ?? ''}\nResolución: ${b.comentario}`.trim() : inc.comentarios,
      },
    });
    res.json({ ok: true });
  }),
);
