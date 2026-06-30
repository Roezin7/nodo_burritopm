import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import {
  calcularStockObjetivo,
  PARAMETROS_DEFAULT,
  type ObservacionConsumo,
  type ParametrosCalculo,
} from './stockObjetivo.logic.js';

const DIA_MS = 86_400_000;
const diaDe = (d: Date) => Math.floor(d.getTime() / DIA_MS);
const diffDias = (a: Date, b: Date) => Math.max(1, diaDe(b) - diaDe(a));

type SerieFecha = { fecha: Date; valor: number };

/**
 * Demanda reconstruida de los conteos cerrados (señal real): por cada par de conteos
 * consecutivos en que el producto aparece, consumo = inv_inicial + recibido − inv_final.
 * Devuelve, por producto, las observaciones en orden cronológico.
 */
async function observacionesDeConteos(ubicacionId: bigint): Promise<Map<string, ObservacionConsumo[]>> {
  const conteos = await prisma.conteos.findMany({
    where: { ubicacion_id: ubicacionId, estado: 'cerrado' },
    orderBy: [{ cerrado_at: 'asc' }, { fecha: 'asc' }, { id: 'asc' }],
    select: { cerrado_at: true, fecha: true, creado_at: true, lineas: { select: { product_id: true, qty: true } } },
  });
  // Recepciones a esta sucursal con su fecha de entrega (carga ≈ llegada el mismo día).
  const recs = await prisma.distribucion_lineas.findMany({
    where: { ubicacion_destino_id: ubicacionId, cantidad_recibida: { not: null } },
    select: { product_id: true, cantidad_recibida: true, distribuciones: { select: { cargado_at: true, creado_at: true } } },
  });

  const fechaConteo = (c: { cerrado_at: Date | null; fecha: Date | null; creado_at: Date }) => c.cerrado_at ?? c.fecha ?? c.creado_at;

  // Serie de stock por producto (solo conteos donde el producto fue contado).
  const stockPorProducto = new Map<string, SerieFecha[]>();
  for (const c of conteos) {
    const f = fechaConteo(c);
    for (const l of c.lineas) {
      const k = l.product_id.toString();
      if (!stockPorProducto.has(k)) stockPorProducto.set(k, []);
      stockPorProducto.get(k)!.push({ fecha: f, valor: num0(l.qty) });
    }
  }
  // Recepciones por producto.
  const recibosPorProducto = new Map<string, SerieFecha[]>();
  for (const r of recs) {
    const k = r.product_id.toString();
    const f = r.distribuciones.cargado_at ?? r.distribuciones.creado_at;
    if (!recibosPorProducto.has(k)) recibosPorProducto.set(k, []);
    recibosPorProducto.get(k)!.push({ fecha: f, valor: num(r.cantidad_recibida) ?? 0 });
  }

  const out = new Map<string, ObservacionConsumo[]>();
  for (const [k, serie] of stockPorProducto) {
    if (serie.length < 2) continue;
    const recibos = recibosPorProducto.get(k) ?? [];
    const obs: ObservacionConsumo[] = [];
    for (let i = 1; i < serie.length; i++) {
      const a = serie[i - 1]!;
      const b = serie[i]!;
      const recibido = recibos
        .filter((r) => r.fecha > a.fecha && r.fecha <= b.fecha)
        .reduce((s, r) => s + r.valor, 0);
      obs.push({ consumo: a.valor + recibido - b.valor, dias: diffDias(a.fecha, b.fecha) });
    }
    out.set(k, obs);
  }
  return out;
}

/**
 * Demanda aproximada de los pedidos históricos (PDFs migrados): cada pedido representa lo
 * consumido desde el pedido anterior (sistema de relleno). Observación = {cantidad, días desde el anterior}.
 */
async function observacionesDeHistorial(ubicacionId: bigint): Promise<Map<string, ObservacionConsumo[]>> {
  const filas = await prisma.historial_pedidos.findMany({
    where: { ubicacion_id: ubicacionId },
    orderBy: [{ product_id: 'asc' }, { fecha: 'asc' }],
    select: { product_id: true, fecha: true, cantidad: true },
  });
  // Agrupa por producto y suma pedidos del mismo día.
  const porProducto = new Map<string, Map<number, number>>();
  for (const f of filas) {
    const k = f.product_id.toString();
    if (!porProducto.has(k)) porProducto.set(k, new Map());
    const dia = diaDe(f.fecha);
    const m = porProducto.get(k)!;
    m.set(dia, (m.get(dia) ?? 0) + num0(f.cantidad));
  }
  const out = new Map<string, ObservacionConsumo[]>();
  for (const [k, m] of porProducto) {
    const dias = [...m.keys()].sort((a, b) => a - b);
    if (dias.length < 2) continue;
    const obs: ObservacionConsumo[] = [];
    for (let i = 1; i < dias.length; i++) {
      obs.push({ consumo: m.get(dias[i]!)!, dias: Math.max(1, dias[i]! - dias[i - 1]!) });
    }
    out.set(k, obs);
  }
  return out;
}

