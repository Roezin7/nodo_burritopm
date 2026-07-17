import { PrismaClient, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import path from 'node:path';

const prisma = new PrismaClient();
const EXCEL_DIR = process.env.BPM_EXCEL_DIR ?? '/Users/arturohernandez/Downloads/burritopmgroup';
const APPLY = process.env.APPLY_EXCEL_IMPORT === '1';
const date = (v: Date | string) => new Date(`${v instanceof Date ? v.toISOString().slice(0, 10) : v.slice(0, 10)}T00:00:00.000Z`);
const iso = (v: Date) => v.toISOString().slice(0, 10);
function n(v: ExcelJS.CellValue): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v && typeof v === 'object' && 'result' in v) return n(v.result as ExcelJS.CellValue);
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function text(v: ExcelJS.CellValue): string {
  if (v && typeof v === 'object' && 'result' in v) return text(v.result as ExcelJS.CellValue);
  return String(v ?? '').trim();
}

const ubicacionPorEncabezado: Record<string, string> = {
  LOMBARD: 'LOMBA', NAPERVILLE: 'NAPER', 'CAROL STREAM': 'CAROL', LISLE: 'LISLE', 'GLENDALE HEIGHTS': 'GLEND',
  'WEST CHICAGO': 'WESTC', BATAVIA: 'BATAV', ALGONQUIN: 'ALGON', 'NAPERVILLE TWO': 'NAPER2',
  'ROLLING MEADOWS': 'ROLLI', SCHAUMBURG: 'SCHAU', 'CRYSTAL LAKE': 'CRYST', 'LAKE ZURICH': 'LAKEZ',
  FRANKFORT: 'FRANK', PLAINFIELD: 'PLAIN', 'TAQUERIA AURORA': 'AUROR', 'TAQUERIA BURLINGTON': 'BURLI',
  'TAPATIOS GLEN ELLYN': 'TGE', 'TAPATIOS STREAMWOOD': 'TST', 'TAPATIOS LOMBARD': 'TLO', 'TAPATIOS NAPERVILLE': 'TNA',
};
const productoCarne: Record<string, string> = {
  'STEAK TACO': 'MEAT-STEAK', CHICKEN: 'MEAT-CHICKEN', ALPASTOR: 'MEAT-PASTOR-BPM',
  'CARNE ASADA': 'MEAT-ASADA', FAJITAS: 'MEAT-FAJITAS', MILANESA: 'MEAT-MILANESA',
  'TAMAL ROJO': 'MEAT-TAMAL', 'CHILE RELLENO': 'MEAT-CHILE', 'TACO DORADO': 'MEAT-DORADO',
  'ADOBO PICADILLO': 'MEAT-ADOBO', CARNITAS: 'MEAT-CARNITAS', CATERING: 'MEAT-CATERING',
  'TAPATIOS TACO M': 'MEAT-TAPATIOS-TACO',
};
const bpmDesechables = ['LOMBA', 'NAPER', 'CAROL', 'LISLE', 'GLEND', 'WESTC', 'BATAV', 'ALGON', 'NAPER2', 'ROLLI', 'SCHAU', 'CRYST', 'LAKEZ', 'PLAIN', 'FRANK'];
const lbtDesechables = ['TGE', 'TLO', 'TST', 'TNA'];
const semanas = [
  { numero: 27, carne: 'Meat Order 27', desechables: 'Week (27)', lunes: '2026-06-29', miercoles: '2026-07-01', sabado: '2026-07-04', cerrada: true },
  { numero: 28, carne: 'Meat Order (28)', desechables: 'Week (28)', lunes: '2026-07-06', miercoles: '2026-07-08', sabado: '2026-07-11', cerrada: true },
  { numero: 29, carne: 'Meat Order 29', desechables: 'Week (29)', lunes: '2026-07-13', miercoles: '2026-07-15', sabado: '2026-07-18', cerrada: false },
];

interface LineaImportada { productId: bigint; cantidad: number; precio: Prisma.Decimal | null }
interface PedidoImportado { ubicacionId: bigint; empresaId: bigint; linea: 'carne' | 'desechables'; entrega: Date; lineas: LineaImportada[]; semana: number; cerrada: boolean }

