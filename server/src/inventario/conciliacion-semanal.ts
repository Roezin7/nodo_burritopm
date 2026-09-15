import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { fechaISOEnZona } from '../lib/semana-operativa.js';
import { HttpError } from '../middleware/error.js';

type Db = Prisma.TransactionClient | typeof prisma;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fecha = (s: string) => new Date(`${s}T00:00:00.000Z`);
const sumarDias = (s: string, n: number) => iso(new Date(fecha(s).getTime() + n * 86400000));
const domingo = (s: string) => sumarDias(s, -fecha(s).getUTCDay());

export type TipoEventoInventario = 'apertura' | 'heredado' | 'fisico' | 'snapshot'
  | 'compra' | 'produccion' | 'consumo_produccion' | 'despacho' | 'ingreso' | 'retiro';
export interface EventoInventario {
  producto: string;
  fecha: string;
  tipo: TipoEventoInventario;
  cantidad: number;
  documento: string;
}
const orden = (e: EventoInventario) => e.tipo === 'apertura' || e.tipo === 'heredado' ? 0
  : e.tipo === 'fisico' ? 2 : e.tipo === 'snapshot' ? 3 : 1;
const esSaldo = (e: EventoInventario) => ['apertura', 'heredado', 'fisico', 'snapshot'].includes(e.tipo);

/** Las aperturas generadas automáticamente son referencias, no nuevos conteos físicos. */
export function esAperturaHeredada(notas: string | null) {
  return /^inventario_inicial_operativo:\d{4}-\d{2}-\d{2}(?::heredado-desechables)?$/.test(notas ?? '');
}

/** Reproduce cantidades por fecha operativa, conservando cada diferencia física explícita. */
export function conciliarLineaTemporal(eventos: EventoInventario[], desde: string, hasta: string, actual: number) {
  const ordenados = [...eventos].sort((a, b) => a.fecha.localeCompare(b.fecha) || orden(a) - orden(b)
    || a.documento.localeCompare(b.documento, 'en', { numeric: true }));
  const tieneAncla = ordenados.some(esSaldo);
  // Compatibilidad con existencias iniciales importadas sin documento. Se revierte
  // TODA operación registrada, incluidas las posteriores; se informa la falta de ancla.
  let saldo = tieneAncla ? 0 : r3(actual - ordenados.reduce((n, e) => n + e.cantidad, 0));
  let anclado = false;
  let fuente: EventoInventario | null = null;
  let semanaAnterior: string | null = null;
  let inicial = 0;
  let heredado = 0;
  let aperturaRegistrada: number | null = null;
  let fuenteInicial: EventoInventario | null = null;
  let capturadoInicio = false;
  let finCapturado = false;
  let operativo = 0;
  let fisico: number | null = null;
  let fechaFisico: string | null = null;
  let ajusteFisico = 0;
  let ajusteSnapshot = 0;
  const corte = sumarDias(desde, 3);
  const acumulados = {
    compras1: 0, compras2: 0, produccionEntrada1: 0, produccionEntrada2: 0,
    produccionSalida1: 0, produccionSalida2: 0, salidas1: 0, salidas2: 0,
    directos1: 0, directos2: 0,
  };
  const trazabilidad: (EventoInventario & { saldo: number; ajuste: number | null; aplicada: boolean })[] = [];
  const tomarInicio = () => {
    if (capturadoInicio) return;
    saldo = Math.max(0, saldo);
    inicial = heredado = saldo;
    fuenteInicial = fuente;
    capturadoInicio = true;
  };
  for (const e of ordenados) {
    if (e.fecha >= desde) tomarInicio();
    if (e.fecha > hasta && !finCapturado) { operativo = saldo; finCapturado = true; }
    const aplicada = e.tipo !== 'heredado' || !anclado;
    const semanaEvento = domingo(e.fecha);
    if (aplicada && semanaAnterior && semanaEvento !== semanaAnterior) saldo = Math.max(0, saldo);
    if (aplicada) semanaAnterior = semanaEvento;
    const enSemana = e.fecha >= desde && e.fecha <= hasta;
    // Solo se usa una apertura automática como ancla de arranque si no existe
    // evidencia anterior. Una herencia guardada nunca congela un saldo obsoleto.
    const ajuste = esSaldo(e) && aplicada ? r3(e.cantidad - saldo) : null;
    if (esSaldo(e) && aplicada) {
      saldo = e.cantidad;
      anclado = true;
      fuente = e;
      if (enSemana && e.fecha === desde && (e.tipo === 'apertura' || e.tipo === 'heredado')) {
        inicial = e.cantidad;
        fuenteInicial = e;
      }
      if (enSemana && e.tipo === 'fisico') {
        fisico = e.cantidad;
        fechaFisico = e.fecha;
        ajusteFisico = r3(ajusteFisico + ajuste!);
      }
      if (enSemana && e.tipo === 'snapshot') ajusteSnapshot = r3(ajusteSnapshot + ajuste!);
    } else if (!esSaldo(e)) {
      saldo = r3(saldo + e.cantidad);
      if (enSemana) {
        const parte = e.fecha <= corte ? '1' : '2';
        const campo = e.tipo === 'compra' ? `compras${parte}`
          : e.tipo === 'produccion' ? `produccionSalida${parte}`
          : e.tipo === 'consumo_produccion' ? `produccionEntrada${parte}`
          : e.tipo === 'despacho' ? `salidas${parte}` : `directos${parte}`;
        const k = campo as keyof typeof acumulados;
        acumulados[k] = r3(acumulados[k] + (e.tipo === 'consumo_produccion' || e.tipo === 'despacho' ? -e.cantidad : e.cantidad));
      }
    }
    if (enSemana) {
      if (e.tipo === 'apertura' || e.tipo === 'heredado') aperturaRegistrada = e.cantidad;
      trazabilidad.push({ ...e, saldo, ajuste, aplicada });
    }
  }
  tomarInicio();
  if (!finCapturado) operativo = saldo;
  const entradas1 = r3(acumulados.compras1 + acumulados.produccionSalida1);
  const entradas2 = r3(acumulados.compras2 + acumulados.produccionSalida2);
  const consumos1 = r3(acumulados.produccionEntrada1 + acumulados.salidas1);
  const consumos2 = r3(acumulados.produccionEntrada2 + acumulados.salidas2);
  const saldoMiercoles = r3(inicial + entradas1 - consumos1 + acumulados.directos1);
  const teoricoFinal = r3(saldoMiercoles + entradas2 - consumos2 + acumulados.directos2);
  return {
    ...acumulados, entradas1, entradas2, consumos1, consumos2, inicial, inicial_calculado: heredado,
    apertura_registrada: aperturaRegistrada, ajuste_apertura: r3(inicial - heredado), fuente_inicial: fuenteInicial,
    saldoMiercoles, teoricoFinal, fisico_final: fisico, fecha_fisico: fechaFisico,
    diferenciaFinal: fisico == null ? null : ajusteFisico, ajustes_fisicos: ajusteFisico,
    ajuste_snapshot: ajusteSnapshot, saldoOperativoFinal: r3(operativo), actual,
    saldo_actual_esperado: r3(saldo), movimientos_posteriores: r3(saldo - operativo),
    diferencia_ledger: r3(actual - saldo), sin_ancla: !fuenteInicial,
    trazabilidad,
  };
}

