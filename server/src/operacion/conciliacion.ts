import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sumarDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86400000);

export function rangoSemana(fechaIso: string) {
  const d = fecha(fechaIso);
  const delta = (d.getUTCDay() || 7) - 1;
  const inicio = sumarDias(d, -delta);
  return { desde: iso(inicio), hasta: iso(sumarDias(inicio, 5)), corteMiercoles: iso(sumarDias(inicio, 2)) };
}

interface Acumulado {
  compras1: number;
  compras2: number;
  produccionEntrada1: number;
  produccionEntrada2: number;
  produccionSalida1: number;
  produccionSalida2: number;
  salidas1: number;
  salidas2: number;
  pedidos1: number;
  pedidos2: number;
}

const vacio = (): Acumulado => ({
  compras1: 0, compras2: 0, produccionEntrada1: 0, produccionEntrada2: 0,
  produccionSalida1: 0, produccionSalida2: 0, salidas1: 0, salidas2: 0,
  pedidos1: 0, pedidos2: 0,
});

export interface FilaConciliacionCalculable extends Acumulado {
  inicial: number;
  actual: number;
  fisicoFinal: number | null;
}

/** Ecuación operativa: inicio + entradas − salidas, separada en los cortes de miércoles y sábado. */
export function calcularFilaConciliacion(f: FilaConciliacionCalculable) {
  const entradas1 = f.compras1 + f.produccionSalida1;
  const consumos1 = f.produccionEntrada1 + f.salidas1;
  const saldoMiercoles = r3(f.inicial + entradas1 - consumos1);
  const entradas2 = f.compras2 + f.produccionSalida2;
  const consumos2 = f.produccionEntrada2 + f.salidas2;
  const teoricoFinal = r3(saldoMiercoles + entradas2 - consumos2);
  return {
    entradas1: r3(entradas1), consumos1: r3(consumos1), saldoMiercoles,
    entradas2: r3(entradas2), consumos2: r3(consumos2), teoricoFinal,
    diferenciaFinal: f.fisicoFinal == null ? null : r3(f.fisicoFinal - teoricoFinal),
  };
}

async function ubicacionConciliable(negocioId: bigint, ubicacionId?: bigint) {
  const ubicacion = ubicacionId
    ? await prisma.ubicaciones.findFirst({ where: { id: ubicacionId, negocio_id: negocioId, tipo: 'bodega', activo: true } })
    : await prisma.ubicaciones.findFirst({ where: { negocio_id: negocioId, codigo: 'CARN', tipo: 'bodega', activo: true } });
  if (!ubicacion) throw new HttpError(400, 'No existe una Carnicería activa para conciliar');
  return ubicacion;
}