export type FuenteDemanda = 'consumo' | 'historico' | 'sin_datos';

export interface ParamsSugerencia {
  nivelServicio?: number;
  leadTimeDias?: number;
}

/**
 * Sugerencia de stock objetivo/seguridad para cada producto de una sucursal.
 * Prefiere el consumo reconstruido de conteos; si no alcanza, usa los pedidos históricos.
 */
export async function sugerirStockObjetivo(negocioId: bigint, ubicacionId: bigint, opts: ParamsSugerencia = {}) {
  const ubic = await prisma.ubicaciones.findFirst({ where: { id: ubicacionId, negocio_id: negocioId } });
  if (!ubic) throw new Error('Ubicación no encontrada');

  const params: Partial<ParametrosCalculo> = {
    nivelServicio: opts.nivelServicio ?? PARAMETROS_DEFAULT.nivelServicio,
    leadTimeDias: opts.leadTimeDias ?? PARAMETROS_DEFAULT.leadTimeDias,
  };

  const [productos, pus, obsConteo, obsHist] = await Promise.all([
    prisma.products.findMany({
      where: { negocio_id: negocioId, activo: true },
      include: { categorias: true, unidad_distribucion: true },
      orderBy: { nombre: 'asc' },
    }),
    prisma.producto_ubicacion.findMany({ where: { ubicacion_id: ubicacionId } }),
    observacionesDeConteos(ubicacionId),
    observacionesDeHistorial(ubicacionId),
  ]);
  const puPorProducto = new Map(pus.map((p) => [p.product_id.toString(), p]));

  const items = productos.map((p) => {
    const k = p.id.toString();
    const pu = puPorProducto.get(k);
    const cons = obsConteo.get(k) ?? [];
    const hist = obsHist.get(k) ?? [];

    // Fuente: consumo real si hay suficientes ciclos; si no, el histórico de pedidos.
    let fuente: FuenteDemanda;
    let obs: ObservacionConsumo[];
    if (cons.length >= 3) { fuente = 'consumo'; obs = cons; }
    else if (hist.length >= 2) { fuente = 'historico'; obs = hist; }
    else if (cons.length >= 1) { fuente = 'consumo'; obs = cons; }
    else if (hist.length >= 1) { fuente = 'historico'; obs = hist; }
    else { fuente = 'sin_datos'; obs = []; }

    const r = calcularStockObjetivo(obs, params);
    return {
      product_id: Number(p.id),
      nombre: p.nombre,
      sku: p.sku,
      categoria: p.categorias?.nombre ?? null,
      unidad: p.unidad_distribucion.nombre,
      habilitado: pu?.habilitado ?? false,
      multiplo_distribucion: num(pu?.multiplo_distribucion) ?? 1,
      fuente,
      ciclos: r.ciclos,
      anomalias: r.anomalias,
      confianza: r.confianza,
      consumo_diario: r.consumoDiario,
      variabilidad: r.sigmaDiario,
      cobertura_dias: r.coberturaDias,
      actual: {
        stock_objetivo: num(pu?.stock_objetivo) ?? 0,
        stock_seguridad: num(pu?.stock_seguridad) ?? 0,
      },
      sugerido: {
        stock_objetivo: r.stockObjetivo,
        stock_seguridad: r.stockSeguridad,
        nivel_s: r.nivelS,
      },
    };
  });

  const resumen = {
    total: items.length,
    con_consumo: items.filter((i) => i.fuente === 'consumo').length,
    con_historico: items.filter((i) => i.fuente === 'historico').length,
    sin_datos: items.filter((i) => i.fuente === 'sin_datos').length,
    confianza_alta: items.filter((i) => i.confianza === 'alta').length,
  };

  return {
    ubicacion: { id: Number(ubic.id), nombre: ubic.nombre, tipo: ubic.tipo },
    parametros: { nivel_servicio: params.nivelServicio, lead_time_dias: params.leadTimeDias },
    resumen,
    items,
  };
}
