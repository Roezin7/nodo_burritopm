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
  const [pedidos, compras, producciones, existencias, productos, ubicaciones] = await Promise.all([
    prisma.pedidos_operativos.findMany({
      where: { negocio_id: negocioId, fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at }, estado: { not: 'cancelado' } },
      include: { ubicacion: true, empresa: true, lineas: { include: { producto: true }, orderBy: { producto: { orden_operativo: 'asc' } } } },
      orderBy: [{ fecha_entrega: 'asc' }, { ubicacion: { orden_operativo: 'asc' } }],
    }),
    prisma.compras.findMany({
      where: { negocio_id: negocioId, fecha: { gte: semana.inicia_at, lte: semana.termina_at } },
      include: { proveedor: true, lineas: { include: { producto: true } } }, orderBy: { fecha: 'asc' },
    }),
    prisma.producciones.findMany({
      where: { negocio_id: negocioId, fecha: { gte: semana.inicia_at, lte: semana.termina_at } },
      include: { materia_prima: true, salidas: { include: { producto: true } } }, orderBy: { fecha: 'asc' },
    }),
    prisma.existencias.findMany({ where: { negocio_id: negocioId }, include: { products: true, ubicaciones: true } }),
    prisma.products.findMany({ where: { negocio_id: negocioId, activo: true, linea_operacion: { not: null } }, orderBy: [{ linea_operacion: 'asc' }, { orden_operativo: 'asc' }] }),
    prisma.ubicaciones.findMany({ where: { negocio_id: negocioId }, include: { empresa_cliente: true }, orderBy: { orden_operativo: 'asc' } }),
  ]);
  return { semana, pedidos, compras, producciones, existencias, productos, ubicaciones };
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
    .reduce((a, l) => a + num0(l.cantidad), 0);
}

