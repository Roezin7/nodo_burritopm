import { Router } from 'express';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';

export const dashboardRouter = Router();

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** GET /dashboard — resumen operativo del admin. */
dashboardRouter.get(
  '/',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const negocioId = req.auth!.negocioId;

    const ubicaciones = await prisma.ubicaciones.findMany({
      where: { negocio_id: negocioId, activo: true },
      orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
    });

    const valor_por_ubicacion: { id: number; nombre: string; tipo: string; valor: number; conteo_estado: string | null; conteo_fecha: string | null }[] = [];
    const sucursales_pendientes: { id: number; nombre: string }[] = [];
    const sucursales_listas: { id: number; nombre: string; fecha: string }[] = [];
    let bajo_minimo = 0;
    let valor_total = 0;

    for (const u of ubicaciones) {
      const ultimoConteo = await prisma.conteos.findFirst({
        where: { ubicacion_id: u.id },
        orderBy: { id: 'desc' },
        select: { estado: true, creado_at: true },
      });
      const cerrado = await prisma.conteos.findFirst({
        where: { ubicacion_id: u.id, estado: 'cerrado' },
        orderBy: { cerrado_at: 'desc' },
        include: { lineas: { include: { products: { select: { ultimo_costo: true, costo_promedio: true } } } } },
      });

      let valor = 0;
      if (cerrado) {
        for (const l of cerrado.lineas) {
          const costo = num(l.products.ultimo_costo) ?? num(l.products.costo_promedio) ?? 0;
          valor += num0(l.qty) * costo;
        }
        // Productos bajo mínimo en esta ubicación.
        const params = await prisma.producto_ubicacion.findMany({
          where: { ubicacion_id: u.id, habilitado: true },
          select: { product_id: true, stock_min: true },
        });
        const qtyDe = new Map(cerrado.lineas.map((l) => [l.product_id.toString(), num0(l.qty)]));
        for (const p of params) {
          const min = num0(p.stock_min);
          if (min > 0 && (qtyDe.get(p.product_id.toString()) ?? 0) < min) bajo_minimo++;
        }
      }
      valor = r2(valor);
      valor_total += valor;

      valor_por_ubicacion.push({
        id: Number(u.id),
        nombre: u.nombre,
        tipo: u.tipo,
        valor,
        conteo_estado: ultimoConteo?.estado ?? null,
        conteo_fecha: cerrado?.cerrado_at?.toISOString() ?? null,
      });

      if (u.tipo === 'sucursal') {
        if (cerrado) sucursales_listas.push({ id: Number(u.id), nombre: u.nombre, fecha: cerrado.cerrado_at!.toISOString() });
        else sucursales_pendientes.push({ id: Number(u.id), nombre: u.nombre });
      }
    }

    const ultimaDist = await prisma.distribuciones.findFirst({
      where: { negocio_id: negocioId },
      orderBy: { id: 'desc' },
      include: { _count: { select: { lineas: true } } },
    });

    res.json({
      sucursales_total: ubicaciones.filter((u) => u.tipo === 'sucursal').length,
      conteos_pendientes: sucursales_pendientes.length,
      conteos_listos: sucursales_listas.length,
      sucursales_pendientes,
      sucursales_listas,
      bajo_minimo,
      valor_total: r2(valor_total),
      valor_por_ubicacion,
      distribucion_actual: ultimaDist
        ? { id: Number(ultimaDist.id), estado: ultimaDist.estado, creado_at: ultimaDist.creado_at.toISOString(), total_lineas: ultimaDist._count.lineas }
        : null,
    });
  }),
);
