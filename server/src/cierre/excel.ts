import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { prisma } from '../db.js';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';

export type TipoExcel = 'weekly-order' | 'disposables' | 'production' | 'billing' | 'lbt' | 'aurora';

const TEMPLATE_DIR = fileURLToPath(new URL('../../prisma/data/3q/', import.meta.url));
const ARCHIVOS: Record<TipoExcel, string> = {
  'weekly-order': '1. Weekly Order 2026 3Q.xlsx',
  disposables: '2. Disposables 2026 3Q.xlsx',
  production: '3. Production 2026 3Q.xlsx',
  billing: '4. Billing 2026 3Q.xlsx',
  lbt: '5. LBT 2026 3Q.xlsx',
  aurora: '6. Taqueria Aurora 2026 3Q.xlsx',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const MARKUP_PROTEINA = 15;
const normal = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const excelDate = (d: Date) => new Date(`${iso(d)}T12:00:00.000Z`);
const sumarDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86400000);

async function datos(negocioId: bigint, semanaId: bigint) {
  const semana = await prisma.semanas_operativas.findFirst({
    where: { id: semanaId, negocio_id: negocioId },
    include: {
      facturas: {
        where: { estado: { not: 'anulada' } },
        include: { empresa: true, ubicacion: true, lineas: { include: { producto: true } } },
      },
    },
  });
  if (!semana) throw new HttpError(404, 'Semana no encontrada');
  const [pedidos, compras, comprasPendientes, producciones, snapshot, existenciasVivas, lotesVivos, productos, ubicaciones, facturasHistoricas] = await Promise.all([
    prisma.pedidos_operativos.findMany({
      where: { negocio_id: negocioId, fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at }, estado: { notIn: ['borrador', 'cancelado'] } },
      include: { ubicacion: true, empresa: true, lineas: { include: { producto: true, distribucion_lineas: { select: { cantidad_recibida: true, cantidad_cargada: true, cantidad_aprobada: true, cantidad_sugerida: true } } }, orderBy: { producto: { orden_operativo: 'asc' } } } },
      orderBy: [{ fecha_entrega: 'asc' }, { ubicacion: { orden_operativo: 'asc' } }],
    }),
    prisma.compras.findMany({
      where: { negocio_id: negocioId, fecha: { gte: semana.inicia_at, lte: semana.termina_at }, estado: { not: 'cancelada' } },
      include: { proveedor: true, lineas: { include: { producto: true } } }, orderBy: { fecha: 'asc' },
    }),
    prisma.compras.findMany({
      where: {
        negocio_id: negocioId, fecha: { lte: semana.termina_at }, estado: { not: 'cancelada' },
        OR: [{ estado: 'pendiente' }, { estado: 'pagada', pagado_at: { gt: semana.termina_at } }],
      },
      include: { proveedor: true }, orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    }),
    prisma.producciones.findMany({
      where: { negocio_id: negocioId, fecha: { gte: semana.inicia_at, lte: semana.termina_at } },
      include: { materia_prima: true, salidas: { include: { producto: true } } }, orderBy: { fecha: 'asc' },
    }),
    prisma.inventario_semanal.findMany({ where: { semana_id: semana.id }, include: { producto: true, ubicacion: true } }),
    prisma.existencias.findMany({ where: { negocio_id: negocioId }, include: { products: true, ubicaciones: true } }),
    prisma.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 } } }),
    // Los libros históricos también deben conservar productos que se hayan desactivado después.
    prisma.products.findMany({ where: { negocio_id: negocioId, linea_operacion: { not: null } }, orderBy: [{ linea_operacion: 'asc' }, { orden_operativo: 'asc' }] }),
    prisma.ubicaciones.findMany({ where: { negocio_id: negocioId }, include: { empresa_cliente: true }, orderBy: { orden_operativo: 'asc' } }),
    prisma.facturas.findMany({
      where: { negocio_id: negocioId, emitida_at: { lte: semana.termina_at }, estado: { not: 'anulada' } },
      include: { semana: true, pagos: true }, orderBy: [{ emitida_at: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const existencias = snapshot.length
    ? snapshot.map((e) => ({ ...e, products: e.producto, ubicaciones: e.ubicacion }))
    : existenciasVivas.map((e) => ({ ...e, peso_total_lb: null, costo_total: null }));
  return { semana, pedidos, compras, comprasPendientes, producciones, existencias, usaSnapshot: snapshot.length > 0, lotesVivos, productos, ubicaciones, facturasHistoricas };
}

type Datos = Awaited<ReturnType<typeof datos>>;

async function plantilla(tipo: TipoExcel) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(TEMPLATE_DIR, ARCHIVOS[tipo]));
  wb.creator = 'M&G Management and Logistics Inc.';
  wb.modified = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  return wb;
}

function numeroHoja(nombre: string) {
  const m = nombre.match(/(?:\(|\s)(\d+)\)?$/);
  return m ? Number(m[1]) : null;
}

function clonarHoja(wb: ExcelJS.Workbook, source: ExcelJS.Worksheet, nombre: string) {
  const model = structuredClone(source.model);
  const target = wb.addWorksheet(nombre);
  const id = target.id;
  target.model = { ...model, id, name: nombre, merges: [] };
  for (const rango of model.merges ?? []) target.mergeCells(rango);
  return target;
}

function hojaSemana(wb: ExcelJS.Workbook, prefijo: RegExp, semana: number, nombre: string) {
  const existentes = wb.worksheets.filter((s) => prefijo.test(s.name));
  const exacta = existentes.find((s) => numeroHoja(s.name) === semana);
  if (exacta) return exacta;
  const source = [...existentes].sort((a, b) => (numeroHoja(b.name) ?? 0) - (numeroHoja(a.name) ?? 0))[0];
  if (!source) throw new Error(`La plantilla no contiene una hoja para ${nombre}`);
  return clonarHoja(wb, source, nombre);
}

function formula(ws: ExcelJS.Worksheet, address: string, expression: string, result: number) {
  ws.getCell(address).value = { formula: expression, result: r2(result) };
}

function filaPorNombre(ws: ExcelJS.Worksheet, columna: number, desde: number, hasta: number) {
  const mapa = new Map<string, number>();
  for (let r = desde; r <= hasta; r += 1) {
    const key = normal(ws.getCell(r, columna).text);
    if (key) mapa.set(key, r);
  }
  return mapa;
}

const CODIGO_ENCABEZADO: Record<string, string> = {
  LOMBARD: 'LOMBA', NAPERVILLE: 'NAPER', 'NAPERVILLE I': 'NAPER', 'NAPERVILLE ONE': 'NAPER',
  'CAROL STREAM': 'CAROL', LISLE: 'LISLE', 'GLENDALE HEIGHTS': 'GLEND', 'GLENDALE H': 'GLEND',
  'GLENDALE H ': 'GLEND', 'WEST CHICAGO': 'WESTC', BATAVIA: 'BATAV', ALGONQUIN: 'ALGON',
  'NAPERVILLE TWO': 'NAPER2', 'NAPERVILLE II': 'NAPER2', OGDEN: 'NAPER2',
  'ROLLING MEADOWS': 'ROLLI', 'ROLLING M': 'ROLLI', 'RO ME': 'ROLLI', SCHAUMBURG: 'SCHAU',
  'CRYSTAL LAKE': 'CRYST', 'CRYSTAL L': 'CRYST', 'LAKE ZURICH': 'LAKEZ', 'LAKE ZUR': 'LAKEZ',
  FRANKFORT: 'FRANK', PLAINFIELD: 'PLAIN', 'TAQUERIA AURORA': 'AUROR', 'TAQ AURORA': 'AUROR',
  'TAQUERIA BURLINGTON': 'BURLI', 'TAQ AURORA 2': 'BURLI', 'TAPATIOS GLEN ELLYN': 'TGE',
  'TAPATIOS STREAMWOOD': 'TST', 'TAPATIOS LOMBARD': 'TLO', 'TAPATIOS NAPERVILLE': 'TNA',
};

const FILA_CARNE: Record<string, number> = {
  'MEAT-STEAK': 11, 'MEAT-CHICKEN': 12, 'MEAT-PASTOR-BPM': 13, 'MEAT-PASTOR-TAP': 13,
  'MEAT-ASADA': 14, 'MEAT-FAJITAS': 15, 'MEAT-MILANESA': 16, 'MEAT-TAMAL': 17,
  'MEAT-CHILE': 18, 'MEAT-DORADO': 19, 'MEAT-ADOBO': 20, 'MEAT-CARNITAS': 21,
  'MEAT-CATERING': 22, 'BPM-0019': 23, 'BPM-0047': 24, 'BPM-0048': 25,
  'BPM-0049': 26, 'BPM-0020': 27, 'BPM-0029': 28, 'MEAT-TAPATIOS-TACO': 29,
};

function valorPedido(d: Datos, linea: 'carne' | 'desechables' | null, codigo: string, productId: bigint, dia?: number) {
  return d.pedidos
    .filter((p) => (linea == null || p.linea_operacion === linea) && p.ubicacion.codigo === codigo && (dia == null || p.fecha_entrega.getUTCDay() === dia))
    .flatMap((p) => p.lineas)
    .filter((l) => l.product_id === productId)
    .reduce((a, l) => a + (l.distribucion_lineas.length
      ? l.distribucion_lineas.reduce((total, dl) => total + num0(dl.cantidad_recibida ?? dl.cantidad_cargada ?? dl.cantidad_aprobada ?? dl.cantidad_sugerida), 0)
      : num0(l.cantidad)), 0);
}

function cantidadLinea(linea: Datos['pedidos'][number]['lineas'][number]) {
  return linea.distribucion_lineas.length
    ? linea.distribucion_lineas.reduce((total, dl) => total + num0(dl.cantidad_recibida ?? dl.cantidad_cargada ?? dl.cantidad_aprobada ?? dl.cantidad_sugerida), 0)
    : num0(linea.cantidad);
}

function valorProducto(d: Datos, productIds: bigint[]) {
  const ids = new Set(productIds.map(String));
  return d.pedidos.flatMap((p) => p.lineas).filter((l) => ids.has(l.product_id.toString())).reduce((a, l) => a + cantidadLinea(l), 0);
}

function precioFacturado(d: Datos, productIds: bigint[]) {
  const ids = new Set(productIds.map(String));
  const lineas = d.semana.facturas.flatMap((f) => f.lineas).filter((l) => l.product_id != null && ids.has(l.product_id.toString()));
  const cantidad = lineas.reduce((a, l) => a + num0(l.cantidad), 0);
  return cantidad > 0 ? lineas.reduce((a, l) => a + num0(l.importe), 0) / cantidad : null;
}

/** Conserva todos los datos aunque la plantilla tenga solo tres renglones/columnas de captura. */
function compactarTotales(valores: number[], capacidad: number) {
  if (valores.length <= capacidad) return valores;
  return [...valores.slice(0, capacidad - 1), valores.slice(capacidad - 1).reduce((a, x) => a + x, 0)];
}

function precioVentaGrupo(d: Datos, productos: Datos['productos']) {
  const facturado = precioFacturado(d, productos.map((p) => p.id));
  if (facturado != null) return facturado;
  const referencia = productos[0];
  if (!referencia) return 0;
  // Carnitas puede salir del remanente con costo $0, pero conserva su precio fijo.
  if (referencia.tipo_operativo === 'precio_fijo' || referencia.tipo_operativo === 'servicio') {
    return Number(referencia.precio_venta_fijo ?? referencia.ultimo_costo ?? referencia.costo_promedio ?? 0);
  }
  const ids = new Set(productos.map((p) => p.id.toString()));
  const salidas = d.producciones.flatMap((p) => p.salidas).filter((s) => ids.has(s.product_id.toString()));
  const cajas = salidas.reduce((a, s) => a + num0(s.cajas), 0);
  if (cajas > 0) return salidas.reduce((a, s) => a + num0(s.costo_total), 0) / cajas
    + (productos.some((p) => p.tipo_operativo === 'proteina') ? MARKUP_PROTEINA : 0);
  return Number(referencia.ultimo_costo ?? referencia.costo_promedio ?? 0)
    + (referencia.tipo_operativo === 'proteina' ? MARKUP_PROTEINA : 0);
}

function valoresInventario(d: Datos) {
  const guardado = {
    carne: num0(d.semana.valor_carne), congelado: num0(d.semana.valor_congelado),
    desechables: num0(d.semana.valor_desechables),
  };
  if (d.semana.estado === 'cerrada' || guardado.carne + guardado.congelado + guardado.desechables > 0) return guardado;
  const terminado = d.existencias.filter((e) => e.products.linea_operacion === 'carne' && e.products.tipo_operativo !== 'materia_prima')
    .reduce((a, e) => a + (Math.max(0, num0(e.cantidad_disponible)) + Math.max(0, num0(e.cantidad_transito))) * num0(e.costo_promedio), 0);
  const desechables = d.existencias.filter((e) => e.products.linea_operacion === 'desechables')
    .reduce((a, e) => a + (Math.max(0, num0(e.cantidad_disponible)) + Math.max(0, num0(e.cantidad_transito))) * num0(e.costo_promedio), 0);
  const fresca = d.lotesVivos.filter((l) => !l.congelado).reduce((a, l) => a + num0(l.costo_disponible), 0);
  const congelado = d.lotesVivos.filter((l) => l.congelado).reduce((a, l) => a + num0(l.costo_disponible), 0);
  return { carne: r2(terminado + fresca), congelado: r2(congelado), desechables: r2(desechables) };
}

function errorCobertura(libro: string, detalles: string[]) {
  if (!detalles.length) return;
  throw new HttpError(409, `${libro} no tiene una celda configurada para: ${[...new Set(detalles)].slice(0, 8).join(', ')}${detalles.length > 8 ? ` y ${detalles.length - 8} más` : ''}. No se generó un archivo incompleto.`);
}

function esCierreHistoricoSinDetalle(d: Datos) {
  return d.semana.estado === 'cerrada' && d.semana.facturas.length > 0
    && d.semana.facturas.every((f) => f.lineas.every((l) => l.product_id == null));
}

function llenarWeeklyOrder(wb: ExcelJS.Workbook, d: Datos) {
  const n = d.semana.semana;
  const ws = hojaSemana(wb, /^Meat Order/, n, `Meat Order (${n})`);
  const carne = d.productos.filter((p) => FILA_CARNE[p.sku] != null);
  const codigosPlantilla = new Set(Object.values(CODIGO_ENCABEZADO));
  const sinCelda = d.pedidos.filter((p) => p.linea_operacion === 'carne').flatMap((p) => p.lineas
    .filter((l) => cantidadLinea(l) > 0 && (!FILA_CARNE[l.producto.sku] || !codigosPlantilla.has(p.ubicacion.codigo)))
    .map((l) => `${p.ubicacion.nombre} / ${l.producto.nombre}`));
  errorCobertura('Weekly Order', sinCelda);
  for (let base = 1; base <= ws.columnCount; base += 10) {
    const encabezado = normal(ws.getCell(7, base).text);
    if (!encabezado || encabezado === 'TOTAL' || ['PABLO', 'MH'].some((x) => encabezado.startsWith(x)) || encabezado.startsWith('TAPATIOS MONDAY') || encabezado.startsWith('TAPATIOS THURSDAY')) continue;
    const codigo = CODIGO_ENCABEZADO[encabezado];
    if (!codigo) continue;
    // Streamwood tenía dos renglones especiales en el archivo legado. La operación
    // actual usa la misma orden estándar de la foto para todas las sucursales.
    for (let row = 11; row <= 29; row += 1) for (const offset of [0, 3, 6]) {
      ws.getCell(row, base + offset).value = ws.getCell(row, 1).value;
    }
    const dias: [number, number][] = codigo.startsWith('T') ? [[1, 1], [4, 4], [6, 7]] : [[3, 1], [6, 7]];
    for (const [, offset] of dias) for (let row = 11; row <= 29; row += 1) ws.getCell(row, base + offset).value = null;
    for (let row = 11; row <= 29; row += 1) ws.getCell(row, base + 9).value = null;
    for (const [dia, offset] of dias) {
      const fecha = sumarDias(d.semana.inicia_at, dia - 1);
      ws.getCell(9, base + offset - 1).value = excelDate(fecha);
      ws.getCell(9, base + offset).value = excelDate(fecha);
      for (let row = 11; row <= 29; row += 1) {
        const qty = carne
          .filter((p) => FILA_CARNE[p.sku] === row)
          .reduce((total, p) => total + valorPedido(d, 'carne', codigo, p.id, dia), 0);
        if (qty > 0) ws.getCell(row, base + offset).value = qty;
      }
    }
    for (let row = 11; row <= 29; row += 1) {
      const total = dias.reduce((a, [, offset]) => a + Number(ws.getCell(row, base + offset).value ?? 0), 0);
      formula(ws, ws.getCell(row, base + 9).address, `SUM(${ws.getCell(row, base + 1).address},${ws.getCell(row, base + 4).address},${ws.getCell(row, base + 7).address})`, total);
    }
    for (const [, offset] of dias) {
      const total = Array.from({ length: 19 }, (_, i) => Number(ws.getCell(11 + i, base + offset).value ?? 0)).reduce((a, v) => a + v, 0);
      formula(ws, ws.getCell(31, base + offset).address, `SUM(${ws.getCell(11, base + offset).address}:${ws.getCell(29, base + offset).address})`, total);
    }
    const total = Array.from({ length: 19 }, (_, i) => Number((ws.getCell(11 + i, base + 9).value as { result?: number })?.result ?? 0)).reduce((a, v) => a + v, 0);
    formula(ws, ws.getCell(31, base + 9).address, `SUM(${ws.getCell(11, base + 9).address}:${ws.getCell(29, base + 9).address})`, total);
  }
}

const COLUMNAS_DESECHABLES: Record<string, number> = {
  LOMBA: 9, NAPER: 11, CAROL: 13, LISLE: 15, GLEND: 17, WESTC: 19, BATAV: 21, ALGON: 23,
  NAPER2: 25, ROLLI: 27, SCHAU: 29, CRYST: 31, LAKEZ: 33, PLAIN: 35, FRANK: 37,
  TGE: 41, TST: 43, TLO: 45, TNA: 47,
};

const COLUMNAS_DESTINO_DESECHABLES: Record<number, number> = {
  9: 49, 11: 52, 13: 55, 15: 58, 17: 61, 19: 64, 21: 67, 23: 70, 25: 73, 27: 76,
  29: 79, 31: 82, 33: 85, 35: 88, 37: 91, 41: 97, 43: 100, 45: 103, 47: 106,
};

function llenarShipping(ws: ExcelJS.Worksheet, d: Datos, filas: Map<string, number>) {
  const columnas: Record<string, number> = { LOMBA: 5, NAPER: 7, CAROL: 9, LISLE: 11, GLEND: 13, WESTC: 15, BATAV: 17, ALGON: 19, NAPER2: 21, ROLLI: 23, SCHAU: 25 };
  const productos = d.productos.filter((p) => p.linea_operacion === 'desechables');
  for (let r = 3; r <= 46; r += 1) for (const col of Object.values(columnas)) ws.getCell(r, col).value = null;
  for (const p of productos) {
    const sourceRow = filas.get(normal(p.nombre));
    if (!sourceRow) continue;
    const row = sourceRow - 1;
    if (row < 3 || row > 46) continue;
    let total = 0;
    for (const [codigo, col] of Object.entries(columnas)) {
      const qty = valorPedido(d, null, codigo, p.id);
      if (qty > 0) ws.getCell(row, col).value = qty;
      total += qty;
    }
    ws.getCell(row, 3).value = total || null;
  }
}

function llenarDesechables(wb: ExcelJS.Workbook, d: Datos) {
  const ws = hojaSemana(wb, /^Week \(/, d.semana.semana, `Week (${d.semana.semana})`);
  const filas = filaPorNombre(ws, 1, 2, 53);
  const productos = d.productos.filter((p) => p.linea_operacion === 'desechables');
  const bodega = d.ubicaciones.find((u) => u.codigo === 'BOD');
  const sinCelda = d.pedidos.flatMap((pedido) => pedido.lineas
    .filter((l) => l.producto.linea_operacion === 'desechables' && cantidadLinea(l) > 0
      && (!filas.has(normal(l.producto.nombre)) || !COLUMNAS_DESECHABLES[pedido.ubicacion.codigo]))
    .map((l) => `${pedido.ubicacion.nombre} / ${l.producto.nombre}`));
  errorCobertura('Disposables', sinCelda);
  for (let row = 2; row <= 53; row += 1) for (const col of Object.values(COLUMNAS_DESECHABLES)) ws.getCell(row, col).value = null;
  for (const p of productos) {
    const row = filas.get(normal(p.nombre));
    if (!row) continue;
    const ex = d.existencias.find((e) => e.ubicacion_id === bodega?.id && e.product_id === p.id);
    const costo = num0(ex?.costo_promedio) || Number(p.ultimo_costo ?? p.costo_promedio ?? 0);
    const precio = Number(p.precio_venta_fijo ?? 0);
    ws.getCell(row, 5).value = costo;
    ws.getCell(row, 7).value = precio;
    let vendido = 0;
    for (const [codigo, sourceCol] of Object.entries(COLUMNAS_DESECHABLES)) {
      const qty = valorPedido(d, null, codigo, p.id);
      ws.getCell(row, sourceCol).value = qty || null;
      vendido += qty;
      const destino = COLUMNAS_DESTINO_DESECHABLES[sourceCol];
      if (destino) {
        formula(ws, ws.getCell(row, destino).address, ws.getCell(row, sourceCol).address, qty);
        formula(ws, ws.getCell(row, destino + 1).address, `${ws.getCell(row, destino).address}*G${row}`, qty * precio);
      }
    }
    const compras = d.compras.flatMap((c) => c.lineas).filter((l) => l.product_id === p.id).reduce((a, l) => a + num0(l.cajas), 0);
    const final = Math.max(0, num0(ex?.cantidad_disponible));
    const hold = num0(ex?.cantidad_transito);
    const inicial = Math.max(0, final + vendido - compras);
    // DC (107) pertenece todavía al importe de LBT-8. El generador anterior lo
    // sobrescribía por error con el inventario inicial.
    ws.getCell(row, 109).value = inicial; // DE initial
    ws.getCell(row, 111).value = compras || null; // DG new order
    formula(ws, ws.getCell(row, 113).address, `SUM(I${row}:AV${row})`, vendido); // DI sold
    formula(ws, ws.getCell(row, 115).address, `DE${row}+DG${row}-DI${row}`, final); // DK final
    formula(ws, ws.getCell(row, 117).address, `E${row}*DK${row}`, final * costo); // DM cost
    formula(ws, ws.getCell(row, 121).address, `G${row}*DK${row}`, final * precio); // DQ selling value
    ws.getCell(row, 123).value = hold || null; // DS hold
    ws.getCell(row, 125).value = hold > 0 ? costo : 0; // DU reserve cost
    formula(ws, ws.getCell(row, 127).address, `DU${row}*1.2`, hold > 0 ? costo * 1.2 : 0); // DW reserve selling price
    formula(ws, ws.getCell(row, 129).address, `DU${row}*DS${row}`, hold * costo); // DY hold value
  }
  for (const col of Object.values(COLUMNAS_DESECHABLES)) {
    const total = Array.from({ length: 52 }, (_, i) => Number(ws.getCell(i + 2, col).value ?? 0)).reduce((a, x) => a + x, 0);
    formula(ws, ws.getCell(54, col).address, `SUM(${ws.getCell(2, col).address}:${ws.getCell(53, col).address})`, total);
  }
  for (const col of [109, 111, 113, 115, 117, 121, 129]) {
    const total = Array.from({ length: 52 }, (_, i) => {
      const value = ws.getCell(i + 2, col).value;
      return typeof value === 'object' && value && 'result' in value ? Number(value.result ?? 0) : Number(value ?? 0);
    }).reduce((a, x) => a + x, 0);
    formula(ws, ws.getCell(54, col).address, `SUM(${ws.getCell(2, col).address}:${ws.getCell(53, col).address})`, total);
  }
  formula(ws, 'DO54', 'DM54+DY54', numeroCelda(ws.getCell('DM54')) + numeroCelda(ws.getCell('DY54')));
  const totalVenta = Object.values(COLUMNAS_DESTINO_DESECHABLES).reduce((total, col) => total
    + Array.from({ length: 52 }, (_, i) => {
      const value = ws.getCell(i + 2, col + 1).value;
      return typeof value === 'object' && value && 'result' in value ? Number(value.result ?? 0) : 0;
    }).reduce((a, x) => a + x, 0), 0);
  formula(ws, 'DO55', 'AX54+BA54+BD54+BG54+BJ54+BM54+BP54+BS54+BV54+BY54+CB54+CT54+CW54+CZ54+DC54', totalVenta);
  const shipping = wb.getWorksheet('Shipping');
  if (shipping) llenarShipping(shipping, d, filas);
}

const GRUPOS_MATERIA: Record<string, [number, number]> = {
  'RAW-INSIDE-SKIRT': [3, 6], 'RAW-CHICKEN': [7, 10], 'RAW-PORK-BUTT': [11, 14],
  'RAW-OUTSIDE-SKIRT': [15, 18], 'RAW-INSIDE-ROUND': [19, 22], 'RAW-TAPATIOS-TACO': [23, 26],
};
const FILA_PRODUCCION: Record<string, number> = {
  'MEAT-STEAK': 3, 'MEAT-CHICKEN': 5, 'MEAT-PASTOR-BPM': 7, 'MEAT-PASTOR-TAP': 7,
  'MEAT-ASADA': 9, 'MEAT-FAJITAS': 11, 'MEAT-MILANESA': 13, 'MEAT-TAMAL': 15,
  'MEAT-CHILE': 17, 'MEAT-DORADO': 19, 'MEAT-CARNITAS': 21, 'MEAT-TAPATIOS-TACO': 23,
};

function llenarProduccion(wb: ExcelJS.Workbook, d: Datos) {
  const ws = hojaSemana(wb, /^Production \(/, d.semana.semana, `Production (${d.semana.semana})`);
  // Las semanas 27/28 llegaron con saldos y pedidos, pero sin batches históricos en
  // la base. La hoja original es la única fuente completa y no debe vaciarse.
  if (d.semana.estado === 'cerrada' && d.producciones.length === 0
    && [...new Set(Object.values(FILA_PRODUCCION))].some((row) => numeroCelda(ws.getCell(row, 35)) > 0)) return;
  const carniceria = d.ubicaciones.find((u) => u.codigo === 'CARN');
  const sinCelda = [
    ...d.compras.flatMap((c) => c.lineas.filter((l) => l.producto.tipo_operativo === 'materia_prima' && !GRUPOS_MATERIA[l.producto.sku]).map((l) => `compra / ${l.producto.nombre}`)),
    ...d.producciones.flatMap((p) => p.salidas.filter((s) => !FILA_PRODUCCION[s.producto.sku]).map((s) => `producción / ${s.producto.nombre}`)),
  ];
  errorCobertura('Production', sinCelda);
  for (const [sku, [inicio, totalRow]] of Object.entries(GRUPOS_MATERIA)) {
    const producto = d.productos.find((p) => p.sku === sku);
    if (!producto) continue;
    for (let row = inicio; row < totalRow; row += 1) for (const col of [3, 5, 7]) ws.getCell(row, col).value = null;
    const lineas = d.compras.flatMap((c) => c.lineas.map((l) => ({ compra: c, linea: l }))).filter((x) => x.linea.product_id === producto.id);
    const capacidad = totalRow - inicio;
    const mostradas = lineas.length <= capacidad ? lineas.map((x) => ({ cajas: num0(x.linea.cajas), peso: num0(x.linea.peso_total_lb), costo: num0(x.linea.costo_total) })) : [
      ...lineas.slice(0, capacidad - 1).map((x) => ({ cajas: num0(x.linea.cajas), peso: num0(x.linea.peso_total_lb), costo: num0(x.linea.costo_total) })),
      lineas.slice(capacidad - 1).reduce((a, x) => ({ cajas: a.cajas + num0(x.linea.cajas), peso: a.peso + num0(x.linea.peso_total_lb), costo: a.costo + num0(x.linea.costo_total) }), { cajas: 0, peso: 0, costo: 0 }),
    ];
    mostradas.forEach((x, i) => {
      ws.getCell(inicio + i, 3).value = x.cajas;
      ws.getCell(inicio + i, 5).value = x.peso;
      ws.getCell(inicio + i, 7).value = x.costo;
    });
    const cajas = lineas.reduce((a, x) => a + num0(x.linea.cajas), 0);
    const peso = lineas.reduce((a, x) => a + num0(x.linea.peso_total_lb), 0);
    const costo = lineas.reduce((a, x) => a + num0(x.linea.costo_total), 0);
    formula(ws, ws.getCell(totalRow, 3).address, `SUM(C${inicio}:C${totalRow - 1})`, cajas);
    formula(ws, ws.getCell(totalRow, 5).address, `SUM(E${inicio}:E${totalRow - 1})`, peso);
    formula(ws, ws.getCell(totalRow, 7).address, `SUM(G${inicio}:G${totalRow - 1})`, costo);
    ws.getCell(totalRow, 9).value = cajas > 0 ? peso / cajas : Number(producto.peso_caja_lb ?? 0);
    ws.getCell(totalRow, 11).value = cajas > 0 ? costo / cajas : Number(producto.ultimo_costo ?? 0);
    const ex = d.existencias.find((e) => e.ubicacion_id === carniceria?.id && e.product_id === producto.id);
    const lotes = d.usaSnapshot ? [] : d.lotesVivos.filter((l) => l.ubicacion_id === carniceria?.id && l.product_id === producto.id);
    const cajasFinales = Math.max(0, num0(ex?.cantidad_disponible));
    const pesoFinal = ex?.peso_total_lb != null ? num0(ex.peso_total_lb)
      : lotes.length ? lotes.reduce((a, l) => a + num0(l.peso_disponible_lb), 0) : cajasFinales * Number(producto.peso_caja_lb ?? 0);
    const costoFinal = ex?.costo_total != null ? num0(ex.costo_total)
      : lotes.length ? lotes.reduce((a, l) => a + num0(l.costo_disponible), 0) : cajasFinales * num0(ex?.costo_promedio);
    ws.getCell(totalRow, 13).value = cajasFinales;
    ws.getCell(totalRow, 15).value = r2(pesoFinal);
    ws.getCell(totalRow, 17).value = r2(costoFinal);
  }
  for (const row of [...new Set(Object.values(FILA_PRODUCCION))]) {
    const productos = d.productos.filter((p) => FILA_PRODUCCION[p.sku] === row);
    if (!productos.length) continue;
    const ids = new Set(productos.map((p) => p.id.toString()));
    const salidas = d.producciones.flatMap((p) => p.salidas.map((s) => ({ fecha: p.fecha, salida: s }))).filter((x) => ids.has(x.salida.product_id.toString()));
    const porFecha = [...new Set(salidas.map((x) => iso(x.fecha)))].sort().map((dia) =>
      salidas.filter((x) => iso(x.fecha) === dia).reduce((a, x) => a + num0(x.salida.cajas), 0));
    const producido = salidas.reduce((a, x) => a + num0(x.salida.cajas), 0);
    const dias = compactarTotales(porFecha, 3);
    for (let i = 0; i < 3; i += 1) ws.getCell(row, 32 + i).value = dias[i] || null;
    ws.getCell(row, 35).value = producido || null;
    ws.getCell(row, 36).value = precioVentaGrupo(d, productos);
    const vendido = valorProducto(d, productos.map((p) => p.id));
    ws.getCell(row, 37).value = vendido;
    const existencias = d.existencias.filter((e) => e.ubicacion_id === carniceria?.id && ids.has(e.product_id.toString()));
    const final = existencias.reduce((a, e) => a + Math.max(0, num0(e.cantidad_disponible)), 0);
    const valorFinal = existencias.reduce((a, e) => a + Math.max(0, num0(e.cantidad_disponible)) * num0(e.costo_promedio), 0);
    const inicial = final + vendido - producido;
    const pesoCaja = Number(productos[0]?.peso_caja_lb ?? 0);
    const costoInicial = final > 0 ? valorFinal / final : Math.max(0, precioVentaGrupo(d, productos) - (productos.some((p) => p.tipo_operativo === 'proteina') ? MARKUP_PROTEINA : 0));
    ws.getCell(row, 18).value = inicial || null; // R: inventario inicial de producto terminado
    ws.getCell(row, 20).value = inicial || null; // T
    ws.getCell(row, 21).value = r2(inicial * pesoCaja); // U
    ws.getCell(row, 22).value = r2(inicial * costoInicial); // V
    ws.getCell(row, 38).value = final;
    ws.getCell(row, 39).value = r2(valorFinal);
    formula(ws, ws.getCell(row, 40).address, `R${row}+AI${row}-AK${row}-AL${row}`, 0);
  }
  ws.getCell('AO25').value = valoresInventario(d).carne;
}

const FILA_BILLING: Record<string, number> = {
  'MEAT-STEAK': 3, 'MEAT-CHICKEN': 4, 'MEAT-PASTOR-BPM': 5, 'MEAT-PASTOR-TAP': 5,
  'MEAT-ASADA': 6, 'MEAT-FAJITAS': 7, 'MEAT-MILANESA': 8, 'MEAT-TAMAL': 9,
  'MEAT-CHILE': 10, 'MEAT-DORADO': 11, 'MEAT-ADOBO': 12, 'MEAT-CARNITAS': 13,
  'MEAT-CATERING': 15, 'MEAT-PULPA': 16, 'MEAT-TAPATIOS-TACO': 17,
};
const COLUMNA_BILLING: Record<string, number> = {
  LOMBA: 5, NAPER: 8, CAROL: 11, LISLE: 14, GLEND: 17, WESTC: 20, BATAV: 23, ALGON: 26,
  NAPER2: 29, ROLLI: 32, SCHAU: 35, CRYST: 38, LAKEZ: 41, FRANK: 44, PLAIN: 47,
  AUROR: 56, BURLI: 59, TGE: 62, TST: 65, TLO: 68, TNA: 71,
};

function llenarBilling(wb: ExcelJS.Workbook, d: Datos) {
  const ws = hojaSemana(wb, /^Billing \(/, d.semana.semana, `Billing (${d.semana.semana})`);
  if (esCierreHistoricoSinDetalle(d)) return;
  const carne = d.productos.filter((x) => x.linea_operacion === 'carne' && FILA_BILLING[x.sku]);
  const sinCelda = d.pedidos.flatMap((pedido) => pedido.lineas
    .filter((l) => l.producto.linea_operacion === 'carne' && cantidadLinea(l) > 0
      && (!FILA_BILLING[l.producto.sku] || !COLUMNA_BILLING[pedido.ubicacion.codigo]))
    .map((l) => `${pedido.ubicacion.nombre} / ${l.producto.nombre}`));
  errorCobertura('Billing', sinCelda);
  ws.getCell('C1').value = excelDate(d.semana.inicia_at);
  ws.getCell('E1').value = excelDate(sumarDias(d.semana.inicia_at, 6));
  ws.getCell('F1').value = excelDate(sumarDias(d.semana.inicia_at, 6));
  ws.getCell('A14').value = null;
  ws.getCell('C14').value = null;
  ws.getCell('A15').value = 'CATERING';
  const filas = carne.map((p) => FILA_BILLING[p.sku]).filter((row): row is number => row != null);
  const precios = new Map<string, number>();
  for (const row of [...new Set(filas)]) {
    const productosFila = carne.filter((p) => FILA_BILLING[p.sku] === row);
    const referencia = productosFila[0]!;
    const markup = referencia.tipo_operativo === 'proteina' ? MARKUP_PROTEINA : 0;
    const precioVenta = precioVentaGrupo(d, productosFila);
    const basePrice = Math.max(0, precioVenta - markup);
    for (const p of productosFila) precios.set(p.id.toString(), precioVenta);
    ws.getCell(row, 3).value = basePrice;
    for (const [codigo, col] of Object.entries(COLUMNA_BILLING)) {
      const qty = productosFila.reduce((total, p) => total + valorPedido(d, 'carne', codigo, p.id), 0);
      ws.getCell(row, col).value = qty || null;
      formula(ws, ws.getCell(row, col + 1).address, `${ws.getCell(row, col).address}*C${row}`, qty * basePrice);
    }
  }
  for (const [codigo, col] of Object.entries(COLUMNA_BILLING)) {
    const facturas = d.semana.facturas.filter((f) => f.ubicacion.codigo === codigo);
    const facturasCarne = facturas.filter((f) => f.linea_operacion === 'carne');
    let totalCarne = facturasCarne.reduce((a, f) => a + num0(f.total), 0);
    let base = facturasCarne.flatMap((f) => f.lineas).reduce((a, l) => {
      const markup = l.producto?.tipo_operativo === 'proteina' ? MARKUP_PROTEINA : 0;
      return a + Math.max(0, num0(l.importe) - num0(l.cantidad) * markup);
    }, 0);
    let desechables = facturas.filter((f) => f.linea_operacion === 'desechables').reduce((a, f) => a + num0(f.total), 0);
    if (!facturas.length) {
      const lineas = d.pedidos.filter((p) => p.ubicacion.codigo === codigo).flatMap((p) => p.lineas);
      for (const l of lineas) {
        const cantidad = cantidadLinea(l);
        const precio = precios.get(l.product_id.toString()) ?? Number(l.precio_unitario ?? l.producto.precio_venta_fijo ?? 0);
        if (l.producto.linea_operacion === 'desechables') desechables += cantidad * precio;
        else {
          const markup = l.producto.tipo_operativo === 'proteina' ? MARKUP_PROTEINA : 0;
          base += cantidad * Math.max(0, precio - markup);
          totalCarne += cantidad * precio;
        }
      }
    }
    ws.getCell(20, col).value = r2(base);
    ws.getCell(20, col + 1).value = r2(base);
    ws.getCell(21, col).value = r2(Math.max(0, totalCarne - base));
    ws.getCell(21, col + 1).value = r2(Math.max(0, totalCarne - base));
    ws.getCell(22, col).value = r2(desechables);
    ws.getCell(22, col + 1).value = r2(desechables);
    ws.getCell(23, col).value = r2(totalCarne + desechables);
    ws.getCell(23, col + 1).value = r2(totalCarne + desechables);
  }
  const resumenColumnas = Object.values(COLUMNA_BILLING);
  const meat = resumenColumnas.reduce((a, col) => a + Number(ws.getCell(20, col).value ?? 0), 0);
  const markup = resumenColumnas.reduce((a, col) => a + Number(ws.getCell(21, col).value ?? 0), 0);
  const paper = resumenColumnas.reduce((a, col) => a + Number(ws.getCell(22, col).value ?? 0), 0);
  formula(ws, 'BW20', 'SUM(E20:BT20)', meat);
  formula(ws, 'BW21', 'SUM(E21:BT21)', markup);
  formula(ws, 'BW22', 'SUM(E22:BT22)', paper);
  formula(ws, 'BW23', 'SUM(E23:BT23)', meat + markup + paper);

  const inventario = valoresInventario(d);
  ws.getCell('BW3').value = inventario.carne;
  ws.getCell('BW4').value = inventario.congelado;
  ws.getCell('BW5').value = inventario.desechables;
  const saldoAlCierre = (f: Datos['facturasHistoricas'][number]) => Math.max(0, num0(f.total)
    - f.pagos.filter((p) => p.pagado_at <= d.semana.termina_at).reduce((a, p) => a + num0(p.monto), 0));
  const semanasCobro = [d.semana.semana - 2, d.semana.semana - 1, d.semana.semana];
  const saldos = semanasCobro.map((numero, i) => d.facturasHistoricas
    .filter((f) => i === 0 ? f.semana.semana <= numero : f.semana.semana === numero)
    .reduce((a, f) => a + saldoAlCierre(f), 0));
  for (let i = 0; i < 3; i += 1) {
    ws.getCell(6 + i, 75).value = r2(saldos[i] ?? 0);
    ws.getCell(6 + i, 77).value = i === 0 && d.facturasHistoricas.some((f) => f.semana.semana < (semanasCobro[0] ?? 0) && saldoAlCierre(f) > 0)
      ? `BILLING ${semanasCobro[0]} Y ANTERIORES` : `BILLING ${semanasCobro[i]}`;
  }
  const cuentasPorCobrar = saldos.reduce((a, x) => a + x, 0);
  formula(ws, 'BW9', 'SUM(BW3:BW8)', inventario.carne + inventario.congelado + inventario.desechables + cuentasPorCobrar);

  const porProveedor = [...d.comprasPendientes.reduce((mapa, c) => mapa.set(c.proveedor.nombre, (mapa.get(c.proveedor.nombre) ?? 0) + num0(c.total)), new Map<string, number>())]
    .map(([nombre, total]) => ({ nombre, total }));
  const proveedores = porProveedor.length <= 5 ? porProveedor : [
    ...porProveedor.slice(0, 4),
    { nombre: `OTROS · ${porProveedor.slice(4).map((p) => p.nombre).join(', ')}`, total: porProveedor.slice(4).reduce((a, p) => a + p.total, 0) },
  ];
  for (let row = 12; row <= 16; row += 1) for (const col of [75, 77, 78, 79]) ws.getCell(row, col).value = null;
  proveedores.forEach((p, i) => {
    const row = 12 + i;
    ws.getCell(row, 77).value = p.nombre; // BY
    ws.getCell(row, 78).value = r2(p.total); // BZ
    ws.getCell(row, 79).value = 0; // CA
    formula(ws, ws.getCell(row, 75).address, `-SUM(BZ${row}:CB${row})`, -p.total);
  });
  const cuentasPorPagar = porProveedor.reduce((a, p) => a + p.total, 0);
  ws.getCell('BY17').value = 'CLOSING WEEK';
  formula(ws, 'BW17', 'SUM(BW12:BW16)', -cuentasPorPagar);
  const balance = inventario.carne + inventario.congelado + inventario.desechables + cuentasPorCobrar - cuentasPorPagar;
  ws.getCell('BY18').value = 'TOTAL';
  formula(ws, 'BW18', 'BW9+BW17', balance);
}

function limpiarBloqueFactura(ws: ExcelJS.Worksheet, base: number, hasta = 37) {
  for (let row = 10; row <= hasta; row += 1) for (const offset of [0, 2, 4, 6, 8]) ws.getCell(row, base + offset).value = null;
}

const NOMBRE_FACTURA: Record<string, string> = {
  'MEAT-STEAK': 'Steak Taco Meat', 'MEAT-CHICKEN': 'Chicken Taco Meat',
  'MEAT-PASTOR-BPM': 'AlPastor Taco Meat', 'MEAT-PASTOR-TAP': 'AlPastor Taco Meat',
  'MEAT-ASADA': 'Carne Asada', 'MEAT-FAJITAS': 'Fajitas', 'MEAT-MILANESA': 'Milanesa',
  'MEAT-TAMAL': 'Tamal Rojo', 'MEAT-CHILE': 'Chile Relleno', 'MEAT-DORADO': 'Taco Dorado',
  'MEAT-ADOBO': 'Adobo Picadillo', 'MEAT-CARNITAS': 'Carnitas', 'MEAT-CATERING': 'Catering',
  'MEAT-PULPA': 'Pulpa Taco Meat', 'MEAT-TAPATIOS-TACO': 'Tapatios Taco Meat',
};

function llenarLibroCliente(wb: ExcelJS.Workbook, d: Datos, tipo: 'lbt' | 'aurora') {
  const ws = hojaSemana(wb, /^Week \(/, d.semana.semana, `Week (${d.semana.semana})`);
  if (esCierreHistoricoSinDetalle(d)) return;
  const bloquesBase = tipo === 'lbt'
    ? [{ codigo: 'TGE', base: 1 }, { codigo: 'TST', base: 10 }, { codigo: 'TLO', base: 19 }, { codigo: 'TNA', base: 28 }, { codigo: 'TBO', base: 37 }]
    : [{ codigo: 'AUROR', base: 1 }, { codigo: 'BURLI', base: 10 }];
  const bloques = bloquesBase.filter((b) => b.base <= ws.actualColumnCount && ws.getCell(5, b.base).text.trim());
  const codigosBloque = new Set(bloques.map((b) => b.codigo));
  const empresaCodigo = tipo === 'lbt' ? 'LBT' : 'AUR';
  errorCobertura(tipo === 'lbt' ? 'LBT' : 'Taquería Aurora', d.pedidos
    .filter((p) => p.empresa.codigo === empresaCodigo && p.lineas.some((l) => cantidadLinea(l) > 0) && !codigosBloque.has(p.ubicacion.codigo))
    .map((p) => p.ubicacion.nombre));
  for (const { codigo, base } of bloques) {
    limpiarBloqueFactura(ws, base, tipo === 'lbt' ? 37 : 27);
    const ubicacion = d.ubicaciones.find((u) => u.codigo === codigo);
    const facturas = d.semana.facturas.filter((f) => f.ubicacion.codigo === codigo);
    // Los estados de cuenta originales se emiten el lunes posterior al cierre del sábado.
    const fechaEmision = sumarDias(d.semana.termina_at, 2);
    const fechaVence = sumarDias(fechaEmision, tipo === 'aurora' ? 7 : 0);
    ws.getCell(1, base + 8).value = excelDate(fechaEmision);
    ws.getCell(2, base + 8).value = excelDate(fechaVence);
    ws.getCell(4, base + 8).value = `${d.semana.anio}-${d.semana.semana}`;
    if (ubicacion) {
      ws.getCell(5, base).value = ubicacion.nombre;
      if (ubicacion.direccion) ws.getCell(6, base).value = ubicacion.direccion;
    }
    const precioPorProducto = new Map(facturas.flatMap((f) => f.lineas).filter((l) => l.product_id != null).map((l) => [l.product_id!.toString(), num0(l.precio_unitario)]));
    const detalles = d.pedidos
      .filter((p) => p.ubicacion.codigo === codigo)
      .flatMap((p) => p.lineas.map((l) => ({
        fecha: p.fecha_entrega, linea: l.producto.linea_operacion ?? p.linea_operacion, producto: l.producto,
        cantidad: cantidadLinea(l),
        precio: precioPorProducto.get(l.product_id.toString()) ?? (num0(l.precio_unitario) || precioVentaGrupo(d, [l.producto])),
      })))
      .filter((item) => item.cantidad > 0)
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.producto.orden_operativo - b.producto.orden_operativo);
    const renglonesSecuenciales = tipo === 'lbt' ? detalles.filter((x) => x.linea === 'carne').length : detalles.length;
    const desechablesSinFila = tipo === 'lbt' ? detalles.filter((x) => x.linea === 'desechables' && ![
      'FOIL STD', 'TAPATIOS THREE', 'TAPATIOS ONE', 'TAPATIOS SUIZO', 'THERMAL PAPER', 'COCO LOPEZ', 'XL NITRILE',
    ].some((nombre) => normal(x.producto.nombre).includes(nombre))) : [];
    const capacidad = tipo === 'lbt' ? 17 : 15;
    errorCobertura(tipo === 'lbt' ? 'LBT' : 'Taquería Aurora', [
      ...(renglonesSecuenciales > capacidad ? [`${ubicacion?.nombre ?? codigo}: ${renglonesSecuenciales} renglones (máximo ${capacidad})`] : []),
      ...desechablesSinFila.map((x) => `${ubicacion?.nombre ?? codigo} / ${x.producto.nombre}`),
    ]);
    let filaCarne = 10;
    let filaAurora = 10;
    let markupCantidad = 0;
    let markupImporte = 0;
    let detalleImporte = 0;
    for (const item of detalles) {
      let row: number;
      if (tipo === 'lbt' && item.linea === 'desechables') {
        const nombre = normal(item.producto.nombre);
        row = nombre.includes('FOIL STD') ? 27
          : nombre.includes('TAPATIOS THREE') ? 28
            : nombre.includes('TAPATIOS ONE') ? 29
              : nombre.includes('TAPATIOS SUIZO') ? 30
                : nombre.includes('THERMAL PAPER') ? 31
                  : nombre.includes('COCO LOPEZ') ? 32
                    : nombre.includes('XL NITRILE') ? 33 : 0;
      } else row = tipo === 'lbt' ? filaCarne++ : filaAurora++;
      if (!row || row > (tipo === 'lbt' ? (item.linea === 'desechables' ? 35 : 26) : 24)) continue;
      const markup = item.producto.tipo_operativo === 'proteina' ? MARKUP_PROTEINA : 0;
      const precioBase = Math.max(0, item.precio - markup);
      if (item.linea === 'carne' || tipo === 'aurora') ws.getCell(row, base).value = excelDate(item.fecha);
      ws.getCell(row, base + 2).value = NOMBRE_FACTURA[item.producto.sku] ?? item.producto.nombre;
      ws.getCell(row, base + 4).value = precioBase;
      const cantidadAnterior = Number(ws.getCell(row, base + 6).value ?? 0);
      const importeAnterior = Number(ws.getCell(row, base + 8).value ?? 0);
      ws.getCell(row, base + 6).value = cantidadAnterior + item.cantidad;
      ws.getCell(row, base + 8).value = r2(importeAnterior + precioBase * item.cantidad);
      detalleImporte += precioBase * item.cantidad;
      markupCantidad += markup > 0 ? item.cantidad : 0;
      markupImporte += markup * item.cantidad;
    }
    const filaMarkup = tipo === 'lbt' ? 36 : 25;
    const filaTotal = tipo === 'lbt' ? 37 : 26;
    ws.getCell(filaMarkup, base + 2).value = tipo === 'lbt' ? 'Meat - Markup' : 'Markup';
    ws.getCell(filaMarkup, base + 4).value = markupCantidad > 0 ? r2(markupImporte / markupCantidad) : 0;
    ws.getCell(filaMarkup, base + 6).value = markupCantidad || null;
    ws.getCell(filaMarkup, base + 8).value = r2(markupImporte);
    ws.getCell(filaTotal, base + 2).value = tipo === 'lbt' ? 'Invoice Total' : 'Total Invoice';
    const totalFacturado = facturas.reduce((a, f) => a + num0(f.total), 0);
    ws.getCell(filaTotal, base + 8).value = r2(totalFacturado || detalleImporte + markupImporte);
  }
}

function numeroCelda(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'result' in value) return Number(value.result ?? 0);
  return Number(value ?? 0) || 0;
}

function validarSalida(tipo: TipoExcel, wb: ExcelJS.Workbook, d: Datos) {
  let esperado = 0;
  let escrito = 0;
  if (tipo === 'weekly-order') {
    const ws = hojaSemana(wb, /^Meat Order/, d.semana.semana, `Meat Order (${d.semana.semana})`);
    esperado = d.pedidos.filter((p) => p.linea_operacion === 'carne').flatMap((p) => p.lineas).reduce((a, l) => a + cantidadLinea(l), 0);
    for (let base = 1; base <= ws.columnCount; base += 10) {
      const codigo = CODIGO_ENCABEZADO[normal(ws.getCell(7, base).text)];
      if (!codigo) continue;
      for (const offset of codigo.startsWith('T') ? [1, 4, 7] : [1, 7]) for (let row = 11; row <= 29; row += 1) escrito += numeroCelda(ws.getCell(row, base + offset));
    }
  } else if (tipo === 'disposables') {
    const ws = hojaSemana(wb, /^Week \(/, d.semana.semana, `Week (${d.semana.semana})`);
    esperado = d.pedidos.flatMap((p) => p.lineas).filter((l) => l.producto.linea_operacion === 'desechables').reduce((a, l) => a + cantidadLinea(l), 0);
    escrito = Object.values(COLUMNAS_DESECHABLES).reduce((a, col) => a + Array.from({ length: 52 }, (_, i) => numeroCelda(ws.getCell(i + 2, col))).reduce((x, y) => x + y, 0), 0);
  } else if (tipo === 'production') {
    const ws = hojaSemana(wb, /^Production \(/, d.semana.semana, `Production (${d.semana.semana})`);
    esperado = d.producciones.flatMap((p) => p.salidas).reduce((a, s) => a + num0(s.cajas), 0);
    escrito = [...new Set(Object.values(FILA_PRODUCCION))].reduce((a, row) => a + numeroCelda(ws.getCell(row, 35)), 0);
    if (esperado === 0 && d.semana.estado === 'cerrada' && escrito > 0) return;
  } else if (tipo === 'billing') {
    if (esCierreHistoricoSinDetalle(d)) return;
    const ws = hojaSemana(wb, /^Billing \(/, d.semana.semana, `Billing (${d.semana.semana})`);
    esperado = d.pedidos.flatMap((p) => p.lineas).filter((l) => l.producto.linea_operacion === 'carne').reduce((a, l) => a + cantidadLinea(l), 0);
    escrito = [...new Set(Object.values(FILA_BILLING))].reduce((total, row) => total
      + Object.values(COLUMNA_BILLING).reduce((a, col) => a + numeroCelda(ws.getCell(row, col)), 0), 0);
  } else return;
  if (Math.abs(esperado - escrito) > 0.001) {
    throw new HttpError(409, `${ARCHIVOS[tipo]} no pasó la validación: el sistema tiene ${r2(esperado)} unidades y la plantilla recibió ${r2(escrito)}. No se descargó un libro incompleto.`);
  }
}

export async function generarExcel(negocioId: bigint, semanaId: bigint, tipo: TipoExcel) {
  const d = await datos(negocioId, semanaId);
  const wb = await plantilla(tipo);
  if (tipo === 'weekly-order') llenarWeeklyOrder(wb, d);
  else if (tipo === 'disposables') llenarDesechables(wb, d);
  else if (tipo === 'production') llenarProduccion(wb, d);
  else if (tipo === 'billing') llenarBilling(wb, d);
  else llenarLibroCliente(wb, d, tipo);
  validarSalida(tipo, wb, d);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