function llenarWeeklyOrder(wb: ExcelJS.Workbook, d: Datos) {
  const n = d.semana.semana;
  const ws = hojaSemana(wb, /^Meat Order/, n, `Meat Order (${n})`);
  const carne = d.productos.filter((p) => FILA_CARNE[p.sku] != null);
  for (let base = 1; base <= ws.columnCount; base += 10) {
    const encabezado = normal(ws.getCell(7, base).text);
    if (!encabezado || encabezado === 'TOTAL' || ['PABLO', 'MH'].some((x) => encabezado.startsWith(x)) || encabezado.startsWith('TAPATIOS MONDAY') || encabezado.startsWith('TAPATIOS THURSDAY')) continue;
    const codigo = CODIGO_ENCABEZADO[encabezado];
    if (!codigo) continue;
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
  for (const p of productos) {
    const row = filas.get(normal(p.nombre));
    if (!row) continue;
    const costo = Number(p.ultimo_costo ?? p.costo_promedio ?? 0);
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
    const ex = d.existencias.find((e) => e.ubicacion_id === bodega?.id && e.product_id === p.id);
    const final = num0(ex?.cantidad_disponible);
    const hold = num0(ex?.cantidad_transito);
    ws.getCell(row, 107).value = Math.max(0, final + vendido - compras); // DE initial
    ws.getCell(row, 109).value = compras || null; // DG new order
    ws.getCell(row, 111).value = vendido; // DI sold
    ws.getCell(row, 115).value = final; // DK final
    ws.getCell(row, 117).value = r2(final * costo); // DM cost
    ws.getCell(row, 121).value = r2(final * precio); // DQ selling value
    ws.getCell(row, 123).value = hold || null; // DS hold
    ws.getCell(row, 129).value = r2(hold * costo); // DY hold value
  }
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
  const carniceria = d.ubicaciones.find((u) => u.codigo === 'CARN');
  for (const [sku, [inicio, totalRow]] of Object.entries(GRUPOS_MATERIA)) {
    const producto = d.productos.find((p) => p.sku === sku);
    if (!producto) continue;
    for (let row = inicio; row < totalRow; row += 1) for (const col of [3, 5, 7]) ws.getCell(row, col).value = null;
    const lineas = d.compras.flatMap((c) => c.lineas.map((l) => ({ compra: c, linea: l }))).filter((x) => x.linea.product_id === producto.id).slice(0, totalRow - inicio);
    lineas.forEach((x, i) => {
      ws.getCell(inicio + i, 3).value = num0(x.linea.cajas);
      ws.getCell(inicio + i, 5).value = num0(x.linea.peso_total_lb);
      ws.getCell(inicio + i, 7).value = num0(x.linea.costo_total);
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
    ws.getCell(totalRow, 13).value = num0(ex?.cantidad_disponible);
    ws.getCell(totalRow, 15).value = r2(num0(ex?.cantidad_disponible) * Number(producto.peso_caja_lb ?? 0));
    ws.getCell(totalRow, 17).value = r2(num0(ex?.cantidad_disponible) * num0(ex?.costo_promedio));
  }
  for (const [sku, row] of Object.entries(FILA_PRODUCCION)) {
    const producto = d.productos.find((p) => p.sku === sku);
    if (!producto) continue;
    const salidas = d.producciones.flatMap((p) => p.salidas.map((s) => ({ fecha: p.fecha, salida: s }))).filter((x) => x.salida.product_id === producto.id);
    const porFecha = [...new Set(salidas.map((x) => iso(x.fecha)))].sort().map((dia) =>
      salidas.filter((x) => iso(x.fecha) === dia).reduce((a, x) => a + num0(x.salida.cajas), 0));
    const producido = salidas.reduce((a, x) => a + num0(x.salida.cajas), 0);
    if (salidas.length) {
      for (let i = 0; i < 3; i += 1) ws.getCell(row, 32 + i).value = porFecha[i] || null;
      ws.getCell(row, 35).value = producido;
      ws.getCell(row, 36).value = num0(salidas.at(-1)!.salida.precio_venta_caja);
    }
    const vendido = d.pedidos.flatMap((p) => p.lineas).filter((l) => l.product_id === producto.id).reduce((a, l) => a + num0(l.cantidad), 0);
    ws.getCell(row, 37).value = vendido;
    const ex = d.existencias.find((e) => e.ubicacion_id === carniceria?.id && e.product_id === producto.id);
    ws.getCell(row, 38).value = num0(ex?.cantidad_disponible);
    ws.getCell(row, 39).value = r2(num0(ex?.cantidad_disponible) * num0(ex?.costo_promedio));
  }
  ws.getCell('AO25').value = num0(d.semana.valor_carne);
}

const FILA_BILLING: Record<string, number> = {
  'MEAT-STEAK': 3, 'MEAT-CHICKEN': 4, 'MEAT-PASTOR-BPM': 5, 'MEAT-PASTOR-TAP': 5,
  'MEAT-ASADA': 6, 'MEAT-FAJITAS': 7, 'MEAT-MILANESA': 8, 'MEAT-TAMAL': 9,
  'MEAT-CHILE': 10, 'MEAT-DORADO': 11, 'MEAT-ADOBO': 12, 'MEAT-CARNITAS': 13,
  'MEAT-PULPA': 16, 'MEAT-TAPATIOS-TACO': 17,
};
const COLUMNA_BILLING: Record<string, number> = {
  LOMBA: 5, NAPER: 8, CAROL: 11, LISLE: 14, GLEND: 17, WESTC: 20, BATAV: 23, ALGON: 26,
  NAPER2: 29, ROLLI: 32, SCHAU: 35, CRYST: 38, LAKEZ: 41, FRANK: 44, PLAIN: 47,
  AUROR: 56, BURLI: 59, TGE: 62, TST: 65, TLO: 68, TNA: 71,
};

function llenarBilling(wb: ExcelJS.Workbook, d: Datos) {
  const ws = hojaSemana(wb, /^Billing \(/, d.semana.semana, `Billing (${d.semana.semana})`);
  const carne = d.productos.filter((x) => x.linea_operacion === 'carne' && FILA_BILLING[x.sku]);
  const filas = carne.map((p) => FILA_BILLING[p.sku]).filter((row): row is number => row != null);
  for (const row of [...new Set(filas)]) {
    const productosFila = carne.filter((p) => FILA_BILLING[p.sku] === row);
    const referencia = productosFila[0]!;
    const basePrice = referencia.tipo_operativo === 'precio_fijo' || referencia.tipo_operativo === 'servicio'
      ? Number(referencia.precio_venta_fijo ?? referencia.ultimo_costo ?? referencia.costo_promedio ?? 0)
      : Number(referencia.ultimo_costo ?? referencia.costo_promedio ?? 0);
    ws.getCell(row, 3).value = basePrice;
    for (const [codigo, col] of Object.entries(COLUMNA_BILLING)) {
      const qty = productosFila.reduce((total, p) => total + valorPedido(d, 'carne', codigo, p.id), 0);
      ws.getCell(row, col).value = qty || null;
      formula(ws, ws.getCell(row, col + 1).address, `${ws.getCell(row, col).address}*C${row}`, qty * basePrice);
    }
  }
  for (const [codigo, col] of Object.entries(COLUMNA_BILLING)) {
    const facturas = d.semana.facturas.filter((f) => f.ubicacion.codigo === codigo);
    const carne = facturas.filter((f) => f.linea_operacion === 'carne').reduce((a, f) => a + num0(f.total), 0);
    const base = d.productos.filter((p) => p.linea_operacion === 'carne').reduce((a, p) => {
      const precio = p.tipo_operativo === 'precio_fijo' || p.tipo_operativo === 'servicio'
        ? Number(p.precio_venta_fijo ?? p.ultimo_costo ?? p.costo_promedio ?? 0)
        : Number(p.ultimo_costo ?? p.costo_promedio ?? 0);
      return a + valorPedido(d, 'carne', codigo, p.id) * precio;
    }, 0);
    const desechables = facturas.filter((f) => f.linea_operacion === 'desechables').reduce((a, f) => a + num0(f.total), 0);
    ws.getCell(20, col).value = r2(base);
    ws.getCell(20, col + 1).value = r2(base);
    ws.getCell(21, col).value = r2(Math.max(0, carne - base));
    ws.getCell(21, col + 1).value = r2(Math.max(0, carne - base));
    ws.getCell(22, col).value = r2(desechables);
    ws.getCell(22, col + 1).value = r2(desechables);
    ws.getCell(23, col).value = r2(carne + desechables);
    ws.getCell(23, col + 1).value = r2(carne + desechables);
  }
  ws.getCell('BW3').value = num0(d.semana.valor_carne);
  ws.getCell('BW4').value = num0(d.semana.valor_congelado);
  ws.getCell('BW5').value = num0(d.semana.valor_desechables);
  ws.getCell('BW17').value = -num0(d.semana.cuentas_por_pagar);
  ws.getCell('BW18').value = num0(d.semana.balance_neto);
  const pendientes = d.compras.filter((c) => c.estado === 'pendiente').slice(0, 6);
  for (let row = 12; row <= 17; row += 1) for (const col of [77, 78, 79]) ws.getCell(row, col).value = null;
  pendientes.forEach((c, i) => {
    const row = 12 + i;
    ws.getCell(row, 77).value = -num0(c.total);
    ws.getCell(row, 79).value = c.proveedor.nombre;
  });
}

function limpiarBloqueFactura(ws: ExcelJS.Worksheet, base: number, hasta = 37) {
  for (let row = 10; row <= hasta; row += 1) for (const offset of [0, 2, 4, 6, 8]) ws.getCell(row, base + offset).value = null;
}

function llenarLibroCliente(wb: ExcelJS.Workbook, d: Datos, tipo: 'lbt' | 'aurora') {
  const ws = hojaSemana(wb, /^Week \(/, d.semana.semana, `Week (${d.semana.semana})`);
  const bloques = tipo === 'lbt'
    ? [{ codigo: 'TGE', base: 1 }, { codigo: 'TST', base: 10 }, { codigo: 'TLO', base: 19 }, { codigo: 'TNA', base: 28 }, { codigo: 'TBO', base: 37 }]
    : [{ codigo: 'AUROR', base: 1 }, { codigo: 'BURLI', base: 10 }];
  for (const { codigo, base } of bloques) {
    limpiarBloqueFactura(ws, base, tipo === 'lbt' ? 37 : 27);
    const ubicacion = d.ubicaciones.find((u) => u.codigo === codigo);
    const facturas = d.semana.facturas.filter((f) => f.ubicacion.codigo === codigo);
    const principal = facturas[0];
    const fechaEmision = principal?.emitida_at ?? d.semana.termina_at;
    const fechaVence = facturas.reduce((max, f) => f.vence_at > max ? f.vence_at : max, principal?.vence_at ?? d.semana.termina_at);
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
      .flatMap((p) => p.lineas.map((l) => ({ fecha: p.fecha_entrega, linea: p.linea_operacion, producto: l.producto, cantidad: num0(l.cantidad), precio: precioPorProducto.get(l.product_id.toString()) ?? num0(l.precio_unitario) })))
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.producto.orden_operativo - b.producto.orden_operativo);
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
      const markup = item.producto.tipo_operativo === 'proteina' ? Number(item.producto.markup_caja ?? 0) : 0;
      const precioBase = Math.max(0, item.precio - markup);
      if (item.linea === 'carne' || tipo === 'aurora') ws.getCell(row, base).value = excelDate(item.fecha);
      ws.getCell(row, base + 2).value = item.producto.nombre;
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

export async function generarExcel(negocioId: bigint, semanaId: bigint, tipo: TipoExcel) {
  const d = await datos(negocioId, semanaId);
  const wb = await plantilla(tipo);
  if (tipo === 'weekly-order') llenarWeeklyOrder(wb, d);
  else if (tipo === 'disposables') llenarDesechables(wb, d);
  else if (tipo === 'production') llenarProduccion(wb, d);
  else if (tipo === 'billing') llenarBilling(wb, d);
  else llenarLibroCliente(wb, d, tipo);
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