export async function obtenerConciliacionSemanal(negocioId: bigint, desde: string, hasta: string, ubicacionId?: bigint) {
  const ubicacion = await ubicacionConciliable(negocioId, ubicacionId);
  const inicio = fecha(desde);
  const fin = fecha(hasta);
  const corte = sumarDias(inicio, 2);
  const enPrimerCorte = (d: Date) => d <= corte;
  const productos = await prisma.products.findMany({
    where: { negocio_id: negocioId, activo: true, linea_operacion: 'carne' },
    include: { unidad_distribucion: { select: { nombre: true } } },
    orderBy: [{ orden_operativo: 'asc' }, { nombre: 'asc' }],
  });
  const ids = productos.map((p) => p.id);
  const [existencias, compras, producciones, distribuciones, pedidos, inicial, final, cierreAnterior] = await Promise.all([
    prisma.existencias.findMany({ where: { ubicacion_id: ubicacion.id, product_id: { in: ids } } }),
    prisma.compras.findMany({
      where: { negocio_id: negocioId, ubicacion_id: ubicacion.id, fecha: { gte: inicio, lte: fin }, estado: { not: 'cancelada' } },
      include: { lineas: true },
    }),
    prisma.producciones.findMany({
      where: { negocio_id: negocioId, ubicacion_id: ubicacion.id, fecha: { gte: inicio, lte: fin } },
      include: { salidas: true },
    }),
    prisma.distribuciones.findMany({
      where: { negocio_id: negocioId, linea_operacion: 'carne', fecha_entrega: { gte: inicio, lte: fin }, estado: { not: 'cancelada' } },
      include: { lineas: true },
    }),
    prisma.pedidos_operativos.findMany({
      where: { negocio_id: negocioId, linea_operacion: 'carne', fecha_entrega: { gte: inicio, lte: fin }, estado: { notIn: ['borrador', 'cancelado'] } },
      include: { lineas: true },
    }),
    prisma.conteos.findFirst({
      where: { negocio_id: negocioId, ubicacion_id: ubicacion.id, fecha: inicio, notas: { startsWith: 'inventario_inicial_operativo' } },
      include: { lineas: true }, orderBy: { id: 'desc' },
    }),
    prisma.conteos.findFirst({
      where: { negocio_id: negocioId, ubicacion_id: ubicacion.id, fecha: { gte: inicio, lte: fin }, notas: { startsWith: 'inventario_final_operativo' } },
      include: { lineas: true }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    }),
    prisma.conteos.findFirst({
      where: { negocio_id: negocioId, ubicacion_id: ubicacion.id, fecha: { lt: inicio }, notas: { startsWith: 'inventario_final_operativo' } },
      include: { lineas: true }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    }),
  ]);

  const acumulados = new Map(ids.map((id) => [id.toString(), vacio()]));
  const sumar = (productId: bigint, campo: keyof Acumulado, cantidad: number) => {
    const a = acumulados.get(productId.toString());
    if (a) a[campo] = r3(a[campo] + cantidad);
  };
  for (const compra of compras) for (const l of compra.lineas) {
    sumar(l.product_id, enPrimerCorte(compra.fecha) ? 'compras1' : 'compras2', num0(l.cajas));
  }
  for (const p of producciones) {
    sumar(p.materia_prima_id, enPrimerCorte(p.fecha) ? 'produccionEntrada1' : 'produccionEntrada2', num0(p.cajas_materia_prima));
    for (const s of p.salidas) sumar(s.product_id, enPrimerCorte(p.fecha) ? 'produccionSalida1' : 'produccionSalida2', num0(s.cajas));
  }
  for (const d of distribuciones) for (const l of d.lineas) {
    const cantidad = l.cantidad_cargada == null ? 0 : num0(l.cantidad_cargada);
    sumar(l.product_id, enPrimerCorte(d.fecha_entrega ?? d.creado_at) ? 'salidas1' : 'salidas2', cantidad);
  }
  for (const p of pedidos) for (const l of p.lineas) {
    sumar(l.product_id, enPrimerCorte(p.fecha_entrega) ? 'pedidos1' : 'pedidos2', num0(l.cantidad));
  }

  const actualDe = new Map(existencias.map((e) => [e.product_id.toString(), num0(e.cantidad_disponible)]));
  const inicialDe = new Map(inicial?.lineas.map((l) => [l.product_id.toString(), num0(l.qty)]) ?? []);
  const cierreAnteriorDe = new Map(cierreAnterior?.lineas.map((l) => [l.product_id.toString(), num0(l.qty)]) ?? []);
  const fisicoDe = new Map(final?.lineas.map((l) => [l.product_id.toString(), num0(l.qty)]) ?? []);
  const filas = productos.map((p) => {
    const a = acumulados.get(p.id.toString()) ?? vacio();
    const actual = actualDe.get(p.id.toString()) ?? 0;
    // El cierre físico anterior es la apertura más confiable. Solo si no existe se
    // reconstruye hacia atrás desde el saldo vivo y los movimientos de la semana.
    const inicialCalculado = cierreAnterior
      ? (cierreAnteriorDe.get(p.id.toString()) ?? 0)
      : r3(actual - a.compras1 - a.compras2 - a.produccionSalida1 - a.produccionSalida2
        + a.produccionEntrada1 + a.produccionEntrada2 + a.salidas1 + a.salidas2);
    const inicialCantidad = inicialDe.get(p.id.toString()) ?? inicialCalculado;
    const fisicoFinal = fisicoDe.has(p.id.toString()) ? fisicoDe.get(p.id.toString())! : null;
    return {
      product_id: Number(p.id), sku: p.sku, nombre: p.nombre, tipo: p.tipo_operativo,
      unidad: p.unidad_distribucion.nombre, inicial: inicialCantidad, inicial_calculado: inicialCalculado,
      actual, fisico_final: fisicoFinal, ...a,
      ...calcularFilaConciliacion({ inicial: inicialCantidad, actual, fisicoFinal, ...a }),
    };
  }).filter((f) => Math.abs(f.inicial) > 0.0001 || Math.abs(f.actual) > 0.0001
    || f.compras1 + f.compras2 + f.produccionEntrada1 + f.produccionEntrada2 + f.produccionSalida1 + f.produccionSalida2 + f.salidas1 + f.salidas2 + f.pedidos1 + f.pedidos2 > 0);

  return {
    ubicacion: { id: Number(ubicacion.id), nombre: ubicacion.nombre },
    periodo: { desde, hasta, corte_miercoles: iso(corte) },
    inicial_fijado: Boolean(inicial), inventario_inicial_id: inicial ? Number(inicial.id) : null,
    origen_inicial: inicial ? 'fijado' : (cierreAnterior ? 'cierre_anterior' : 'reconstruido'),
    inventario_anterior_id: cierreAnterior ? Number(cierreAnterior.id) : null,
    final_capturado: Boolean(final), inventario_final_id: final ? Number(final.id) : null,
    filas,
    resumen: {
      saldos_provisionales: filas.filter((f) => f.actual < -0.0001).length,
      cajas_perdidas: r3(filas.filter((f) => f.actual < -0.0001).reduce((total, f) => total + Math.abs(f.actual), 0)),
      diferencias_fisicas: filas.filter((f) => f.diferenciaFinal != null && Math.abs(f.diferenciaFinal) > 0.0001).length,
      producciones: producciones.length,
      pedidos: pedidos.length,
    },
  };
}

