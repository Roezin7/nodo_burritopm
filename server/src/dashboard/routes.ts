import { Router } from 'express';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';

export const dashboardRouter = Router();

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Estados de distribución en los que el pedido ya salió a la calle (recepción tiene sentido).
const EN_RUTA_O_DESPUES = new Set(['en_transito', 'parcialmente_entregada', 'entregada', 'cerrada', 'cerrada_con_incidencias']);

/**
 * GET /dashboard/ciclo — semáforo del ciclo por sucursal: pedido (de hoy), si está en el
 * pedido actual y su recepción. Una sola fila por sucursal para que el admin vea de un vistazo
 * quién frena el ciclo.
 */
dashboardRouter.get(
  '/ciclo',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const negocioId = req.auth!.negocioId;
    const negocio = await prisma.negocios.findUnique({ where: { id: negocioId }, select: { zona_horaria: true } });
    const tz = negocio?.zona_horaria ?? 'America/Chicago';
    const hoyISO = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const hoy = new Date(`${hoyISO}T00:00:00.000Z`);

    const sucursales = await prisma.ubicaciones.findMany({
      where: { negocio_id: negocioId, tipo: 'sucursal', activo: true },
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true },
    });

    const sucIds = sucursales.map((s) => s.id);
    // Pedido de HOY por sucursal (una sola consulta; usa la tabla de conteos como sesión).
    const conteosHoy = await prisma.conteos.findMany({
      where: { negocio_id: negocioId, fecha: hoy, ubicacion_id: { in: sucIds } },
      select: { ubicacion_id: true, estado: true },
    });
    const conteoDe = new Map(conteosHoy.map((c) => [c.ubicacion_id.toString(), c.estado]));
    // Sucursales con algún pedido ya cerrado (para no marcar "falta" fuera del día programado).
    const cerradosPrevios = await prisma.conteos.findMany({
      where: { negocio_id: negocioId, estado: 'cerrado', ubicacion_id: { in: sucIds } },
      distinct: ['ubicacion_id'],
      select: { ubicacion_id: true },
    });
    const tieneCerrado = new Set(cerradosPrevios.map((c) => c.ubicacion_id.toString()));

    // Distribución actual y sus líneas por sucursal (para "pedido" y "recepción").
    const dist = await prisma.distribuciones.findFirst({
      where: { negocio_id: negocioId },
      orderBy: { id: 'desc' },
      include: { _count: { select: { lineas: true } } },
    });
    const enRuta = dist ? EN_RUTA_O_DESPUES.has(dist.estado) : false;
    const lineas = dist
      ? await prisma.distribucion_lineas.findMany({
          where: { distribucion_id: dist.id },
          select: { ubicacion_destino_id: true, cantidad_recibida: true },
        })
      : [];
    const porSuc = new Map<string, { total: number; recibidas: number }>();
    for (const l of lineas) {
      const k = l.ubicacion_destino_id.toString();
      const g = porSuc.get(k) ?? { total: 0, recibidas: 0 };
      g.total++;
      if (l.cantidad_recibida != null) g.recibidas++;
      porSuc.set(k, g);
    }

    const filas = sucursales.map((s) => {
      const k = s.id.toString();
      const cEstado = conteoDe.get(k);
      // Listo si cerró hoy o ya tiene un cierre reciente; en captura si hoy está abierto; falta si nunca.
      const conteo = cEstado === 'cerrado' ? 'cerrado' : cEstado ? 'abierto' : tieneCerrado.has(k) ? 'cerrado' : 'pendiente';
      const g = porSuc.get(s.id.toString());
      const pedido = !dist ? 'na' : g ? 'en' : 'sin';
      let recepcion: 'recibido' | 'parcial' | 'pendiente' | 'na' = 'na';
      if (dist && g && enRuta) {
        recepcion = g.recibidas === 0 ? 'pendiente' : g.recibidas < g.total ? 'parcial' : 'recibido';
      }
      return { id: Number(s.id), nombre: s.nombre, conteo, pedido, recepcion };
    });

    res.json({
      distribucion: dist ? { id: Number(dist.id), estado: dist.estado, total_lineas: dist._count.lineas } : null,
      sucursales: filas,
    });
  }),
);

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
        select: { cerrado_at: true },
      });

      const existencias = await prisma.existencias.findMany({
        where: { ubicacion_id: u.id },
        include: { products: { select: { ultimo_costo: true, costo_promedio: true } } },
      });
      let valor = 0;
      for (const e of existencias) {
        const costo = num(e.costo_promedio) ?? num(e.products.ultimo_costo) ?? num(e.products.costo_promedio) ?? 0;
        valor += num0(e.cantidad_disponible) * costo;
      }

      // Bajo mínimo aplica al inventario operativo de bodega; sucursales ya piden directo.
      if (u.tipo === 'bodega') {
        const params = await prisma.producto_ubicacion.findMany({
          where: { ubicacion_id: u.id, habilitado: true },
          select: { product_id: true, stock_min: true },
        });
        const qtyDe = new Map(existencias.map((e) => [e.product_id.toString(), num0(e.cantidad_disponible)]));
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
