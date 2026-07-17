import { PrismaClient, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const prisma = new PrismaClient();
const EXCEL_DIR = process.env.BPM_EXCEL_DIR ?? fileURLToPath(new URL('./data/3q', import.meta.url));
const APPLY = process.env.APPLY_EXCEL_IMPORT === '1';
const ONLY_ONCE = process.env.IMPORT_EXCEL_ONCE === '1';
const PREVIOUS_IMPORT_KEY = 'excel-3q-2026-semana-28-v2';
const IMPORT_KEY = 'excel-3q-2026-semana-28-v3';
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
  if (APPLY && ONLY_ONCE) {
    const aplicada = await prisma.importaciones_sistema.findUnique({
      where: { negocio_id_clave: { negocio_id: org.id, clave: IMPORT_KEY } },
    });
    if (aplicada) {
      console.log(`✅ Importación ${IMPORT_KEY} ya aplicada; no se restablecieron datos.`);
      return;
    }
    const anterior = await prisma.importaciones_sistema.findUnique({
      where: { negocio_id_clave: { negocio_id: org.id, clave: PREVIOUS_IMPORT_KEY } },
    });
    if (anterior) {
      await actualizarCierresHistoricos(org.id);
      await prisma.importaciones_sistema.create({ data: { negocio_id: org.id, clave: IMPORT_KEY } });
      console.log('✅ Totales históricos de Billing 27 y 28 agregados sin restablecer pedidos ni inventario.');
      return;
    }
  }
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
  await importarSaldosPendientes(org.id, admin.id);
  await actualizarCierresHistoricos(org.id);
  await prisma.importaciones_sistema.upsert({
    where: { negocio_id_clave: { negocio_id: org.id, clave: IMPORT_KEY } },
    update: { aplicado_at: new Date() },
    create: { negocio_id: org.id, clave: IMPORT_KEY },
  });
  console.log('✅ Semanas 27 y 28, semana 29, inventarios, cuentas por cobrar y cuentas por pagar importados.');
}

async function actualizarCierresHistoricos(negocioId: bigint) {
  const cierres = [
    { semana: 27, carne: 98497.43817380186, congelado: 12633.68, desechables: 254984.265, cobrar: 299119.495, pagar: 86680.69, balance: 578554.1881738019 },
    { semana: 28, carne: 48004.39071532847, congelado: 0, desechables: 264694.885, cobrar: 284923.305, pagar: 36648.38, balance: 560974.2007153285 },
  ];
  for (const c of cierres) {
    await prisma.semanas_operativas.updateMany({
      where: { negocio_id: negocioId, anio: 2026, semana: c.semana },
      data: { valor_carne: c.carne, valor_congelado: c.congelado, valor_desechables: c.desechables, cuentas_por_cobrar: c.cobrar, cuentas_por_pagar: c.pagar, balance_neto: c.balance },
    });
  }
}

const codigoFacturacion: Record<string, string> = {
  LOMBARD: 'LOMBA', 'NAPERVILLE I': 'NAPER', 'CAROL STREAM': 'CAROL', LISLE: 'LISLE', 'GLENDALE H.': 'GLEND',
  'WEST CHICAGO': 'WESTC', BATAVIA: 'BATAV', ALGONQUIN: 'ALGON', 'NAPERVILLE II': 'NAPER2', 'RO-ME': 'ROLLI',
  SCHAUMBURG: 'SCHAU', 'CRYSTAL LAKE': 'CRYST', 'LAKE ZURICH': 'LAKEZ', FRANKFORT: 'FRANK', PLAINFIELD: 'PLAIN',
  'TAQ. AURORA': 'AUROR', 'TAQ. AURORA #2': 'BURLI', 'LBT GLEN ELLYN': 'TGE', 'LBT STREAMWOOD': 'TST',
  'LBT LOMBARD': 'TLO', 'LBT NAPERVILLE': 'TNA',
};

