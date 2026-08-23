import ExcelJS from 'exceljs';
import { prisma } from '../src/db.js';
import { aplicarMovimiento } from '../src/ledger/service.js';
import { transaccionSerializable } from '../src/lib/transaccion.js';

const EXCEL_PATH = process.env.BPM_INVENTORY_XLSX ?? '/Users/arturohernandez/Downloads/Inventarios .xlsx';
const APPLY = process.env.APPLY_WEEK34_RECONCILIATION === '1';
const BUSINESS_NAME = 'Burrito Parrilla Mexicana';
const IMPORT_KEY = 'reconciliacion-inventario-semana34-pedidos-confirmados-v1';
const START = new Date('2026-08-16T00:00:00.000Z');
const END = new Date('2026-08-23T00:00:00.000Z');

const SKU_BY_ROW = [
  ...Array.from({ length: 46 }, (_, i) => `BPM-${String(i + 1).padStart(4, '0')}`),
  'BPM-0053', 'BPM-0054', 'BPM-0050', 'BPM-0051', 'BPM-0052', 'BPM-0047', 'BPM-0048', 'BPM-0049',
];

function numberValue(value: ExcelJS.CellValue): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value === 'object' && 'result' in value) return numberValue(value.result as ExcelJS.CellValue);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: ExcelJS.CellValue): string {
  if (value && typeof value === 'object' && 'result' in value) return textValue(value.result as ExcelJS.CellValue);
  return String(value ?? '').trim();
}

function r3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function r2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type WorkbookItem = { sku: string; nombre: string; inicial: number; costo: number };

async function readWorkbook(): Promise<WorkbookItem[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const week = workbook.getWorksheet('Week (34)');
  if (!week) throw new Error('El Excel no contiene la hoja Week (34).');
  if (textValue(week.getCell(1, 107).value).toUpperCase() !== 'INITIAL INV.') {
    throw new Error('La columna DC no es INITIAL INV.; se cancela para no leer una columna equivocada.');
  }
  const seen = new Set<string>();
  const items: WorkbookItem[] = [];
  for (let row = 2; row <= 55; row += 1) {
    const nombre = textValue(week.getCell(row, 1).value);
    const sku = SKU_BY_ROW[row - 2];
    if (!nombre || !sku) throw new Error(`Falta el producto de desechables en la fila ${row}.`);
    if (seen.has(sku)) throw new Error(`SKU repetido en el Excel: ${sku}.`);
    seen.add(sku);
    items.push({
      sku,
      nombre,
      inicial: numberValue(week.getCell(row, 107).value),
      costo: numberValue(week.getCell(row, 5).value),
    });
  }
  return items;
}

