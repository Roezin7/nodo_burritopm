import { Router } from 'express';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { semanaDeFecha } from '../cierre/service.js';
import type { Prisma } from '@prisma/client';

export const dashboardRouter = Router();

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Estados de distribución en los que el pedido ya salió a la calle (recepción tiene sentido).
const EN_RUTA_O_DESPUES = new Set(['en_transito', 'parcialmente_entregada', 'entregada', 'cerrada', 'cerrada_con_incidencias']);
const DIST_FINAL = ['entregada', 'cerrada', 'cerrada_con_incidencias', 'cancelada'] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const precioPedido = (l: { precio_unitario: Prisma.Decimal | null; producto: { precio_venta_fijo: Prisma.Decimal | null; ultimo_costo: Prisma.Decimal | null; costo_promedio: Prisma.Decimal | null; tipo_operativo: string | null; markup_caja: Prisma.Decimal } }) => {
  const guardado = num(l.precio_unitario);
  if (guardado != null) return guardado;
  const fijo = num(l.producto.precio_venta_fijo);
  if (fijo != null) return fijo;
  const costo = num(l.producto.ultimo_costo) ?? num(l.producto.costo_promedio) ?? 0;
  return costo + (l.producto.tipo_operativo === 'proteina' ? num0(l.producto.markup_caja) : 0);
};

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

