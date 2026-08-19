import { Router } from 'express';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { valorExistencia } from '../inventario/valuacion.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth, soloAdmin } from '../auth/middleware.js';
import { distribuirCreditosCliente, inicioVentanaCuentasPorCobrar, semanaDeFecha, totalSaldoCartera } from '../cierre/service.js';
import { preciosVentaSemana } from '../operacion/service.js';
import { validarConciliacionParaCierre } from '../operacion/conciliacion.js';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

export const dashboardRouter = Router();

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MARKUP_PROTEINA = 15;

// Estados de distribución en los que el pedido ya salió a la calle (recepción tiene sentido).
const EN_RUTA_O_DESPUES = new Set(['en_transito', 'parcialmente_entregada', 'entregada', 'cerrada', 'cerrada_con_incidencias']);
const DIST_FINAL = ['entregada', 'cerrada', 'cerrada_con_incidencias', 'cancelada'] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const cantidadFacturable = (l: {
  cantidad: Prisma.Decimal;
  distribucion_lineas: { cantidad_recibida: Prisma.Decimal | null; cantidad_cargada: Prisma.Decimal | null; cantidad_aprobada: Prisma.Decimal | null; cantidad_sugerida: Prisma.Decimal }[];
}) => l.distribucion_lineas.length
  ? l.distribucion_lineas.reduce((total, d) => total + num0(d.cantidad_recibida ?? d.cantidad_cargada ?? d.cantidad_aprobada ?? d.cantidad_sugerida), 0)
  : num0(l.cantidad);