/** Congela el saldo de apertura reconstruido antes de la primera captura retroactiva. No mueve inventario. */
export async function asegurarInventarioInicialSemanal(negocioId: bigint, usuarioId: bigint, fechaOperacion: string, ubicacionId: bigint) {
  const rango = rangoSemana(fechaOperacion);
  const existente = await prisma.conteos.findFirst({
    where: { negocio_id: negocioId, ubicacion_id: ubicacionId, fecha: fecha(rango.desde), notas: { startsWith: 'inventario_inicial_operativo' } },
    select: { id: true },
  });
  if (existente) return { id: Number(existente.id), creado: false };
  const reporte = await obtenerConciliacionSemanal(negocioId, rango.desde, rango.hasta, ubicacionId);
  const productos = await prisma.products.findMany({
    where: { negocio_id: negocioId, id: { in: reporte.filas.map((f) => BigInt(f.product_id)) } },
    select: { id: true, unidad_distribucion_id: true },
  });
  const conteo = await prisma.$transaction(async (tx) => {
    const ya = await tx.conteos.findFirst({
      where: { negocio_id: negocioId, ubicacion_id: ubicacionId, fecha: fecha(rango.desde), notas: { startsWith: 'inventario_inicial_operativo' } },
      select: { id: true },
    });
    if (ya) return ya;
    const c = await tx.conteos.create({
      data: { negocio_id: negocioId, ubicacion_id: ubicacionId, fecha: fecha(rango.desde), estado: 'cerrado', creado_por: usuarioId, cerrado_por: usuarioId, cerrado_at: new Date(), notas: `inventario_inicial_operativo:${rango.desde}` },
    });
    const unidadDe = new Map(productos.map((p) => [p.id.toString(), p.unidad_distribucion_id]));
    if (reporte.filas.length) await tx.conteo_lineas.createMany({
      data: reporte.filas.map((f) => ({ conteo_id: c.id, product_id: BigInt(f.product_id), unidad_id: unidadDe.get(String(f.product_id))!, qty: f.inicial_calculado, factor: 1, contado: true })),
    });
    return c;
  }, { isolationLevel: 'Serializable' });
  return { id: Number(conteo.id), creado: true };
}

export async function fijarInventarioInicialSemanal(negocioId: bigint, usuarioId: bigint, desde: string, ubicacionId?: bigint) {
  const ubicacion = await ubicacionConciliable(negocioId, ubicacionId);
  return asegurarInventarioInicialSemanal(negocioId, usuarioId, desde, ubicacion.id);
}

export async function validarConciliacionParaCierre(negocioId: bigint, desde: string, hasta: string) {
  const [pedidosCarne, producciones, negativos] = await Promise.all([
    prisma.pedidos_operativos.count({
      where: { negocio_id: negocioId, linea_operacion: 'carne', fecha_entrega: { gte: fecha(desde), lte: fecha(hasta) }, estado: { notIn: ['borrador', 'cancelado'] } },
    }),
    prisma.producciones.count({ where: { negocio_id: negocioId, fecha: { gte: fecha(desde), lte: fecha(hasta) } } }),
    prisma.existencias.findMany({
      where: { negocio_id: negocioId, ubicaciones: { tipo: 'bodega' }, cantidad_disponible: { lt: 0 } },
      include: { products: { select: { nombre: true } }, ubicaciones: { select: { nombre: true } } },
    }),
  ]);
  const alertaNegativos = {
    cajas_perdidas: r3(negativos.reduce((total, e) => total + Math.abs(num0(e.cantidad_disponible)), 0)),
    saldos: negativos.map((e) => ({
      product_id: Number(e.product_id), ubicacion_id: Number(e.ubicacion_id),
      producto: e.products.nombre, ubicacion: e.ubicaciones.nombre,
      cantidad: r3(Math.abs(num0(e.cantidad_disponible))),
    })),
  };
  if (!pedidosCarne && !producciones) return alertaNegativos;
  const reporte = await obtenerConciliacionSemanal(negocioId, desde, hasta);
  if (!reporte.inicial_fijado) throw new HttpError(409, 'Falta fijar el inventario inicial de Carnicería en la conciliación semanal.');
  // El físico final es una auditoría opcional. El cierre usa el saldo vivo que ya integra
  // compras + producción − despachos; los negativos se reportan como cajas perdidas y se
  // valúan en cero. Si hubo conteo físico, sus ajustes ya forman parte de ese mismo saldo.
  return alertaNegativos;
}

/** Repara pedidos que dicen estar preparados pero ya no tienen ninguna línea vinculada. */
export async function repararPedidosHuerfanos(negocioId: bigint) {
  const huerfanos = await prisma.pedidos_operativos.findMany({
    where: { negocio_id: negocioId, estado: 'en_preparacion', lineas: { none: { distribucion_lineas: { some: {} } } } },
    select: { id: true },
  });
  if (huerfanos.length) await prisma.pedidos_operativos.updateMany({ where: { id: { in: huerfanos.map((p) => p.id) } }, data: { estado: 'confirmado' } });
  return huerfanos.length;
}
