import { PrismaClient, type Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';

const prisma = new PrismaClient();
const EXCEL_PATH = process.env.BPM_INVENTORY_XLSX;
const APPLY = process.env.APPLY_WEEK34_INVENTORY === '1';
const CATALOG_ONLY = process.env.APPLY_WEEK34_CATALOG_ONLY === '1';
const OPENING_ONLY = process.env.APPLY_WEEK34_OPENING_ONLY === '1';
const KEY = 'inventario-inicial-semana-34-inventarios-xlsx-v1';
const OPENING_KEY = 'inventario-inicial-semana-34-apertura-excel-v1';
const CATALOG_KEY = 'catalogo-desechables-semana-34-excel-v1';
const negocioNombre = 'Burrito Parrilla Mexicana';
const inicio = new Date('2026-08-16T00:00:00.000Z');
const fin = new Date('2026-08-22T00:00:00.000Z');
const initialInventoryColumn = 107; // DC: INITIAL INV. en Week (34)

type InventoryLine = {
  sku: string;
  nombre: string;
  linea: 'carne' | 'desechables';
  ubicacion: 'CARN' | 'BOD';
  cantidad: number;
  costoUnitario: number;
  costoTotal: number;
  precioVenta?: number;
  pesoLb?: number;
  esMateriaPrima?: boolean;
};

type ParsedWorkbook = {
  desechables: InventoryLine[];
  materiasPrimas: InventoryLine[];
  terminados: InventoryLine[];
};

const rawRows = [
  ['RAW-INSIDE-SKIRT', 6],
  ['RAW-CHICKEN', 10],
  ['RAW-PORK-BUTT', 14],
  ['RAW-OUTSIDE-SKIRT', 18],
  ['RAW-INSIDE-ROUND', 22],
  ['RAW-TAPATIOS-TACO', 26],
] as const;

const finishedRows = [
  ['MEAT-STEAK', 'STEAK TACO MEAT', 3],
  ['MEAT-CHICKEN', 'CHICKEN TACO MEAT', 5],
  ['MEAT-PASTOR-BPM', 'ALPASTOR TACO MEAT', 7],
  ['MEAT-ASADA', 'CARNE ASADA', 9],
  ['MEAT-FAJITAS', 'FAJITAS', 11],
  ['MEAT-MILANESA', 'MILANESA', 13],
  ['MEAT-TAMAL', 'TAMAL ROJO', 15],
  ['MEAT-CHILE', 'CHILE RELLENO', 17],
  ['MEAT-DORADO', 'TACO DORADO', 19],
  ['MEAT-CARNITAS', 'CARNITAS', 21],
  ['MEAT-TAPATIOS-TACO', 'TAPATIOS TACO MEAT', 23],
] as const;

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

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseWorkbook(workbook: ExcelJS.Workbook): ParsedWorkbook {
  const week = workbook.getWorksheet('Week (34)');
  const production = workbook.getWorksheet('Production (33)');
  if (!week) throw new Error('El Excel no contiene la hoja Week (34).');
  if (!production) throw new Error('El Excel no contiene la hoja Production (33).');
  if (textValue(week.getCell(1, initialInventoryColumn).value).toUpperCase() !== 'INITIAL INV.') {
    throw new Error('La columna DC de Week (34) no es INITIAL INV.; se cancela para no leer una columna equivocada.');
  }

  const skuByDisposableIndex = [
    ...Array.from({ length: 46 }, (_, i) => `BPM-${String(i + 1).padStart(4, '0')}`),
    'BPM-0053', 'BPM-0054', 'BPM-0050', 'BPM-0051', 'BPM-0052', 'BPM-0047', 'BPM-0048', 'BPM-0049',
  ];
  const desechables: InventoryLine[] = [];
  const nombres = new Set<string>();
  for (let row = 2; row <= 55; row += 1) {
    const nombre = textValue(week.getCell(row, 1).value);
    if (!nombre) throw new Error(`Falta el nombre del desechable en Week (34), fila ${row}.`);
    const nombreNormalizado = nombre.toUpperCase();
    if (nombres.has(nombreNormalizado)) throw new Error(`Producto desechable repetido en Week (34): ${nombre}.`);
    nombres.add(nombreNormalizado);
    const sku = skuByDisposableIndex[row - 2];
    if (!sku) throw new Error(`No hay SKU histórico para la fila ${row} de Week (34).`);
    const cantidad = numberValue(week.getCell(row, initialInventoryColumn).value);
    const costoUnitario = numberValue(week.getCell(row, 5).value); // E: COST
    const precioVenta = numberValue(week.getCell(row, 7).value); // G: SELLING PRICE
    desechables.push({
      sku, nombre, linea: 'desechables', ubicacion: 'BOD', cantidad,
      costoUnitario, costoTotal: rounded(cantidad * costoUnitario), precioVenta,
    });
  }

  const materiasPrimas: InventoryLine[] = rawRows.map(([sku, row]) => {
    const cantidad = numberValue(production.getCell(row, 13).value); // M: closing stock, full cases
    const pesoLb = numberValue(production.getCell(row, 15).value); // O: closing stock, weight
    const costoTotal = numberValue(production.getCell(row, 17).value); // Q: closing stock, cost
    return {
      sku, nombre: textValue(production.getCell(row, 1).value), linea: 'carne', ubicacion: 'CARN', cantidad,
      costoUnitario: cantidad > 0 ? costoTotal / cantidad : 0, costoTotal, pesoLb,
      esMateriaPrima: true,
    };
  });

  const terminados: InventoryLine[] = finishedRows.map(([sku, nombre, row]) => {
    const cantidad = numberValue(production.getCell(row, 38).value); // AL: closing week, left
    const costoTotal = numberValue(production.getCell(row, 39).value); // AM: closing week, inventory
    return {
      sku, nombre, linea: 'carne', ubicacion: 'CARN', cantidad,
      costoUnitario: cantidad > 0 ? costoTotal / cantidad : 0, costoTotal,
    };
  });

  return { desechables, materiasPrimas, terminados };
}

function printPreview(parsed: ParsedWorkbook) {
  const meat = [...parsed.materiasPrimas, ...parsed.terminados];
  console.log(`Fuente: ${EXCEL_PATH}`);
  console.log(`Semana 34: ${parsed.desechables.length} desechables, ${meat.length} renglones de carne.`);
  console.log(`Desechables: ${parsed.desechables.reduce((sum, item) => sum + item.cantidad, 0)} cajas iniciales.`);
  console.log(`Carne: ${parsed.materiasPrimas.reduce((sum, item) => sum + item.cantidad, 0)} cajas de materia prima y ${parsed.terminados.reduce((sum, item) => sum + item.cantidad, 0)} cajas terminadas.`);
  console.log(`Productos nuevos: ${parsed.desechables.filter((item) => ['BPM-0053', 'BPM-0054'].includes(item.sku)).map((item) => `${item.sku} ${item.nombre}`).join(' · ')}`);
}

async function syncDisposableCatalog(
  tx: Prisma.TransactionClient,
  negocioId: bigint,
  categoriaId: bigint,
  cajaId: bigint,
  items: InventoryLine[],
) {
  const productsNow = await tx.products.findMany({ where: { negocio_id: negocioId, activo: true } });
  for (const [order, item] of items.entries()) {
    const bySku = productsNow.find((product) => product.sku === item.sku);
    const byName = productsNow.find((product) => product.nombre.trim().toUpperCase() === item.nombre.trim().toUpperCase());
    if (bySku && byName && bySku.id !== byName.id) throw new Error(`SKU ${item.sku} y nombre ${item.nombre} pertenecen a productos distintos.`);
    const product = bySku ?? byName ?? await tx.products.create({
      data: {
        negocio_id: negocioId, nombre: item.nombre, sku: item.sku, categoria_id: categoriaId,
        unidad_distribucion_id: cajaId, unidad_compra_id: cajaId, unidad_almacen_id: cajaId,
        linea_operacion: 'desechables', tipo_operativo: 'desechable',
        costo_promedio: item.costoUnitario, ultimo_costo: item.costoUnitario,
        precio_venta_fijo: item.precioVenta ?? item.costoUnitario, orden_operativo: order + 1,
      },
    });
    const normalized = product.sku === item.sku ? product : await tx.products.update({
      where: { id: product.id }, data: { sku: item.sku, nombre: item.nombre, activo: true },
    });
    await tx.products.update({
      where: { id: normalized.id },
      data: {
        categoria_id: categoriaId, linea_operacion: 'desechables', tipo_operativo: 'desechable', orden_operativo: order + 1,
        costo_promedio: item.costoUnitario, ultimo_costo: item.costoUnitario, precio_venta_fijo: item.precioVenta,
      },
    });
  }
  return items.length;
}

async function main() {
  if (!EXCEL_PATH) throw new Error('Falta BPM_INVENTORY_XLSX con la ruta de Inventarios .xlsx.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const parsed = parseWorkbook(workbook);
  printPreview(parsed);
  if (!APPLY && !CATALOG_ONLY && !OPENING_ONLY) {
    console.log('Sin cambios. Usa APPLY_WEEK34_INVENTORY=1 para aplicar después de revisar la vista previa.');
    return;
  }

  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: negocioNombre } });
  const admin = await prisma.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' } });
  const [bodega, carniceria, caja, categoria] = await Promise.all([
    prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'BOD' } }),
    prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'CARN' } }),
    prisma.unidades.findFirstOrThrow({ where: { negocio_id: negocio.id, nombre: { equals: 'Caja', mode: 'insensitive' } } }),
    prisma.categorias.findFirstOrThrow({ where: { negocio_id: negocio.id, nombre: { equals: 'Desechables', mode: 'insensitive' } } }),
  ]);

  if (CATALOG_ONLY) {
    const result = await prisma.$transaction(async (tx) => {
      if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: CATALOG_KEY } } })) {
        return { omitido: true, productos: parsed.desechables.length };
      }
      const productos = await syncDisposableCatalog(tx, negocio.id, categoria.id, caja.id, parsed.desechables);
      await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: CATALOG_KEY } });
      await tx.auditoria_operativa.create({
        data: {
          negocio_id: negocio.id, usuario_id: admin.id, accion: 'sincronizar_catalogo_desechables_semana_34', entidad: 'products',
          datos: { fuente: EXCEL_PATH, productos, orden: 'Week (34) columna A', costos: 'Week (34) columna E', precios: 'Week (34) columna G' },
        },
      });
      return { omitido: false, productos };
    }, { timeout: 120000 });
    console.log('✅ Catálogo de desechables sincronizado:', result);
    return;
  }

  if (OPENING_ONLY) {
    const result = await prisma.$transaction(async (tx) => {
      if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: OPENING_KEY } } })) {
        return { omitido: true, semana: 34 };
      }

      const semana = await tx.semanas_operativas.upsert({
        where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 34 } },
        update: { inicia_at: inicio, termina_at: fin },
        create: { negocio_id: negocio.id, anio: 2026, semana: 34, inicia_at: inicio, termina_at: fin, estado: 'abierta' },
      });

      await syncDisposableCatalog(tx, negocio.id, categoria.id, caja.id, parsed.desechables);
      const products = await tx.products.findMany({ where: { negocio_id: negocio.id, activo: true, linea_operacion: { not: null } } });
      const sourceLines = [...parsed.materiasPrimas, ...parsed.terminados, ...parsed.desechables];
      const bySku = new Map(products.map((product) => [product.sku, product]));
      for (const item of sourceLines) if (!bySku.has(item.sku)) throw new Error(`Producto del Excel sin mapear: ${item.sku} (${item.nombre}).`);

      const openingNote = 'inventario_inicial_operativo:2026-08-16:semana34';
      const existingOpening = await tx.conteos.findMany({
        where: { negocio_id: negocio.id, fecha: inicio, ubicacion_id: { in: [bodega.id, carniceria.id] }, notas: openingNote },
        select: { ubicacion_id: true },
      });
      if (existingOpening.length > 0) throw new Error(`Ya existen ${existingOpening.length} conteos de apertura de semana 34; no se sobrescriben.`);

      const counts = [
        { locationId: carniceria.id, linea: 'carne' as const, items: parsed.materiasPrimas.concat(parsed.terminados) },
        { locationId: bodega.id, linea: 'desechables' as const, items: parsed.desechables },
      ];
      for (const { locationId, linea, items } of counts) {
        const count = await tx.conteos.create({
          data: {
            negocio_id: negocio.id, ubicacion_id: locationId, estado: 'cerrado', fecha: inicio,
            creado_por: admin.id, cerrado_por: admin.id, cerrado_at: new Date(), notas: openingNote,
          },
        });
        const itemBySku = new Map(items.map((item) => [item.sku, item]));
        const countProducts = products.filter((product) => product.linea_operacion === linea);
        await tx.conteo_lineas.createMany({
          data: countProducts.map((product) => ({
            conteo_id: count.id, product_id: product.id, unidad_id: product.unidad_distribucion_id,
            qty: itemBySku.get(product.sku)?.cantidad ?? 0, factor: 1, contado: true,
          })),
        });
      }

      await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: OPENING_KEY } });
      await tx.auditoria_operativa.create({
        data: {
          negocio_id: negocio.id, usuario_id: admin.id, accion: 'aplicar_apertura_inventario_semana_34', entidad: 'semana_operativa', entidad_id: semana.id,
          datos: {
            fuente: EXCEL_PATH, semana: 34, modo: 'conteo_apertura_sin_reiniciar_saldos',
            desechables: parsed.desechables.length, materias_primas: parsed.materiasPrimas.length, terminados: parsed.terminados.length,
          },
        },
      });
      return { semana: 34, conteos: 2, desechables: parsed.desechables.length, carne: parsed.materiasPrimas.length + parsed.terminados.length };
    }, { timeout: 120000 });
    console.log('✅ Apertura de inventario de semana 34 aplicada:', result);
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: KEY } } })) {
      return { omitido: true, semana: 34 };
    }

    const movimientosSemana = await tx.movimientos_inventario.count({
      where: { negocio_id: negocio.id, fecha: { gte: inicio, lt: fin } },
    });
    if (movimientosSemana > 0) throw new Error(`No se inicializó semana 34: ya existen ${movimientosSemana} movimientos de inventario en la semana.`);

    const conteosPrevios = await tx.conteos.count({
      where: { negocio_id: negocio.id, fecha: inicio, ubicacion_id: { in: [bodega.id, carniceria.id] } },
    });
    if (conteosPrevios > 0) throw new Error(`No se inicializó semana 34: ya existen ${conteosPrevios} conteos en CARN/BOD para el 16 de agosto.`);

    const semana = await tx.semanas_operativas.upsert({
      where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 34 } },
      update: { inicia_at: inicio, termina_at: fin },
      create: { negocio_id: negocio.id, anio: 2026, semana: 34, inicia_at: inicio, termina_at: fin, estado: 'abierta' },
    });

    const disposableProducts = await syncDisposableCatalog(tx, negocio.id, categoria.id, caja.id, parsed.desechables);

    const products = await tx.products.findMany({ where: { negocio_id: negocio.id, activo: true, linea_operacion: { not: null } } });
    const bySku = new Map(products.map((product) => [product.sku, product]));
    const sourceLines = [...parsed.materiasPrimas, ...parsed.terminados, ...parsed.desechables];
    for (const item of sourceLines) if (!bySku.has(item.sku)) throw new Error(`Producto del Excel sin mapear: ${item.sku} (${item.nombre}).`);

    const previous = await tx.existencias.findMany({ where: { negocio_id: negocio.id, ubicacion_id: { in: [bodega.id, carniceria.id] } } });
    const previousCost = new Map(previous.map((row) => [row.product_id.toString(), Number(row.costo_promedio ?? 0)]));
    await tx.existencias.updateMany({ where: { negocio_id: negocio.id, ubicacion_id: { in: [bodega.id, carniceria.id] } }, data: { cantidad_disponible: 0, cantidad_reservada: 0, cantidad_transito: 0, costo_transito_promedio: null } });
    await tx.lotes_materia_prima.updateMany({ where: { negocio_id: negocio.id, ubicacion_id: { in: [bodega.id, carniceria.id] } }, data: { cajas_disponibles: 0, peso_disponible_lb: 0, costo_disponible: 0 } });

    const sourceBySku = new Map(sourceLines.map((item) => [item.sku, item]));
    for (const product of products) {
      const item = sourceBySku.get(product.sku);
      const locationId = product.linea_operacion === 'desechables' ? bodega.id : carniceria.id;
      const quantity = item?.cantidad ?? 0;
      const unitCost = item && item.costoUnitario > 0 ? item.costoUnitario : Number(product.ultimo_costo ?? product.costo_promedio ?? previousCost.get(product.id.toString()) ?? 0);
      await tx.existencias.upsert({
        where: { ubicacion_id_product_id: { ubicacion_id: locationId, product_id: product.id } },
        create: { negocio_id: negocio.id, ubicacion_id: locationId, product_id: product.id, cantidad_disponible: quantity, costo_promedio: unitCost || null },
        update: { cantidad_disponible: quantity, cantidad_reservada: 0, cantidad_transito: 0, costo_promedio: unitCost || null, costo_transito_promedio: null },
      });
      if (!item || quantity <= 0) continue;
      await tx.movimientos_inventario.create({
        data: {
          negocio_id: negocio.id, product_id: product.id, ubicacion_destino_id: locationId,
          tipo: 'conteo_inicial', cantidad: quantity, costo_unitario: unitCost, costo_total: rounded(quantity * unitCost),
          usuario_id: admin.id, fecha: inicio, documento_tipo: 'inventario_inicial_semana', documento_id: semana.id,
          comentario: 'Inventario inicial semana 34 importado de Inventarios .xlsx',
          idempotency_key: `inventario-semana-34:${locationId}:${product.id}`,
        },
      });
      const isRaw = item.esMateriaPrima === true;
      const isDisposable = item.linea === 'desechables';
      if (isRaw || isDisposable) {
        const totalCost = isRaw ? item.costoTotal : rounded(quantity * unitCost);
        await tx.lotes_materia_prima.create({
          data: {
            negocio_id: negocio.id, ubicacion_id: locationId, product_id: product.id, fecha: inicio,
            congelado: false, cajas_iniciales: quantity, cajas_disponibles: quantity,
            peso_inicial_lb: isRaw ? (item.pesoLb ?? 0) : 0, peso_disponible_lb: isRaw ? (item.pesoLb ?? 0) : 0,
            costo_inicial: totalCost, costo_disponible: totalCost,
          },
        });
      }
    }

    for (const [location, linea, items] of [[carniceria, 'carne', parsed.materiasPrimas.concat(parsed.terminados)], [bodega, 'desechables', parsed.desechables]] as const) {
      const count = await tx.conteos.create({
        data: { negocio_id: negocio.id, ubicacion_id: location.id, estado: 'cerrado', fecha: inicio, creado_por: admin.id, cerrado_por: admin.id, cerrado_at: new Date(), notas: `inventario_inicial_operativo:2026-08-16:semana34` },
      });
      const itemBySku = new Map(items.map((item) => [item.sku, item]));
      const countProducts = products.filter((product) => product.linea_operacion === linea);
      await tx.conteo_lineas.createMany({
        data: countProducts.map((product) => ({
          conteo_id: count.id, product_id: product.id, unidad_id: product.unidad_distribucion_id,
          qty: itemBySku.get(product.sku)?.cantidad ?? 0, factor: 1, contado: true,
        })),
      });
    }

    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: KEY } });
    await tx.auditoria_operativa.create({
      data: {
        negocio_id: negocio.id, usuario_id: admin.id, accion: 'inicializar_inventario_semana_34', entidad: 'semana_operativa', entidad_id: semana.id,
        datos: { fuente: EXCEL_PATH, semana: 34, desechables: parsed.desechables.length, materias_primas: parsed.materiasPrimas.length, terminados: parsed.terminados.length },
      },
    });
    return { semana: 34, movimientos: sourceLines.filter((item) => item.cantidad > 0).length, desechables: disposableProducts };
  }, { timeout: 120000 });

  console.log('✅ Inventario inicial de semana 34 aplicado:', result);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