async function importarSaldosPendientes(negocioId: bigint, adminId: bigint) {
  const billing = new ExcelJS.Workbook();
  await billing.xlsx.readFile(path.join(EXCEL_DIR, '4. Billing 2026 3Q.xlsx'));
  const bpm = await prisma.empresas_clientes.findFirstOrThrow({ where: { negocio_id: negocioId, codigo: 'BPM' } });
  const ubicaciones = new Map((await prisma.ubicaciones.findMany({ where: { negocio_id: negocioId } })).map((u) => [u.codigo, u]));

  // Borra únicamente las facturas provisionales de una versión anterior del importador.
  // Las facturas creadas o modificadas por el admin quedan fuera de este patrón.
  const provisionales = await prisma.facturas.findMany({ where: { negocio_id: negocioId, numero: { endsWith: '-OPEN' } }, select: { id: true } });
  if (provisionales.length) await prisma.facturas.deleteMany({ where: { id: { in: provisionales.map((f) => f.id) } } });

  for (const sem of semanas.filter((s) => s.cerrada)) {
    const ws = billing.getWorksheet(`Billing (${sem.numero})`)!;
    const semana = await prisma.semanas_operativas.findFirstOrThrow({ where: { negocio_id: negocioId, anio: 2026, semana: sem.numero } });
    for (let col = 5; col <= 71; col += 3) {
      const encabezado = text(ws.getCell(2, col).value).toUpperCase();
      const codigo = codigoFacturacion[encabezado];
      if (!codigo) continue; // Proyectos todavía en construcción, sin venta.
      const ubic = ubicaciones.get(codigo);
      if (!ubic?.empresa_cliente_id) throw new Error(`Falta empresa/ubicación de facturación ${codigo}`);
      const importes = {
        carne: n(ws.getCell(20, col).value) + n(ws.getCell(21, col).value),
        desechables: n(ws.getCell(22, col).value),
      } as const;
      for (const linea of ['carne', 'desechables'] as const) {
        const total = Math.round(importes[linea] * 100) / 100;
        if (total <= 0) continue;
        const empresa = await prisma.empresas_clientes.findUniqueOrThrow({ where: { id: ubic.empresa_cliente_id } });
        const diasCredito = linea === 'carne' ? empresa.dias_credito_carne : empresa.dias_credito_desechables;
        await upsertSaldo({ negocioId, semanaId: semana.id, empresaId: empresa.id, ubicacionId: ubic.id, linea, numero: `2026-${sem.numero}-${empresa.codigo}-${codigo}-${linea === 'carne' ? 'M' : 'D'}-OPEN`, emitida: date(sem.sabado), vence: new Date(date(sem.sabado).getTime() + diasCredito * 86400000), total, descripcion: `Saldo pendiente importado de Billing semana ${sem.numero}` });
      }
    }
  }

  // El archivo 3Q comienza en semana 27, pero el cierre de semana 28 arrastra Billing 26.
  const semana26 = await prisma.semanas_operativas.upsert({
    where: { negocio_id_anio_semana: { negocio_id: negocioId, anio: 2026, semana: 26 } },
    update: {},
    create: { negocio_id: negocioId, anio: 2026, semana: 26, inicia_at: date('2026-06-22'), termina_at: date('2026-06-27'), estado: 'cerrada', cerrado_por: adminId, cerrado_at: date('2026-06-27') },
  });
  const lombard = ubicaciones.get('LOMBA')!;
  const saldo26 = n(billing.getWorksheet('Billing (28)')!.getCell('BW6').value);
  await upsertSaldo({ negocioId, semanaId: semana26.id, empresaId: bpm.id, ubicacionId: lombard.id, linea: 'carne', numero: '2026-26-BPM-SALDO-OPEN', emitida: date('2026-06-27'), vence: date('2026-07-11'), total: saldo26, descripcion: 'Saldo anterior Billing 26 arrastrado por el archivo 3Q' });

  await importarCuentasPorPagar(negocioId, adminId, billing.getWorksheet('Billing (28)')!);
}

async function importarCuentasPorPagar(negocioId: bigint, adminId: bigint, ws: ExcelJS.Worksheet) {
  const carniceria = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocioId, codigo: 'CARN' } });
  const proveedorPorExcel: Record<string, string> = {
    'CHRIST PANOS FOOD': 'Christ Panos', 'GORDON FOOD': 'Gordon', SYSCO: 'Sysco',
    'SUPER CLEAN': 'Super Clean', 'AMIGOS FOOD': 'Amigos', 'BRD DISTRIBUTORS': 'BRD',
  };
  for (let row = 12; row <= 16; row += 1) {
    const nombre = text(ws.getCell(row, 77).value); // BY
    const total = Math.round(Math.abs(n(ws.getCell(row, 75).value)) * 100) / 100; // BW
    if (!nombre || total <= 0) continue;
    const nombreProveedor = proveedorPorExcel[nombre.toUpperCase()] ?? nombre;
    const proveedor = await prisma.proveedores.findFirst({ where: { negocio_id: negocioId, nombre: { equals: nombreProveedor, mode: 'insensitive' } } });
    if (!proveedor) throw new Error(`Falta proveedor para cuenta por pagar: ${nombre}`);
    const referencia = `IMPORT-3Q-W28-${proveedor.id}`;
    const existente = await prisma.compras.findFirst({ where: { negocio_id: negocioId, referencia } });
    const data = { proveedor_id: proveedor.id, ubicacion_id: carniceria.id, fecha: date('2026-07-11'), vence_at: date('2026-07-11'), referencia, total, estado: 'pendiente' as const, registrado_por: adminId };
    if (existente) await prisma.compras.update({ where: { id: existente.id }, data });
    else await prisma.compras.create({ data: { negocio_id: negocioId, ...data } });
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
    const cajas = n(dw.getCell(row, 115).value); // DK: inventario final físico
    const valorFisico = n(dw.getCell(row, 117).value); // DM
    const cajasEnReserva = n(dw.getCell(row, 123).value); // DS: reserva anticipada en hold
    const valorReserva = n(dw.getCell(row, 129).value); // DY
    const unidadesTotales = cajas + cajasEnReserva;
    const costo = unidadesTotales > 0 ? (valorFisico + valorReserva) / unidadesTotales : n(dw.getCell(row, 5).value);
    await prisma.existencias.upsert({ where: { ubicacion_id_product_id: { ubicacion_id: adison.id, product_id: p.id } }, update: { cantidad_disponible: cajas, cantidad_reservada: 0, cantidad_transito: cajasEnReserva, costo_promedio: costo }, create: { negocio_id: negocioId, ubicacion_id: adison.id, product_id: p.id, cantidad_disponible: cajas, cantidad_transito: cajasEnReserva, costo_promedio: costo } });
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