/** Panorama semanal consolidado a partir de los mismos totales que gobiernan los Excel. */
dashboardRouter.get(
  '/general',
  requireAuth,
  soloAdmin,
  asyncHandler(async (req, res) => {
    const negocioId = req.auth!.negocioId;
    const negocio = await prisma.negocios.findUnique({ where: { id: negocioId }, select: { zona_horaria: true, reparto_habilitado: true } });
    const tz = negocio?.zona_horaria ?? 'America/Chicago';
    const hoyISO = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const hoy = new Date(`${hoyISO}T00:00:00.000Z`);
    const periodo = semanaDeFecha(hoy);

    const semana = await prisma.semanas_operativas.findUnique({
      where: { negocio_id_anio_semana: { negocio_id: negocioId, anio: periodo.anio, semana: periodo.semana } },
    });
    const [empresas, facturasSemana, pedidos, existencias, lotes, facturasPendientes, comprasPendientes, producciones, comprasSemana, distribuciones, parametros] = await Promise.all([
      prisma.empresas_clientes.findMany({ where: { negocio_id: negocioId, activo: true }, orderBy: { codigo: 'asc' } }),
      semana ? prisma.facturas.findMany({
        where: { semana_id: semana.id, estado: { not: 'anulada' } },
        include: { empresa: true, lineas: { include: { producto: true } } },
      }) : Promise.resolve([]),
      prisma.pedidos_operativos.findMany({
        where: { negocio_id: negocioId, fecha_entrega: { gte: periodo.lunes, lte: periodo.sabado }, estado: { not: 'cancelado' } },
        include: { empresa: true, lineas: { include: { producto: true } } },
      }),
      prisma.existencias.findMany({
        where: { negocio_id: negocioId, OR: [{ cantidad_disponible: { gt: 0 } }, { cantidad_transito: { gt: 0 } }], ubicaciones: { tipo: 'bodega', activo: true } },
        include: { products: true, ubicaciones: { select: { id: true, nombre: true } } },
      }),
      prisma.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 } } }),
      prisma.facturas.findMany({ where: { negocio_id: negocioId, estado: 'emitida' }, include: { pagos: true } }),
      prisma.compras.findMany({ where: { negocio_id: negocioId, estado: 'pendiente' } }),
      prisma.producciones.findMany({
        where: { negocio_id: negocioId, fecha: { gte: periodo.lunes, lte: periodo.sabado } },
        include: { salidas: true },
      }),
      prisma.compras.findMany({ where: { negocio_id: negocioId, fecha: { gte: periodo.lunes, lte: periodo.sabado }, estado: { not: 'cancelada' } } }),
      prisma.distribuciones.findMany({
        where: { negocio_id: negocioId, fecha_entrega: { gte: periodo.lunes, lte: periodo.sabado }, estado: { notIn: [...DIST_FINAL] } },
        include: { rutas: { include: { paradas: true } } },
      }),
      prisma.producto_ubicacion.findMany({
        where: { negocio_id: negocioId, habilitado: true, stock_min: { gt: 0 }, ubicaciones: { tipo: 'bodega', activo: true } },
        select: { ubicacion_id: true, product_id: true, stock_min: true },
      }),
    ]);

    const facturasOperativas = facturasSemana.filter((f) => !f.numero.endsWith('-OPEN'));
    const usarFacturas = facturasOperativas.length > 0;
    const porEmpresa = new Map(empresas.map((e) => [e.id.toString(), { codigo: e.codigo, nombre: e.nombre, carne: 0, desechables: 0, total: 0 }]));
    let ventaCarne = 0;
    let ventaDesechables = 0;
    let markupProteina = 0;
    if (usarFacturas) {
      for (const f of facturasOperativas) {
        const total = num0(f.total);
        if (f.linea_operacion === 'carne') ventaCarne += total; else ventaDesechables += total;
        const g = porEmpresa.get(f.empresa_cliente_id.toString());
        if (g) { g[f.linea_operacion] += total; g.total += total; }
        for (const l of f.lineas) if (l.producto?.tipo_operativo === 'proteina') markupProteina += num0(l.cantidad) * num0(l.producto.markup_caja);
      }
    } else {
      for (const p of pedidos.filter((x) => x.estado !== 'borrador')) {
        const g = porEmpresa.get(p.empresa_cliente_id.toString());
        for (const l of p.lineas) {
          const total = num0(l.cantidad) * precioPedido(l);
          const linea = l.producto.linea_operacion ?? p.linea_operacion;
          if (linea === 'carne') ventaCarne += total; else ventaDesechables += total;
          if (g) { g[linea] += total; g.total += total; }
          if (l.producto.tipo_operativo === 'proteina') markupProteina += num0(l.cantidad) * num0(l.producto.markup_caja);
        }
      }
    }

    let carneTerminada = 0;
    let desechables = 0;
    for (const e of existencias) {
      if (e.products.tipo_operativo === 'materia_prima') continue; // los lotes conservan el costo exacto y el estado fresco/congelado
      const valor = (num0(e.cantidad_disponible) + num0(e.cantidad_transito)) * (num(e.costo_promedio) ?? num(e.products.ultimo_costo) ?? num(e.products.costo_promedio) ?? 0);
      if (e.products.linea_operacion === 'carne') carneTerminada += valor;
      if (e.products.linea_operacion === 'desechables') desechables += valor;
    }
    const materiaFresca = lotes.filter((l) => !l.congelado).reduce((a, l) => a + num0(l.costo_disponible), 0);
    const materiaCongelada = lotes.filter((l) => l.congelado).reduce((a, l) => a + num0(l.costo_disponible), 0);
    const inventarioTotal = materiaFresca + materiaCongelada + carneTerminada + desechables;

    const saldoFactura = (f: (typeof facturasPendientes)[number]) => Math.max(0, num0(f.total) - f.pagos.reduce((a, p) => a + num0(p.monto), 0));
    const porCobrar = facturasPendientes.reduce((a, f) => a + saldoFactura(f), 0);
    const vencidoCobrar = facturasPendientes.filter((f) => f.vence_at < hoy).reduce((a, f) => a + saldoFactura(f), 0);
    const porPagar = comprasPendientes.reduce((a, c) => a + num0(c.total), 0);
    const vencidoPagar = comprasPendientes.filter((c) => c.vence_at < hoy).reduce((a, c) => a + num0(c.total), 0);

    const pesoEntrada = producciones.reduce((a, p) => a + num0(p.peso_entrada_lb), 0);
    const pesoSalida = producciones.reduce((a, p) => a + num0(p.peso_salida_lb), 0);
    const cajasProduccion = producciones.reduce((a, p) => a + p.salidas.reduce((x, s) => x + num0(s.cajas), 0), 0);
    const costoProduccion = producciones.reduce((a, p) => a + num0(p.costo_entrada), 0);
    const comprasTotal = comprasSemana.reduce((a, c) => a + num0(c.total), 0);
    const paradasPendientes = negocio?.reparto_habilitado
      ? distribuciones.reduce((a, d) => a + d.rutas
        .filter((r) => r.estado === 'en_curso')
        .reduce((x, r) => x + r.paradas.filter((p) => !['confirmada', 'con_incidencia', 'omitida'].includes(p.estado)).length, 0), 0)
      : 0;
    const existenciaDe = new Map(existencias.map((e) => [`${e.ubicacion_id}:${e.product_id}`, num0(e.cantidad_disponible)]));
    const bajoMinimo = parametros.filter((p) => (existenciaDe.get(`${p.ubicacion_id}:${p.product_id}`) ?? 0) < num0(p.stock_min)).length;

    const alertas: { tipo: 'cobro' | 'pago' | 'inventario' | 'pedido' | 'reparto'; titulo: string; detalle: string; ruta: string }[] = [];
    if (vencidoCobrar > 0) alertas.push({ tipo: 'cobro', titulo: 'Facturas vencidas', detalle: `${facturasPendientes.filter((f) => f.vence_at < hoy).length} facturas · $${r2(vencidoCobrar).toLocaleString('en-US')}`, ruta: '/semana/cierre' });
    if (vencidoPagar > 0) alertas.push({ tipo: 'pago', titulo: 'Compras vencidas', detalle: `${comprasPendientes.filter((c) => c.vence_at < hoy).length} compras · $${r2(vencidoPagar).toLocaleString('en-US')}`, ruta: '/semana/compras' });
    if (bajoMinimo > 0) alertas.push({ tipo: 'inventario', titulo: 'Inventario bajo mínimo', detalle: `${bajoMinimo} productos necesitan atención`, ruta: '/inventario' });
    const borradores = pedidos.filter((p) => p.estado === 'borrador').length;
    if (borradores > 0) alertas.push({ tipo: 'pedido', titulo: 'Pedidos sin confirmar', detalle: `${borradores} pedidos permanecen en borrador`, ruta: '/pedidos' });
    if (paradasPendientes > 0) alertas.push({ tipo: 'reparto', titulo: 'Entregas por completar', detalle: `${paradasPendientes} paradas pendientes`, ruta: '/ruta' });

    res.json({
      periodo: { anio: periodo.anio, semana: periodo.semana, inicia_at: iso(periodo.lunes), termina_at: iso(periodo.sabado), estado: semana?.estado ?? 'abierta' },
      ventas: {
        fuente: usarFacturas ? 'facturado' : 'proyectado', total: r2(ventaCarne + ventaDesechables), carne: r2(ventaCarne), desechables: r2(ventaDesechables), markup_proteina: r2(markupProteina),
        por_empresa: [...porEmpresa.values()].map((g) => ({ ...g, carne: r2(g.carne), desechables: r2(g.desechables), total: r2(g.total) })),
      },
      inventario: { total: r2(inventarioTotal), materia_prima_fresca: r2(materiaFresca), materia_prima_congelada: r2(materiaCongelada), carne_terminada: r2(carneTerminada), desechables: r2(desechables) },
      cartera: { por_cobrar: r2(porCobrar), vencido_cobrar: r2(vencidoCobrar), facturas_pendientes: facturasPendientes.length, por_pagar: r2(porPagar), vencido_pagar: r2(vencidoPagar), compras_pendientes: comprasPendientes.length, balance_neto: r2(inventarioTotal + porCobrar - porPagar) },
      produccion: { costo: r2(costoProduccion), cajas: r2(cajasProduccion), yield: pesoEntrada > 0 ? r2((pesoSalida / pesoEntrada) * 100) : 0, compras_semana: r2(comprasTotal) },
      operacion: { pedidos_confirmados: pedidos.filter((p) => !['borrador', 'cancelado'].includes(p.estado)).length, pedidos_borrador: borradores, distribuciones_abiertas: distribuciones.length, paradas_pendientes: paradasPendientes, productos_bajo_minimo: bajoMinimo },
      alertas,
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
