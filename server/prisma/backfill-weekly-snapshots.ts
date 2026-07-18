import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const EXCEL_DIR = process.env.BPM_EXCEL_DIR ?? fileURLToPath(new URL('./data/3q', import.meta.url));
const CLAVE = 'inventario-semanal-excel-3q-v1';

function numero(valor: ExcelJS.CellValue) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (valor && typeof valor === 'object' && 'result' in valor) return numero(valor.result as ExcelJS.CellValue);
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function texto(valor: ExcelJS.CellValue) {
  if (valor && typeof valor === 'object' && 'result' in valor) return texto(valor.result as ExcelJS.CellValue);
  return String(valor ?? '').trim().toUpperCase();
}

const raw: Record<string, number> = {
  'RAW-INSIDE-SKIRT': 6,
  'RAW-CHICKEN': 10,
  'RAW-PORK-BUTT': 14,
  'RAW-OUTSIDE-SKIRT': 18,
  'RAW-INSIDE-ROUND': 22,
  'RAW-TAPATIOS-TACO': 26,
};

const terminado: Record<string, number> = {
  'MEAT-STEAK': 3,
  'MEAT-CHICKEN': 5,
  'MEAT-PASTOR-BPM': 7,
  'MEAT-ASADA': 9,
  'MEAT-FAJITAS': 11,
  'MEAT-MILANESA': 13,
  'MEAT-TAMAL': 15,
  'MEAT-CHILE': 17,
  'MEAT-DORADO': 19,
  'MEAT-CARNITAS': 21,
  'MEAT-TAPATIOS-TACO': 23,
};

async function main() {
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  if (await prisma.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: CLAVE } } })) {
    console.log(`✅ Fotografías históricas ${CLAVE} ya aplicadas.`);
    return;
  }
  const [bodega, carniceria, productos] = await Promise.all([
    prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'BOD' } }),
    prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'CARN' } }),
    prisma.products.findMany({ where: { negocio_id: negocio.id, activo: true, linea_operacion: { not: null } } }),
  ]);
  const porSku = new Map(productos.map((p) => [p.sku, p]));
  const porNombre = new Map(productos.map((p) => [p.nombre.trim().toUpperCase(), p]));
  const desechables = new ExcelJS.Workbook();
  const produccion = new ExcelJS.Workbook();
  await Promise.all([
    desechables.xlsx.readFile(path.join(EXCEL_DIR, '2. Disposables 2026 3Q.xlsx')),
    produccion.xlsx.readFile(path.join(EXCEL_DIR, '3. Production 2026 3Q.xlsx')),
  ]);

  for (const numeroSemana of [27, 28]) {
    const semana = await prisma.semanas_operativas.findFirst({ where: { negocio_id: negocio.id, anio: 2026, semana: numeroSemana, estado: 'cerrada' } });
    if (!semana) continue;
    const filas = new Map<string, { ubicacion_id: bigint; product_id: bigint; disponible: number; transito: number; costo: number | null }>();
    for (const producto of productos) {
      filas.set(producto.id.toString(), {
        ubicacion_id: producto.linea_operacion === 'carne' ? carniceria.id : bodega.id,
        product_id: producto.id, disponible: 0, transito: 0, costo: null,
      });
    }

    const dw = desechables.getWorksheet(`Week (${numeroSemana})`);
    if (!dw) throw new Error(`Falta Week (${numeroSemana}) en Disposables`);
    for (let row = 2; row <= 53; row += 1) {
      const producto = porNombre.get(texto(dw.getCell(row, 1).value));
      if (!producto) continue;
      const disponible = numero(dw.getCell(row, 115).value); // DK: final físico
      const transito = numero(dw.getCell(row, 123).value); // DS: hold
      const valor = numero(dw.getCell(row, 117).value) + numero(dw.getCell(row, 129).value); // DM + DY
      const unidades = disponible + transito;
      filas.set(producto.id.toString(), {
        ubicacion_id: bodega.id, product_id: producto.id, disponible, transito,
        costo: unidades > 0 ? valor / unidades : numero(dw.getCell(row, 5).value) || null,
      });
    }

    const pw = produccion.getWorksheet(`Production (${numeroSemana})`);
    if (!pw) throw new Error(`Falta Production (${numeroSemana}) en Production`);
    for (const [sku, row] of Object.entries(raw)) {
      const producto = porSku.get(sku); if (!producto) continue;
      const disponible = numero(pw.getCell(row, 13).value); // M: full cases
      const valor = numero(pw.getCell(row, 17).value); // Q: closing cost
      filas.set(producto.id.toString(), { ubicacion_id: carniceria.id, product_id: producto.id, disponible, transito: 0, costo: disponible > 0 ? valor / disponible : null });
    }
    for (const [sku, row] of Object.entries(terminado)) {
      const producto = porSku.get(sku); if (!producto) continue;
      const disponible = numero(pw.getCell(row, 38).value); // AL: left
      const valor = numero(pw.getCell(row, 39).value); // AM: inventory value
      filas.set(producto.id.toString(), { ubicacion_id: carniceria.id, product_id: producto.id, disponible, transito: 0, costo: disponible > 0 ? valor / disponible : null });
    }

    await prisma.$transaction(async (tx) => {
      await tx.inventario_semanal.deleteMany({ where: { semana_id: semana.id } });
      await tx.inventario_semanal.createMany({
        data: [...filas.values()].map((f) => ({
          semana_id: semana.id, negocio_id: negocio.id, ubicacion_id: f.ubicacion_id, product_id: f.product_id,
          cantidad_disponible: f.disponible, cantidad_reservada: 0, cantidad_transito: f.transito, costo_promedio: f.costo,
        })),
      });
    });
    console.log(`  Semana ${numeroSemana}: ${filas.size} renglones históricos congelados.`);
  }

  await prisma.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: CLAVE } });
  console.log('✅ Fotografías de inventario de semanas 27 y 28 importadas desde los libros originales.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