const precioPedido = (l: { precio_unitario: Prisma.Decimal | null; producto: { id: bigint; precio_venta_fijo: Prisma.Decimal | null; ultimo_costo: Prisma.Decimal | null; costo_promedio: Prisma.Decimal | null; tipo_operativo: string | null; markup_caja: Prisma.Decimal } }, preciosSemanales?: Map<string, number | null>) => {
  const guardado = num(l.precio_unitario);
  if (guardado != null) return guardado;
  if (l.producto.tipo_operativo === 'proteina' && preciosSemanales) return preciosSemanales.get(l.producto.id.toString()) ?? 0;
  const fijo = num(l.producto.precio_venta_fijo);
  if (fijo != null) return fijo;
  const costo = num(l.producto.ultimo_costo) ?? num(l.producto.costo_promedio) ?? 0;
  return costo + (l.producto.tipo_operativo === 'proteina' ? MARKUP_PROTEINA : 0);
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
    const negocio = await prisma.negocios.findUnique({ where: { id: negocioId }, select: { zona_horaria: true } });
    const tz = negocio?.zona_horaria ?? 'America/Chicago';
    const hoyISO = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const referencia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).catch(hoyISO).parse(req.query.semana);
    const periodo = semanaDeFecha(new Date(`${referencia}T00:00:00.000Z`));

    const semana = await prisma.semanas_operativas.findUnique({
      where: { negocio_id_anio_semana: { negocio_id: negocioId, anio: periodo.anio, semana: periodo.semana } },
    });
    const [empresas, facturasSemana, pedidos, existenciasVivas, snapshot, lotes, facturasPendientes, comprasPendientes, producciones, produccionesExtraordinarias, comprasSemana, distribuciones, parametros, ajustesSemana] = await Promise.all([
      prisma.empresas_clientes.findMany({ where: { negocio_id: negocioId, activo: true }, orderBy: { codigo: 'asc' } }),
      semana ? prisma.facturas.findMany({
        where: { semana_id: semana.id, estado: { not: 'anulada' } },
        include: { empresa: true, lineas: { include: { producto: true } } },
      }) : Promise.resolve([]),
      prisma.pedidos_operativos.findMany({
        where: { negocio_id: negocioId, fecha_entrega: { gte: periodo.domingo, lte: periodo.sabado }, estado: { not: 'cancelado' } },
        include: {
          empresa: true,
          lineas: {
            include: {
              producto: true,
              distribucion_lineas: { select: { cantidad_recibida: true, cantidad_cargada: true, cantidad_aprobada: true, cantidad_sugerida: true } },
            },
          },
        },
      }),
      prisma.existencias.findMany({
        where: { negocio_id: negocioId, ubicaciones: { tipo: 'bodega', activo: true } },
        include: { products: true, ubicaciones: { select: { id: true, nombre: true } } },
      }),
      semana ? prisma.inventario_semanal.findMany({
        where: { semana_id: semana.id },
        include: { producto: true, ubicacion: { select: { id: true, nombre: true } } },
      }) : Promise.resolve([]),
      prisma.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 }, producto: { tipo_operativo: 'materia_prima' } } }),
      prisma.facturas.findMany({
        where: {
          negocio_id: negocioId,
          estado: { in: ['emitida', 'pagada'] },
          semana: { inicia_at: { gte: inicioVentanaCuentasPorCobrar(periodo.domingo) }, termina_at: { lte: periodo.sabado } },
        },
        include: { pagos: true },
      }),
      prisma.compras.findMany({
        where: { negocio_id: negocioId, fecha: { lte: periodo.sabado }, estado: { not: 'cancelada' } },
        include: { pagos: { select: { monto: true } } },
      }),
      prisma.producciones.findMany({
        where: { negocio_id: negocioId, fecha: { gte: periodo.domingo, lte: periodo.sabado } },
        include: { salidas: true },
      }),
      prisma.producciones_extraordinarias.findMany({
        where: { negocio_id: negocioId, fecha: { gte: periodo.domingo, lte: periodo.sabado } },
        include: { salidas: true },
      }),
      prisma.compras.findMany({ where: { negocio_id: negocioId, fecha: { gte: periodo.domingo, lte: periodo.sabado }, estado: { not: 'cancelada' } } }),
      prisma.distribuciones.findMany({
        where: { negocio_id: negocioId, fecha_entrega: { gte: periodo.domingo, lte: periodo.sabado }, estado: { notIn: [...DIST_FINAL] } },
      }),
      prisma.producto_ubicacion.findMany({
        where: { negocio_id: negocioId, habilitado: true, stock_min: { gt: 0 }, ubicaciones: { tipo: 'bodega', activo: true } },
        select: { ubicacion_id: true, product_id: true, stock_min: true },
      }),
      semana ? prisma.ajustes_facturacion.findMany({
        where: { negocio_id: negocioId, semana_id: semana.id, estado: { in: ['abierto', 'aplicado'] } },
        select: { ubicacion_id: true, empresa_cliente_id: true, linea_operacion: true, tipo: true, monto: true },
      }) : Promise.resolve([]),
    ]);
    const conciliacion = snapshot.length ? null : await validarConciliacionParaCierre(
      negocioId,
      iso(periodo.domingo),
      iso(periodo.sabado),
    ).catch(() => null);
    const saldoConciliado = new Map((conciliacion?.inventario ?? []).map((saldo) => [
      `${saldo.ubicacion_id}:${saldo.product_id}`,
      saldo.cantidad,
    ]));
    const existencias = snapshot.length
      ? snapshot.map((e) => ({ ...e, products: e.producto, ubicaciones: e.ubicacion }))
      : existenciasVivas.map((e) => ({
        ...e,
        cantidad_disponible: saldoConciliado.has(`${e.ubicacion_id}:${e.product_id}`)
          ? new Prisma.Decimal(saldoConciliado.get(`${e.ubicacion_id}:${e.product_id}`)!)
          : e.cantidad_disponible,
      }));
    const productosPedidos = [...new Map(pedidos.flatMap((p) => p.lineas).map((l) => [l.product_id.toString(), l.producto])).values()];
    const preciosSemanales = await preciosVentaSemana(negocioId, productosPedidos, iso(periodo.domingo), iso(periodo.sabado));
    const proteinasSinPrecio = productosPedidos.filter((p) => p.tipo_operativo === 'proteina' && preciosSemanales.get(p.id.toString()) == null);

    const facturasOperativas = facturasSemana.filter((f) => !f.numero.endsWith('-OPEN'));
    const usarFacturas = facturasOperativas.length > 0;
    const porEmpresa = new Map(empresas.map((e) => [e.id.toString(), { codigo: e.codigo, nombre: e.nombre, carne: 0, desechables: 0, total: 0 }]));
    let ventaCarne = 0;
    let ventaDesechables = 0;
    let markupProteina = 0;
    const ventaPorUbicacion = new Map<string, number>();
    if (usarFacturas) {
      for (const f of facturasOperativas) {
        const total = num0(f.total);
        if (f.linea_operacion === 'carne') ventaCarne += total; else ventaDesechables += total;
        ventaPorUbicacion.set(f.ubicacion_id.toString(), r2((ventaPorUbicacion.get(f.ubicacion_id.toString()) ?? 0) + total));
        const g = porEmpresa.get(f.empresa_cliente_id.toString());
        if (g) { g[f.linea_operacion] += total; g.total += total; }
        for (const l of f.lineas) if (l.producto?.tipo_operativo === 'proteina') markupProteina += num0(l.cantidad) * MARKUP_PROTEINA;
      }
    } else {
      for (const p of pedidos.filter((x) => x.estado !== 'borrador')) {
        const g = porEmpresa.get(p.empresa_cliente_id.toString());
        for (const l of p.lineas) {
          const cantidad = cantidadFacturable(l);
          const total = cantidad * precioPedido(l, preciosSemanales);
          const linea = l.producto.linea_operacion ?? p.linea_operacion;
          if (linea === 'carne') ventaCarne += total; else ventaDesechables += total;
          ventaPorUbicacion.set(p.ubicacion_id.toString(), r2((ventaPorUbicacion.get(p.ubicacion_id.toString()) ?? 0) + total));
          if (g) { g[linea] += total; g.total += total; }
          if (l.producto.tipo_operativo === 'proteina') markupProteina += cantidad * MARKUP_PROTEINA;
        }
      }
      // Un crédito aplicado pertenece únicamente a la semana que lo contiene. Usar el
      // último crédito histórico como fallback hacía que Lisle se descontara otra vez en
      // cada semana nueva sin ventas y mostrara una venta proyectada negativa.
      for (const ajuste of ajustesSemana) {
        const monto = num0(ajuste.monto) * (ajuste.tipo === 'credito' ? -1 : 1);
        if (ajuste.linea_operacion === 'carne') ventaCarne += monto; else ventaDesechables += monto;
        ventaPorUbicacion.set(ajuste.ubicacion_id.toString(), r2((ventaPorUbicacion.get(ajuste.ubicacion_id.toString()) ?? 0) + monto));
        const g = porEmpresa.get(ajuste.empresa_cliente_id.toString());
        if (g) { g[ajuste.linea_operacion] += monto; g.total += monto; }
      }
    }

    let carneTerminada = 0;
    let desechables = 0;
    for (const e of existencias) {
      if (e.products.tipo_operativo === 'materia_prima') continue; // los lotes conservan el costo exacto y el estado fresco/congelado
      const valor = valorExistencia(
        e.cantidad_disponible,
        e.cantidad_transito,
        e.costo_promedio,
        e.costo_transito_promedio,
        e.products.costo_promedio,
        e.products.ultimo_costo,
      );
      if (e.products.linea_operacion === 'carne') carneTerminada += valor;
      if (e.products.linea_operacion === 'desechables') desechables += valor;
    }
    const materiaTotalSnapshot = snapshot.filter((e) => e.producto.tipo_operativo === 'materia_prima')
      .reduce((a, e) => a + valorExistencia(
        e.cantidad_disponible,
        e.cantidad_transito,
        e.costo_promedio,
        e.costo_transito_promedio,
        e.producto.costo_promedio,
        e.producto.ultimo_costo,
      ), 0);
    const materiaCongelada = snapshot.length ? num0(semana?.valor_congelado) : lotes.filter((l) => l.congelado).reduce((a, l) => a + num0(l.costo_disponible), 0);
    const materiaFresca = snapshot.length ? Math.max(0, materiaTotalSnapshot - materiaCongelada) : lotes.filter((l) => !l.congelado).reduce((a, l) => a + num0(l.costo_disponible), 0);
    if (snapshot.length && semana) {
      carneTerminada = Math.max(0, num0(semana.valor_carne) - materiaFresca);
      desechables = num0(semana.valor_desechables);
    }
    const inventarioTotal = snapshot.length && semana
      ? num0(semana.valor_carne) + num0(semana.valor_congelado) + num0(semana.valor_desechables)
      : materiaFresca + materiaCongelada + carneTerminada + desechables;

    const documentosCartera = facturasPendientes.map((f) => ({
      id: f.id.toString(), ubicacion_id: f.ubicacion_id.toString(), semana_id: f.semana_id.toString(),
      emitida_at: f.emitida_at, total: num0(f.total), pagado: 0,
    }));
    if (!usarFacturas) {
      for (const [ubicacionId, total] of ventaPorUbicacion) documentosCartera.push({
        id: `proyectado:${ubicacionId}`,
        ubicacion_id: ubicacionId,
        semana_id: semana?.id.toString() ?? `semana:${periodo.anio}:${periodo.semana}`,
        emitida_at: periodo.sabado,
        total,
        pagado: 0,
      });
    }
    const carteraClientes = distribuirCreditosCliente(documentosCartera);
    const saldoFactura = (f: (typeof facturasPendientes)[number]) => carteraClientes.saldos.get(f.id.toString()) ?? 0;
    const facturasAbiertas = facturasPendientes.filter((f) => saldoFactura(f) > 0);
    const porCobrarVivo = totalSaldoCartera(documentosCartera);
    const porCobrar = snapshot.length && semana ? num0(semana.cuentas_por_cobrar) : porCobrarVivo;
    const saldosCompras = comprasPendientes.map((compra) => Math.max(0, r2(
      num0(compra.total) - compra.pagos.reduce((total, pago) => total + num0(pago.monto), 0),
    )));
    const porPagarVivo = saldosCompras.reduce((a, saldo) => a + saldo, 0);
    const porPagar = snapshot.length && semana ? num0(semana.cuentas_por_pagar) : porPagarVivo;
    const comprasAbiertas = saldosCompras.filter((saldo) => saldo > 0);

    const pesoEntrada = producciones.reduce((a, p) => a + num0(p.peso_entrada_lb), 0);
    const pesoSalida = producciones.reduce((a, p) => a + num0(p.peso_salida_lb), 0);
    const cajasProduccion = producciones.reduce((a, p) => a + p.salidas.reduce((x, s) => x + num0(s.cajas), 0), 0)
      + produccionesExtraordinarias.reduce((a, p) => a + p.salidas.reduce((x, s) => x + num0(s.cajas), 0), 0);
    const costoProduccion = producciones.reduce((a, p) => a + num0(p.costo_entrada), 0);
    const comprasTotal = comprasSemana.reduce((a, c) => a + num0(c.total), 0);
    const existenciaDe = new Map(existencias.map((e) => [`${e.ubicacion_id}:${e.product_id}`, num0(e.cantidad_disponible)]));
    const bajoMinimo = parametros.filter((p) => (existenciaDe.get(`${p.ubicacion_id}:${p.product_id}`) ?? 0) < num0(p.stock_min)).length;
    const provisionales = snapshot.length
      ? snapshot.filter((e) => num0(e.cantidad_faltante) > 0).length
      : conciliacion?.saldos.length ?? existencias.filter((e) => num0(e.cantidad_disponible) < -0.0001).length;
    const cajasPerdidas = snapshot.length
      ? r2(snapshot.reduce((total, e) => total + num0(e.cantidad_faltante), 0))
      : r2(conciliacion?.cajas_perdidas ?? existencias.reduce((total, e) => total + Math.max(0, -num0(e.cantidad_disponible)), 0));

    const alertas: { tipo: 'inventario' | 'pedido'; titulo: string; detalle: string; ruta: string }[] = [];
    if (bajoMinimo > 0) alertas.push({ tipo: 'inventario', titulo: 'Inventario bajo mínimo', detalle: `${bajoMinimo} productos necesitan atención`, ruta: '/inventario' });
    if (provisionales > 0) alertas.unshift({
      tipo: 'inventario',
      titulo: 'Cajas perdidas',
      detalle: `${cajasPerdidas.toLocaleString('es-MX')} cajas en ${provisionales} ${provisionales === 1 ? 'producto' : 'productos'}; no bloquean el cierre`,
      ruta: '/semana/inventario',
    });
    if (!usarFacturas && proteinasSinPrecio.length > 0) alertas.unshift({ tipo: 'inventario', titulo: 'Venta pendiente de producción', detalle: `Falta calcular costo + $15 de ${proteinasSinPrecio.map((p) => p.nombre).join(', ')}`, ruta: '/semana/produccion' });
    const borradores = pedidos.filter((p) => p.estado === 'borrador').length;
    if (borradores > 0) alertas.push({ tipo: 'pedido', titulo: 'Pedidos sin confirmar', detalle: `${borradores} pedidos permanecen en borrador`, ruta: '/pedidos' });

    res.json({
      periodo: { anio: periodo.anio, semana: periodo.semana, inicia_at: iso(periodo.domingo), termina_at: iso(periodo.sabado), estado: semana?.estado ?? 'abierta' },
      ventas: {
        fuente: usarFacturas ? 'facturado' : 'proyectado', total: r2(ventaCarne + ventaDesechables), carne: r2(ventaCarne), desechables: r2(ventaDesechables), markup_proteina: r2(markupProteina),
        por_empresa: [...porEmpresa.values()].map((g) => ({ ...g, carne: r2(g.carne), desechables: r2(g.desechables), total: r2(g.total) })),
      },
      inventario: { total: r2(inventarioTotal), materia_prima_fresca: r2(materiaFresca), materia_prima_congelada: r2(materiaCongelada), carne_terminada: r2(carneTerminada), desechables: r2(desechables) },
      cartera: {
        por_cobrar: r2(porCobrar),
        facturas_pendientes: facturasAbiertas.length,
        por_pagar: r2(porPagar),
        compras_pendientes: comprasAbiertas.length,
        balance_neto: r2(snapshot.length && semana ? num0(semana.balance_neto) : inventarioTotal + porCobrar - porPagar),
      },
      produccion: { costo: r2(costoProduccion), cajas: r2(cajasProduccion), yield: pesoEntrada > 0 ? r2((pesoSalida / pesoEntrada) * 100) : 0, compras_semana: r2(comprasTotal) },
      operacion: { pedidos_confirmados: pedidos.filter((p) => !['borrador', 'cancelado'].includes(p.estado)).length, pedidos_borrador: borradores, distribuciones_abiertas: distribuciones.length, productos_bajo_minimo: bajoMinimo },
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
        valor += valorExistencia(
          e.cantidad_disponible,
          e.cantidad_transito,
          e.costo_promedio,
          e.costo_transito_promedio,
          e.products.costo_promedio,
          e.products.ultimo_costo,
        );
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