async function main() {
  const source = await readWorkbook();
  const business = await prisma.negocios.findFirstOrThrow({ where: { nombre: BUSINESS_NAME } });
  const bodega = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: business.id, codigo: 'BOD' } });
  const week = await prisma.semanas_operativas.findUnique({
    where: { negocio_id_anio_semana: { negocio_id: business.id, anio: 2026, semana: 34 } },
    select: { id: true, estado: true, inicia_at: true, termina_at: true },
  });
  if (!week) throw new Error('No existe la semana operativa 34.');

  const products = await prisma.products.findMany({
    where: { negocio_id: business.id, linea_operacion: 'desechables', sku: { in: source.map((item) => item.sku) } },
    select: { id: true, sku: true, nombre: true },
  });
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  for (const item of source) if (!productBySku.has(item.sku)) throw new Error(`SKU del Excel sin producto en producción: ${item.sku}.`);

  const orders = await prisma.pedidos_operativos.findMany({
    where: {
      negocio_id: business.id,
      linea_operacion: 'desechables',
      fecha_entrega: { gte: START, lt: END },
      estado: { notIn: ['borrador', 'cancelado'] },
    },
    select: { id: true, estado: true, fecha_entrega: true, lineas: { select: { product_id: true, cantidad: true } } },
  });
  const skuByProductId = new Map(products.map((product) => [product.id.toString(), product.sku]));
  const orderedBySku = new Map<string, number>();
  for (const order of orders) {
    for (const line of order.lineas) {
      const sku = skuByProductId.get(line.product_id.toString());
      if (!sku) throw new Error(`Pedido ${order.id.toString()} contiene producto fuera del Excel.`);
      orderedBySku.set(sku, (orderedBySku.get(sku) ?? 0) + numberValue(line.cantidad as unknown as ExcelJS.CellValue));
    }
  }

  const current = await prisma.existencias.findMany({
    where: { negocio_id: business.id, ubicacion_id: bodega.id, product_id: { in: products.map((product) => product.id) } },
    select: { product_id: true, cantidad_disponible: true, cantidad_reservada: true, cantidad_transito: true },
  });
  const currentBySku = new Map(current.map((row) => [skuByProductId.get(row.product_id.toString())!, row]));
  const rows = source.map((item) => {
    const pedidos = r3(orderedBySku.get(item.sku) ?? 0);
    const objetivo = r3(item.inicial - pedidos);
    const actual = currentBySku.get(item.sku);
    return {
      ...item,
      pedidos,
      objetivo,
      actualDisponible: numberValue(actual?.cantidad_disponible as unknown as ExcelJS.CellValue),
      actualReservada: numberValue(actual?.cantidad_reservada as unknown as ExcelJS.CellValue),
      actualHold: numberValue(actual?.cantidad_transito as unknown as ExcelJS.CellValue),
    };
  });
  const totals = {
    pedidos: r3(rows.reduce((sum, row) => sum + row.pedidos, 0)),
    inicial: r3(rows.reduce((sum, row) => sum + row.inicial, 0)),
    objetivo: r3(rows.reduce((sum, row) => sum + row.objetivo, 0)),
    objetivoValuado: r2(rows.reduce((sum, row) => sum + Math.max(0, row.objetivo) * row.costo, 0)),
    actualDisponible: r3(rows.reduce((sum, row) => sum + row.actualDisponible, 0)),
    actualHold: r3(rows.reduce((sum, row) => sum + row.actualHold, 0)),
  };

  console.log(JSON.stringify({
    fuente: EXCEL_PATH,
    semana: 34,
    estadoSemana: week.estado,
    pedidos: orders.length,
    estadosPedidos: [...new Set(orders.map((order) => order.estado))],
    totales: totals,
    modo: APPLY ? 'APLICAR' : 'VISTA_PREVIA',
  }, null, 2));

  if (!APPLY) return;
  if (week.estado !== 'abierta') throw new Error(`La semana 34 no está abierta: ${week.estado}.`);

  const admin = await prisma.usuarios.findFirstOrThrow({
    where: { negocio_id: business.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' },
    select: { id: true },
  });

  const result = await transaccionSerializable(async (tx) => {
    const already = await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: business.id, clave: IMPORT_KEY } } });
    if (already) return { omitido: true, movimientos: 0 };

    const liveOrders = await tx.pedidos_operativos.findMany({
      where: {
        negocio_id: business.id, linea_operacion: 'desechables', fecha_entrega: { gte: START, lt: END },
        estado: { notIn: ['borrador', 'cancelado'] },
      },
      select: { id: true, estado: true, lineas: { select: { product_id: true, cantidad: true } } },
    });
    const liveOrderIds = new Set(liveOrders.map((order) => order.id.toString()));
    const previewOrderIds = new Set(orders.map((order) => order.id.toString()));
    if (liveOrderIds.size !== previewOrderIds.size || [...liveOrderIds].some((id) => !previewOrderIds.has(id))) {
      throw new Error('Cambió la lista de pedidos durante la conciliación; no se aplicaron ajustes.');
    }

    let movements = 0;
    for (const row of rows) {
      const product = productBySku.get(row.sku)!;
      const actual = await tx.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: product.id } } });
      const actualDisponible = numberValue(actual?.cantidad_disponible as unknown as ExcelJS.CellValue);
      const actualHold = numberValue(actual?.cantidad_transito as unknown as ExcelJS.CellValue);
      const deltaDisponible = r3(row.objetivo - actualDisponible);
      const deltaHold = r3(-actualHold);
      if (Math.abs(deltaDisponible) > 0.0001 || Math.abs(deltaHold) > 0.0001) {
        const cantidad = r3(Math.abs(deltaDisponible) + Math.abs(deltaHold));
        const tipo = deltaDisponible >= 0 ? 'ajuste_positivo' : 'ajuste_negativo';
        await aplicarMovimiento(tx, {
          negocioId: business.id,
          productId: product.id,
          tipo,
          cantidad,
          usuarioId: admin.id,
          destinoId: bodega.id,
          costoUnitario: row.costo,
          documentoTipo: 'reconciliacion_inventario_semana34',
          documentoId: week.id,
          comentario: `Excel semana 34: ${row.inicial} inicial - ${row.pedidos} pedidos confirmados = ${row.objetivo}; hold llevado a 0.`,
          idempotencyKey: `${IMPORT_KEY}:${product.id}`,
          deltas: [{ ubicacionId: bodega.id, productId: product.id, disponible: deltaDisponible, transito: deltaHold }],
          permitirDisponibleNegativo: true,
        });
        movements += 1;
      }
      await tx.existencias.update({
        where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: product.id } },
        data: { cantidad_reservada: 0, costo_promedio: row.costo, costo_transito_promedio: null },
      });
    }

    await tx.importaciones_sistema.create({ data: { negocio_id: business.id, clave: IMPORT_KEY } });
    await tx.auditoria_operativa.create({
      data: {
        negocio_id: business.id, usuario_id: admin.id, accion: 'reconciliar_inventario_desechables_semana_34',
        entidad: 'existencias', entidad_id: bodega.id,
        datos: { fuente: EXCEL_PATH, semana: 34, regla: 'inventario Excel menos pedidos confirmados', pedidos: liveOrders.length, ...totals, holdFinal: 0, movimientos: movements },
      },
    });
    return { omitido: false, movimientos: movements };
  }, { timeout: 120000, maxWait: 10000 });

  console.log('✅ Conciliación de desechables aplicada:', result);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
