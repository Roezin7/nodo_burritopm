import { Prisma, PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const KEY = 'excel-3q-2026-meat-supplies-v5';
const APPLY = process.env.APPLY_EXCEL_IMPORT === '1';
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', '3q');
const productosPorFila: Record<number, string> = {
  23: 'BPM-0019', 24: 'BPM-0047', 25: 'BPM-0048', 26: 'BPM-0049', 27: 'BPM-0020', 28: 'BPM-0029',
};
const ubicacionPorEncabezado: Record<string, string> = {
  'TAPATIOS GLEN ELLYN': 'TGE', 'TAPATIOS STREAMWOOD': 'TST', 'TAPATIOS LOMBARD': 'TLO', 'TAPATIOS NAPERVILLE': 'TNA',
};
const semanas = [
  { hoja: 'Meat Order 27', lunes: '2026-06-29' },
  { hoja: 'Meat Order (28)', lunes: '2026-07-06' },
  { hoja: 'Meat Order 29', lunes: '2026-07-13' },
];
const starts = [171, 181, 191, 201];
const texto = (v: ExcelJS.CellValue) => String(v ?? '').trim().toUpperCase();
const numero = (v: ExcelJS.CellValue) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const sumar = (iso: string, dias: number) => new Date(fecha(iso).getTime() + dias * 86400000);

async function main() {
  if (!APPLY) return console.log('Backfill v5 en vista previa; usa APPLY_EXCEL_IMPORT=1 para aplicarlo.');
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  const aplicada = await prisma.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: KEY } } });
  if (aplicada) return console.log(`✅ ${KEY} ya aplicado.`);

  const [ubicaciones, productos] = await Promise.all([
    prisma.ubicaciones.findMany({ where: { negocio_id: negocio.id } }),
    prisma.products.findMany({ where: { negocio_id: negocio.id, sku: { in: Object.values(productosPorFila) } } }),
  ]);
  const porCodigo = new Map(ubicaciones.map((u) => [u.codigo, u]));
  const porSku = new Map(productos.map((p) => [p.sku, p]));
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(path.join(DIR, '1. Weekly Order 2026 3Q.xlsx'));
  let renglones = 0;

  await prisma.$transaction(async (tx) => {
    for (const semana of semanas) {
      const hoja = libro.getWorksheet(semana.hoja);
      if (!hoja) throw new Error(`No existe ${semana.hoja}`);
      for (const inicio of starts) {
        const ubicacion = porCodigo.get(ubicacionPorEncabezado[texto(hoja.getCell(7, inicio).value)]);
        if (!ubicacion) continue;
        const entregas = [[inicio + 1, sumar(semana.lunes, 0)], [inicio + 4, sumar(semana.lunes, 3)], [inicio + 7, sumar(semana.lunes, 5)]] as const;
        for (const [columna, entrega] of entregas) {
          const pedido = await tx.pedidos_operativos.findUnique({
            where: { ubicacion_id_linea_operacion_fecha_entrega: { ubicacion_id: ubicacion.id, linea_operacion: 'carne', fecha_entrega: entrega } },
          });
          if (!pedido) continue;
          for (const [filaTexto, sku] of Object.entries(productosPorFila)) {
            const cantidad = numero(hoja.getCell(Number(filaTexto), columna).value);
            if (cantidad <= 0) continue;
            const producto = porSku.get(sku);
            if (!producto) throw new Error(`Falta ${sku}`);
            const costo = producto.ultimo_costo ?? producto.costo_promedio;
            const precio = producto.precio_venta_fijo ?? (costo == null ? null : new Prisma.Decimal(costo).plus(producto.tipo_operativo === 'proteina' ? producto.markup_caja : 0));
            await tx.pedido_operativo_lineas.upsert({
              where: { pedido_id_product_id: { pedido_id: pedido.id, product_id: producto.id } },
              update: { cantidad, precio_unitario: precio },
              create: { pedido_id: pedido.id, product_id: producto.id, cantidad, precio_unitario: precio },
            });
            renglones += 1;
          }
        }
      }
    }
    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: KEY } });
  });
  console.log(`✅ Backfill v5: ${renglones} renglones de insumos agregados a las órdenes de carne.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