function precioImportado(p: { precio_venta_fijo: Prisma.Decimal | null; ultimo_costo: Prisma.Decimal | null; costo_promedio: Prisma.Decimal | null; tipo_operativo: string | null; markup_caja: Prisma.Decimal }) {
  if (p.precio_venta_fijo != null) return p.precio_venta_fijo;
  const costo = p.ultimo_costo ?? p.costo_promedio;
  if (costo == null) return null;
  return new Prisma.Decimal(costo).plus(p.tipo_operativo === 'proteina' ? p.markup_caja : 0);
}

async function main() {
  const org = await prisma.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  const admin = await prisma.usuarios.findFirstOrThrow({ where: { negocio_id: org.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' } });
  const ubicaciones = await prisma.ubicaciones.findMany({ where: { negocio_id: org.id, empresa_cliente_id: { not: null } } });
  const porCodigo = new Map(ubicaciones.map((u) => [u.codigo, u]));
  const productos = await prisma.products.findMany({ where: { negocio_id: org.id, linea_operacion: { not: null } } });
  const porSku = new Map(productos.map((p) => [p.sku, p]));
  const porNombre = new Map(productos.map((p) => [p.nombre.trim().toUpperCase(), p]));

  const meatBook = new ExcelJS.Workbook();
  await meatBook.xlsx.readFile(path.join(EXCEL_DIR, '1. Weekly Order 2026 3Q.xlsx'));
  const dispBook = new ExcelJS.Workbook();
  await dispBook.xlsx.readFile(path.join(EXCEL_DIR, '2. Disposables 2026 3Q.xlsx'));
  const pedidos: PedidoImportado[] = [];

  for (const sem of semanas) {
    const ws = meatBook.getWorksheet(sem.carne);
    if (!ws) throw new Error(`No existe ${sem.carne}`);
    const bloques = [...Array.from({ length: 17 }, (_, i) => 1 + i * 10), 171, 181, 191, 201];
    for (const inicio of bloques) {
      const encabezado = text(ws.getCell(7, inicio).value).toUpperCase();
      const codigo = ubicacionPorEncabezado[encabezado];
      if (!codigo) continue;
      const ubic = porCodigo.get(codigo);
      if (!ubic?.empresa_cliente_id) throw new Error(`Falta empresa/ubicación ${codigo}`);
      const esTapatios = inicio >= 171;
      const entregas = esTapatios ? [[inicio + 1, sem.lunes], [inicio + 4, iso(new Date(date(sem.lunes).getTime() + 3 * 86400000))], [inicio + 7, sem.sabado]] as const : [[inicio + 1, sem.miercoles], [inicio + 7, sem.sabado]] as const;
      for (const [col, entrega] of entregas) {
        const lineas: LineaImportada[] = [];
        for (let row = 11; row <= 29; row += 1) {
          const nombre = text(ws.getCell(row, inicio).value).toUpperCase();
          let sku = productoCarne[nombre];
          if (esTapatios && nombre === 'ALPASTOR') sku = 'MEAT-PASTOR-TAP';
          const cantidad = n(ws.getCell(row, col).value);
          if (!sku || cantidad <= 0) continue;
          const p = porSku.get(sku);
          if (!p) throw new Error(`Falta producto ${sku}`);
          lineas.push({ productId: p.id, cantidad, precio: precioImportado(p) });
        }
        if (lineas.length) pedidos.push({ ubicacionId: ubic.id, empresaId: ubic.empresa_cliente_id, linea: 'carne', entrega: date(entrega), lineas, semana: sem.numero, cerrada: sem.cerrada });
      }
    }

    const dw = dispBook.getWorksheet(sem.desechables);
    if (!dw) throw new Error(`No existe ${sem.desechables}`);
    const columnas = [...bpmDesechables.map((codigo, i) => ({ codigo, col: 9 + i * 2 })), ...lbtDesechables.map((codigo, i) => ({ codigo, col: 41 + i * 2 }))];
    for (const { codigo, col } of columnas) {
      const ubic = porCodigo.get(codigo);
      if (!ubic?.empresa_cliente_id) continue;
      const lineas: LineaImportada[] = [];
      for (let row = 2; row <= 53; row += 1) {
        const nombre = text(dw.getCell(row, 1).value).toUpperCase();
        const cantidad = n(dw.getCell(row, col).value);
        const p = porNombre.get(nombre);
        if (p && cantidad > 0) lineas.push({ productId: p.id, cantidad, precio: new Prisma.Decimal(n(dw.getCell(row, 7).value)) });
      }
      if (lineas.length) pedidos.push({ ubicacionId: ubic.id, empresaId: ubic.empresa_cliente_id, linea: 'desechables', entrega: date(sem.miercoles), lineas, semana: sem.numero, cerrada: sem.cerrada });
    }
  }

  console.log(`Vista previa Excel 3Q: ${pedidos.length} pedidos, ${pedidos.reduce((a, p) => a + p.lineas.length, 0)} renglones.`);
  for (const sem of semanas) console.log(`  Semana ${sem.numero}: ${pedidos.filter((p) => p.semana === sem.numero).length} pedidos (${sem.cerrada ? 'histórica cerrada' : 'actual abierta'}).`);
  if (!APPLY) {
    console.log('Sin cambios. Ejecuta con APPLY_EXCEL_IMPORT=1 después de revisar esta vista previa.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const sem of semanas) {
      await tx.semanas_operativas.upsert({
        where: { negocio_id_anio_semana: { negocio_id: org.id, anio: 2026, semana: sem.numero } },
        update: { inicia_at: date(sem.lunes), termina_at: date(sem.sabado), estado: sem.cerrada ? 'cerrada' : 'abierta', cerrado_por: sem.cerrada ? admin.id : null, cerrado_at: sem.cerrada ? date(sem.sabado) : null },
        create: { negocio_id: org.id, anio: 2026, semana: sem.numero, inicia_at: date(sem.lunes), termina_at: date(sem.sabado), estado: sem.cerrada ? 'cerrada' : 'abierta', cerrado_por: sem.cerrada ? admin.id : null, cerrado_at: sem.cerrada ? date(sem.sabado) : null },
      });
    }
    for (const p of pedidos) {
      const pedido = await tx.pedidos_operativos.upsert({
        where: { ubicacion_id_linea_operacion_fecha_entrega: { ubicacion_id: p.ubicacionId, linea_operacion: p.linea, fecha_entrega: p.entrega } },
        update: { empresa_cliente_id: p.empresaId, estado: p.cerrada ? 'cerrado' : 'confirmado', notas: `Importado Excel semana ${p.semana}` },
        create: { negocio_id: org.id, empresa_cliente_id: p.empresaId, ubicacion_id: p.ubicacionId, linea_operacion: p.linea, fecha_entrega: p.entrega, estado: p.cerrada ? 'cerrado' : 'confirmado', capturado_por: admin.id, confirmado_at: p.entrega, notas: `Importado Excel semana ${p.semana}` },
      });
      await tx.pedido_operativo_lineas.deleteMany({ where: { pedido_id: pedido.id } });
      await tx.pedido_operativo_lineas.createMany({ data: p.lineas.map((l) => ({ pedido_id: pedido.id, product_id: l.productId, cantidad: l.cantidad, precio_unitario: l.precio })) });
    }
  });
  await importarInventarioInicial(org.id, admin.id, porSku, porNombre);
  await importarSaldosPendientes(org.id);
  console.log('✅ Semanas 27 y 28 históricas, semana 29 abierta e inventario inicial de semana 28 importados.');
}

async function importarSaldosPendientes(negocioId: bigint) {
  const billing = new ExcelJS.Workbook();
  await billing.xlsx.readFile(path.join(EXCEL_DIR, '4. Billing 2026 3Q.xlsx'));
  const bpm = await prisma.empresas_clientes.findFirstOrThrow({ where: { negocio_id: negocioId, codigo: 'BPM' } });
  const ubicaciones = new Map((await prisma.ubicaciones.findMany({ where: { negocio_id: negocioId } })).map((u) => [u.codigo, u]));
  const columnas = [['LOMBA', 5], ['NAPER', 8], ['CAROL', 11], ['LISLE', 14], ['GLEND', 17], ['WESTC', 20], ['BATAV', 23], ['ALGON', 26], ['NAPER2', 29], ['ROLLI', 32], ['SCHAU', 35]] as const;
  for (const sem of semanas.filter((s) => s.cerrada)) {
    const ws = billing.getWorksheet(`Billing (${sem.numero})`)!;
    const semana = await prisma.semanas_operativas.findFirstOrThrow({ where: { negocio_id: negocioId, anio: 2026, semana: sem.numero } });
    for (const [codigo, col] of columnas) {
      const ubic = ubicaciones.get(codigo)!;
      const importes = { carne: n(ws.getCell(20, col).value) + n(ws.getCell(21, col).value), desechables: n(ws.getCell(22, col).value) } as const;
      for (const linea of ['carne', 'desechables'] as const) {
        const total = Math.round(importes[linea] * 100) / 100;
        if (total <= 0) continue;
        await upsertSaldo({ negocioId, semanaId: semana.id, empresaId: bpm.id, ubicacionId: ubic.id, linea, numero: `2026-${sem.numero}-BPM-${codigo}-${linea === 'carne' ? 'M' : 'D'}-OPEN`, emitida: date(sem.sabado), vence: new Date(date(sem.sabado).getTime() + 14 * 86400000), total, descripcion: `Saldo pendiente importado de Billing semana ${sem.numero}` });
      }
    }
  }

  // Payments de Aurora: saldo acumulado real hasta la semana 28, sin recrear el historial de pagos.
  const auroraBook = new ExcelJS.Workbook();
  await auroraBook.xlsx.readFile(path.join(EXCEL_DIR, '6. Taqueria Aurora 2026 3Q.xlsx'));
  const payments = auroraBook.getWorksheet('Payments')!;
  const empresaAurora = await prisma.empresas_clientes.findFirstOrThrow({ where: { negocio_id: negocioId, codigo: 'AUR' } });
  const semana28 = await prisma.semanas_operativas.findFirstOrThrow({ where: { negocio_id: negocioId, anio: 2026, semana: 28 } });
  for (const [codigo, facturaCol, pagoCol] of [['AUROR', 9, 10], ['BURLI', 18, 19]] as const) {
    let saldo = 0;
    for (let row = 3; row <= 30; row += 1) saldo += n(payments.getCell(row, facturaCol).value) + n(payments.getCell(row, pagoCol).value);
    saldo = Math.round(Math.max(0, saldo) * 100) / 100;
    if (!saldo) continue;
    const ubic = ubicaciones.get(codigo)!;
    await upsertSaldo({ negocioId, semanaId: semana28.id, empresaId: empresaAurora.id, ubicacionId: ubic.id, linea: 'carne', numero: `2026-28-AUR-${codigo}-M-OPEN`, emitida: date('2026-07-11'), vence: date('2026-07-18'), total: saldo, descripcion: 'Saldo pendiente acumulado importado de Payments al cierre de semana 28' });
  }
}

async function upsertSaldo(input: { negocioId: bigint; semanaId: bigint; empresaId: bigint; ubicacionId: bigint; linea: 'carne' | 'desechables'; numero: string; emitida: Date; vence: Date; total: number; descripcion: string }) {
  const existente = await prisma.facturas.findUnique({ where: { negocio_id_numero_version: { negocio_id: input.negocioId, numero: input.numero, version: 1 } } });
  const factura = existente
    ? await prisma.facturas.update({ where: { id: existente.id }, data: { semana_id: input.semanaId, empresa_cliente_id: input.empresaId, ubicacion_id: input.ubicacionId, linea_operacion: input.linea, emitida_at: input.emitida, vence_at: input.vence, estado: 'emitida', subtotal: input.total, total: input.total } })
    : await prisma.facturas.create({ data: { negocio_id: input.negocioId, semana_id: input.semanaId, empresa_cliente_id: input.empresaId, ubicacion_id: input.ubicacionId, linea_operacion: input.linea, numero: input.numero, emitida_at: input.emitida, vence_at: input.vence, estado: 'emitida', subtotal: input.total, total: input.total } });
  await prisma.factura_lineas.deleteMany({ where: { factura_id: factura.id } });
  await prisma.factura_lineas.create({ data: { factura_id: factura.id, descripcion: input.descripcion, cantidad: 1, precio_unitario: input.total, importe: input.total } });
}

async function importarInventarioInicial(negocioId: bigint, adminId: bigint, porSku: Map<string, Awaited<ReturnType<typeof prisma.products.findFirstOrThrow>>>, porNombre: Map<string, Awaited<ReturnType<typeof prisma.products.findFirstOrThrow>>>) {
  const adison = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocioId, codigo: 'BOD' } });
  const carniceria = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocioId, codigo: 'CARN' } });
  const dispBook = new ExcelJS.Workbook();
  await dispBook.xlsx.readFile(path.join(EXCEL_DIR, '2. Disposables 2026 3Q.xlsx'));
  const dw = dispBook.getWorksheet('Week (28)')!;
  for (let row = 2; row <= 53; row += 1) {
    const p = porNombre.get(text(dw.getCell(row, 1).value).toUpperCase());
    if (!p) continue;
    const cajas = n(dw.getCell(row, 115).value);
    // La columna 117 es el valor total del inventario (cajas × costo); existencias
    // necesita costo unitario para no volver a multiplicarlo en dashboard/billing.
    const costo = n(dw.getCell(row, 5).value);
    await prisma.existencias.upsert({ where: { ubicacion_id_product_id: { ubicacion_id: adison.id, product_id: p.id } }, update: { cantidad_disponible: cajas, cantidad_reservada: 0, cantidad_transito: 0, costo_promedio: costo }, create: { negocio_id: negocioId, ubicacion_id: adison.id, product_id: p.id, cantidad_disponible: cajas, costo_promedio: costo } });
  }
  const raw = [
    ['RAW-INSIDE-SKIRT', 25, 1873, 15134.5], ['RAW-CHICKEN', 0, 0, 0], ['RAW-PORK-BUTT', 0, 0, 0],
    ['RAW-OUTSIDE-SKIRT', 26, 1691.43, 16423.784], ['RAW-INSIDE-ROUND', 20, 1451, 6993.82], ['RAW-TAPATIOS-TACO', 9, 531, 2918.07],
  ] as const;
  for (const [sku, cajas, peso, costo] of raw) {
    const p = porSku.get(sku); if (!p) throw new Error(`Falta ${sku}`);
    await prisma.existencias.upsert({ where: { ubicacion_id_product_id: { ubicacion_id: carniceria.id, product_id: p.id } }, update: { cantidad_disponible: cajas, cantidad_reservada: 0, cantidad_transito: 0, costo_promedio: cajas ? costo / cajas : null }, create: { negocio_id: negocioId, ubicacion_id: carniceria.id, product_id: p.id, cantidad_disponible: cajas, costo_promedio: cajas ? costo / cajas : null } });
    if (cajas > 0) {
      const existe = await prisma.lotes_materia_prima.findFirst({ where: { negocio_id: negocioId, ubicacion_id: carniceria.id, product_id: p.id, fecha: date('2026-07-11'), compra_linea_id: null } });
      if (!existe) await prisma.lotes_materia_prima.create({ data: { negocio_id: negocioId, ubicacion_id: carniceria.id, product_id: p.id, fecha: date('2026-07-11'), cajas_iniciales: cajas, cajas_disponibles: cajas, peso_inicial_lb: peso, peso_disponible_lb: peso, costo_inicial: costo, costo_disponible: costo } });
    }
  }
  const terminados = [['MEAT-PASTOR-BPM', 22, 1307.2167], ['MEAT-MILANESA', 8, 1138], ['MEAT-CHILE', 8, 696], ['MEAT-DORADO', 39, 3393]] as const;
  for (const [sku, cajas, costo] of terminados) {
    const p = porSku.get(sku); if (!p) throw new Error(`Falta ${sku}`);
    await prisma.existencias.upsert({ where: { ubicacion_id_product_id: { ubicacion_id: carniceria.id, product_id: p.id } }, update: { cantidad_disponible: cajas, cantidad_reservada: 0, cantidad_transito: 0, costo_promedio: costo / cajas }, create: { negocio_id: negocioId, ubicacion_id: carniceria.id, product_id: p.id, cantidad_disponible: cajas, costo_promedio: costo / cajas } });
  }
  void adminId;
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