/** Fuente común para apertura, Inventario, conciliación y fotografía de cierre. Solo lectura. */
export async function obtenerConciliacionAlmacen(negocioId: bigint, desde: string, hasta: string, ubicacionId: bigint, db: Db = prisma) {
  const ubicacion = await db.ubicaciones.findFirst({ where: { id: ubicacionId, negocio_id: negocioId, tipo: 'bodega', activo: true } });
  if (!ubicacion || !['CARN', 'BOD'].includes(ubicacion.codigo)) throw new HttpError(400, 'Almacén operativo no válido');
  const linea = ubicacion.codigo === 'CARN' ? 'carne' : 'desechables';
  const [productos, conteos, snapshots, negocio] = await Promise.all([
    db.products.findMany({ where: { negocio_id: negocioId, linea_operacion: linea, es_cargo_compra: false }, include: { unidad_distribucion: { select: { nombre: true } } }, orderBy: [{ orden_operativo: 'asc' }, { nombre: 'asc' }] }),
    db.conteos.findMany({ where: { negocio_id: negocioId, ubicacion_id: ubicacionId, estado: 'cerrado', fecha: { not: null }, tipo_captura: { not: 'historico' } }, include: { lineas: { where: { contado: true } } }, orderBy: [{ fecha: 'asc' }, { id: 'asc' }] }),
    db.inventario_semanal.findMany({ where: { negocio_id: negocioId, ubicacion_id: ubicacionId, semana: { estado: 'cerrada' } }, include: { semana: { select: { termina_at: true } } } }),
    db.negocios.findUnique({ where: { id: negocioId }, select: { zona_horaria: true } }),
  ]);
  const ids = productos.map(p => p.id);
  const eventos: EventoInventario[] = [];
  for (const c of conteos) {
    const apertura = c.tipo_captura === 'apertura' || c.notas?.startsWith('inventario_inicial_operativo');
    for (const l of c.lineas) eventos.push({ producto: String(l.product_id), fecha: iso(c.fecha!), tipo: apertura ? esAperturaHeredada(c.notas) ? 'heredado' : 'apertura' : 'fisico', cantidad: num0(l.qty), documento: `conteo:${c.id}` });
  }
  for (const s of snapshots) eventos.push({ producto: String(s.product_id), fecha: iso(s.semana.termina_at), tipo: 'snapshot', cantidad: num0(s.cantidad_disponible), documento: `cierre:${s.semana_id}` });
  // Acota la lectura al último ancla por producto anterior a la semana consultada.
  const anclas = new Map<string, EventoInventario>();
  for (const e of [...eventos].sort((a, b) => a.fecha.localeCompare(b.fecha) || orden(a) - orden(b))) {
    if (e.fecha < desde && (e.tipo !== 'heredado' || !anclas.has(e.producto))) anclas.set(e.producto, e);
  }
  const inicioHistoria = [...anclas.values()].reduce((min, e) => e.fecha < min ? e.fecha : min, desde);
  const inicio = fecha(inicioHistoria);
  const [existencias, compras, producciones, extraordinarias, distribuciones, directos, pedidos, lotes] = await Promise.all([
    db.existencias.findMany({ where: { negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: { in: ids } } }),
    db.compras.findMany({ where: { negocio_id: negocioId, ubicacion_id: ubicacionId, fecha: { gte: inicio }, estado: { not: 'cancelada' }, origen: { not: 'conteo_fisico' } }, include: { lineas: true } }),
    db.producciones.findMany({ where: { negocio_id: negocioId, ubicacion_id: ubicacionId, fecha: { gte: inicio } }, include: { salidas: true } }),
    db.producciones_extraordinarias.findMany({ where: { negocio_id: negocioId, ubicacion_id: ubicacionId, fecha: { gte: inicio } }, include: { salidas: true } }),
    db.distribuciones.findMany({ where: { negocio_id: negocioId, fecha_entrega: { gte: inicio }, estado: { in: ['cargada', 'en_transito', 'parcialmente_entregada', 'entregada', 'cerrada', 'cerrada_con_incidencias'] } }, include: { lineas: { where: { product_id: { in: ids } }, select: { id: true, product_id: true, cantidad_cargada: true } } } }),
    db.movimientos_inventario.findMany({ where: { negocio_id: negocioId, product_id: { in: ids }, fecha: { gte: new Date(inicio.getTime() - 86400000) }, documento_tipo: { in: ['ingreso', 'retiro', 'liberar_hold'] }, OR: [{ ubicacion_origen_id: ubicacionId }, { ubicacion_destino_id: ubicacionId }] }, select: { id: true, fecha: true, product_id: true, cantidad: true, documento_tipo: true, ubicacion_origen_id: true, ubicacion_destino_id: true } }),
    db.pedidos_operativos.findMany({ where: { negocio_id: negocioId, fecha_entrega: { gte: fecha(desde), lte: fecha(hasta) }, estado: { notIn: ['borrador', 'cancelado'] } }, include: { lineas: { where: { product_id: { in: ids } } } } }),
    db.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: { in: ids }, cajas_disponibles: { gt: 0 } }, select: { product_id: true, cajas_disponibles: true } }),
  ]);
  const agregar = (producto: bigint, d: Date, tipo: TipoEventoInventario, cantidad: number, documento: string) => eventos.push({ producto: String(producto), fecha: iso(d), tipo, cantidad: r3(cantidad), documento });
  for (const c of compras) for (const l of c.lineas) agregar(l.product_id, c.fecha, 'compra', num0(l.cajas), `compra:${c.id}`);
  for (const p of producciones) {
    agregar(p.materia_prima_id, p.fecha, 'consumo_produccion', -num0(p.cajas_materia_prima), `produccion:${p.id}`);
    for (const s of p.salidas) agregar(s.product_id, p.fecha, 'produccion', num0(s.cajas), `produccion:${p.id}`);
  }
  for (const p of extraordinarias) for (const s of p.salidas) agregar(s.product_id, p.fecha, 'produccion', num0(s.cajas), `extraordinaria:${p.id}`);
  // La cantidad cargada es la salida vigente: las correcciones del pedido ya
  // actualizan esta línea. No se resta otra vez su movimiento original ni el pedido.
  for (const d of distribuciones) for (const l of d.lineas) if (l.cantidad_cargada != null) agregar(l.product_id, d.fecha_entrega!, 'despacho', -num0(l.cantidad_cargada), `salida:${l.id}`);
  for (const m of directos) {
    const entrada = m.documento_tipo === 'liberar_hold' || m.ubicacion_destino_id === ubicacionId;
    eventos.push({ producto: String(m.product_id), fecha: fechaISOEnZona(m.fecha, negocio?.zona_horaria ?? 'America/Chicago'), tipo: entrada ? 'ingreso' : 'retiro', cantidad: num0(m.cantidad) * (entrada ? 1 : -1), documento: `movimiento:${m.id}` });
  }
  const porProducto = new Map<string, EventoInventario[]>();
  for (const e of eventos) {
    const ancla = anclas.get(e.producto);
    if (ancla && (e.fecha < ancla.fecha || (e.fecha === ancla.fecha && orden(e) < orden(ancla)))) continue;
    if (e.fecha < inicioHistoria) continue;
    const lista = porProducto.get(e.producto) ?? [];
    lista.push(e); porProducto.set(e.producto, lista);
  }
  const actualDe = new Map(existencias.map(e => [String(e.product_id), num0(e.cantidad_disponible)]));
  const fifoDe = new Map<string, number>();
  for (const l of lotes) fifoDe.set(String(l.product_id), r3((fifoDe.get(String(l.product_id)) ?? 0) + num0(l.cajas_disponibles)));
  const pedidosDe = new Map<string, { pedidos1: number; pedidos2: number }>();
  for (const p of pedidos) for (const l of p.lineas) {
    const a = pedidosDe.get(String(l.product_id)) ?? { pedidos1: 0, pedidos2: 0 };
    const k = iso(p.fecha_entrega) <= sumarDias(desde, 3) ? 'pedidos1' : 'pedidos2';
    a[k] = r3(a[k] + num0(l.cantidad)); pedidosDe.set(String(l.product_id), a);
  }
  const filas = productos.map(p => {
    const actual = actualDe.get(String(p.id)) ?? 0;
    const r = conciliarLineaTemporal(porProducto.get(String(p.id)) ?? [], desde, hasta, actual);
    const fifo = p.tipo_operativo === 'materia_prima' || linea === 'desechables' ? fifoDe.get(String(p.id)) ?? 0 : null;
    return { product_id: Number(p.id), sku: p.sku, nombre: p.nombre, tipo: p.tipo_operativo, unidad: p.unidad_distribucion.nombre,
      ...r, ...(pedidosDe.get(String(p.id)) ?? { pedidos1: 0, pedidos2: 0 }),
      fifo_disponible: fifo, diferencia_fifo: fifo == null ? null : r3(fifo - Math.max(0, actual)),
    };
  });
  const inicial = conteos.find(c => iso(c.fecha!) === desde && (c.tipo_captura === 'apertura' || c.notas?.startsWith('inventario_inicial_operativo')));
  const finales = conteos.filter(c => iso(c.fecha!) >= desde && iso(c.fecha!) <= hasta && c.tipo_captura !== 'apertura' && !c.notas?.startsWith('inventario_inicial_operativo'));
  const final = finales.at(-1);
  const anteriores = conteos.filter(c => iso(c.fecha!) < desde && c.tipo_captura !== 'apertura' && !c.notas?.startsWith('inventario_inicial_operativo'));
  return {
    ubicacion: { id: Number(ubicacion.id), nombre: ubicacion.nombre }, periodo: { desde, hasta, corte_miercoles: sumarDias(desde, 3) },
    inicial_fijado: Boolean(inicial?.lineas.length), inventario_inicial_id: inicial ? Number(inicial.id) : null,
    origen_inicial: inicial && !esAperturaHeredada(inicial.notas) ? 'fijado' : filas.some(f => !f.sin_ancla) ? 'cierre_anterior' : 'reconstruido',
    inventario_anterior_id: anteriores.length ? Number(anteriores.at(-1)!.id) : null,
    final_capturado: Boolean(final?.lineas.length), inventario_final_id: final ? Number(final.id) : null,
    filas,
    resumen: {
      saldos_provisionales: filas.filter(f => f.saldoOperativoFinal < -0.0001).length,
      cajas_perdidas: r3(filas.reduce((n, f) => n + Math.max(0, -f.saldoOperativoFinal), 0)),
      diferencias_fisicas: filas.filter(f => Math.abs(f.ajustes_fisicos) > 0.0001).length,
      diferencias_ledger: filas.filter(f => Math.abs(f.diferencia_ledger) > 0.001).length,
      diferencias_fifo: filas.filter(f => f.diferencia_fifo != null && Math.abs(f.diferencia_fifo) > 0.001).length,
      aperturas_desactualizadas: filas.filter(f => f.apertura_registrada != null && Math.abs(f.apertura_registrada - f.inicial) > 0.001).length,
      producciones: [...producciones, ...extraordinarias].filter(p => iso(p.fecha) >= desde && iso(p.fecha) <= hasta).length,
      pedidos: pedidos.filter(p => p.lineas.length).length,
    },
  };
}
