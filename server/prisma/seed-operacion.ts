import { PrismaClient, type LineaOperacion } from '@prisma/client';
import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const prisma = new PrismaClient();
const EXCEL_DIR = process.env.BPM_EXCEL_DIR ?? '/Users/arturohernandez/Downloads/burritopmgroup';

const bpmActivas = ['LOMBA', 'LISLE', 'NAPER2', 'NAPER', 'BATAV', 'WESTC', 'CAROL', 'GLEND', 'SCHAU', 'ROLLI', 'ALGON'];
const nuevas = [
  ['Crystal Lake', 'CRYST', false], ['Lake Zurich', 'LAKEZ', false], ['Frankfort', 'FRANK', false], ['Plainfield', 'PLAIN', false],
  ['Taquería Aurora', 'AUROR', true], ['Burlington', 'BURLI', true],
  ['Tapatíos Glen Ellyn', 'TGE', true], ['Tapatíos Lombard', 'TLO', true], ['Tapatíos Streamwood', 'TST', true],
  ['Tapatíos Naperville', 'TNA', true], ['Tapatíos Bolingbrook', 'TBO', true],
] as const;

const carne = [
  // Materia prima: el peso se ajusta automáticamente al promedio ponderado de compras reales.
  { nombre: 'Inside Skirt Steak', sku: 'RAW-INSIDE-SKIRT', tipo: 'materia_prima' as const, peso: 74.92, markup: 0, dias: [] },
  { nombre: 'Chicken Breast', sku: 'RAW-CHICKEN', tipo: 'materia_prima' as const, peso: 40, markup: 0, dias: [] },
  { nombre: 'Pork Butt', sku: 'RAW-PORK-BUTT', tipo: 'materia_prima' as const, peso: 83.394, markup: 0, dias: [] },
  { nombre: 'Outside Skirt', sku: 'RAW-OUTSIDE-SKIRT', tipo: 'materia_prima' as const, peso: 65.055, markup: 0, dias: [] },
  { nombre: 'Inside Round', sku: 'RAW-INSIDE-ROUND', tipo: 'materia_prima' as const, peso: 72.55, markup: 0, dias: [] },
  { nombre: 'Tapatíos Taco Meat Raw', sku: 'RAW-TAPATIOS-TACO', tipo: 'materia_prima' as const, peso: 59.167, markup: 0, dias: [] },
  // Pesos de salida configurables. Steak/Carne/Fajitas siguen los pesos confirmados por el usuario.
  { nombre: 'Steak Taco', sku: 'MEAT-STEAK', tipo: 'proteina' as const, peso: 20, markup: 15, dias: [2, 5] },
  { nombre: 'Chicken', sku: 'MEAT-CHICKEN', tipo: 'proteina' as const, peso: 40, markup: 15, dias: [3, 6] },
  { nombre: 'Al Pastor BPM', sku: 'MEAT-PASTOR-BPM', tipo: 'proteina' as const, peso: 20, markup: 15, dias: [1, 4] },
  { nombre: 'Al Pastor Tapatíos', sku: 'MEAT-PASTOR-TAP', tipo: 'proteina' as const, peso: 20, markup: 15, dias: [1, 4] },
  { nombre: 'Tapatíos Taco Meat', sku: 'MEAT-TAPATIOS-TACO', tipo: 'proteina' as const, peso: 20, markup: 15, dias: [1, 4] },
  { nombre: 'Carne Asada', sku: 'MEAT-ASADA', tipo: 'proteina' as const, peso: 10, markup: 15, dias: [2, 5] },
  { nombre: 'Fajitas', sku: 'MEAT-FAJITAS', tipo: 'proteina' as const, peso: 10, markup: 15, dias: [2, 5] },
  { nombre: 'Milanesa', sku: 'MEAT-MILANESA', tipo: 'proteina' as const, peso: 20, markup: 15, dias: [] },
  { nombre: 'Tamal Rojo', sku: 'MEAT-TAMAL', tipo: 'precio_fijo' as const, peso: null, markup: 0, precio: 91, dias: [] },
  { nombre: 'Chile Relleno', sku: 'MEAT-CHILE', tipo: 'precio_fijo' as const, peso: null, markup: 0, precio: 91, dias: [] },
  { nombre: 'Taco Dorado', sku: 'MEAT-DORADO', tipo: 'precio_fijo' as const, peso: null, markup: 0, precio: 91, dias: [] },
  { nombre: 'Adobo Picadillo', sku: 'MEAT-ADOBO', tipo: 'precio_fijo' as const, peso: null, markup: 0, precio: 1, dias: [] },
  { nombre: 'Carnitas', sku: 'MEAT-CARNITAS', tipo: 'precio_fijo' as const, peso: null, markup: 0, precio: 10, dias: [] },
  { nombre: 'Pulpa', sku: 'MEAT-PULPA', tipo: 'precio_fijo' as const, peso: null, markup: 0, precio: 90, dias: [] },
  { nombre: 'Catering', sku: 'MEAT-CATERING', tipo: 'servicio' as const, peso: null, markup: 0, precio: null, dias: [] },
];

const rutas: { codigo: string; nombre: string; linea: LineaOperacion; dia: number; conductor: string; paradas: string[]; opcionales?: string[] }[] = [
  { codigo: 'CAR-SUR-MIE', nombre: 'Carne Sur · miércoles', linea: 'carne', dia: 3, conductor: 'Pablo', paradas: ['LOMBA', 'LISLE', 'NAPER2', 'NAPER', 'AUROR', 'BATAV', 'WESTC', 'CAROL'] },
  { codigo: 'CAR-NOR-MIE', nombre: 'Carne Norte · miércoles', linea: 'carne', dia: 3, conductor: 'MH', paradas: ['GLEND', 'SCHAU', 'ROLLI', 'ALGON'] },
  { codigo: 'CAR-SUR-SAB', nombre: 'Carne Sur · sábado', linea: 'carne', dia: 6, conductor: 'Pablo', paradas: ['LOMBA', 'LISLE', 'NAPER2', 'NAPER', 'AUROR', 'BATAV', 'WESTC', 'CAROL'] },
  { codigo: 'CAR-NOR-SAB', nombre: 'Carne Norte · sábado', linea: 'carne', dia: 6, conductor: 'MH', paradas: ['GLEND', 'SCHAU', 'ROLLI', 'ALGON', 'TST'] },
  { codigo: 'TAP-LUN', nombre: 'Tapatíos · lunes', linea: 'carne', dia: 1, conductor: 'Pablo', paradas: ['TGE', 'TLO', 'TST'] },
  { codigo: 'TAP-JUE', nombre: 'Tapatíos · jueves', linea: 'carne', dia: 4, conductor: 'Pablo', paradas: ['TGE', 'TLO', 'TST'] },
  { codigo: 'DES-NOR-MIE', nombre: 'Desechables Norte · miércoles', linea: 'desechables', dia: 3, conductor: 'MH', paradas: ['SCHAU', 'ROLLI'] },
  { codigo: 'DES-SUR-MIE', nombre: 'Desechables Sur · miércoles', linea: 'desechables', dia: 3, conductor: 'Pablo', paradas: ['LOMBA', 'LISLE', 'NAPER2', 'NAPER', 'AUROR', 'BATAV', 'WESTC', 'CAROL', 'GLEND', 'ALGON', 'TNA'] },
];

async function seedDesechables(negocioId: bigint) {
  const archivo = path.join(EXCEL_DIR, '2. Disposables 2026 3Q.xlsx');
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(archivo);
  const hoja = libro.getWorksheet('Week (28)');
  if (!hoja) throw new Error(`No existe Week (28) en ${archivo}`);
  for (let fila = 2; fila <= 53; fila += 1) {
    const nombre = String(hoja.getCell(fila, 1).value ?? '').trim();
    if (!nombre) continue;
    const costo = Number(hoja.getCell(fila, 5).value ?? 0);
    const venta = Number(hoja.getCell(fila, 7).value ?? 0);
    const producto = await prisma.products.findFirst({ where: { negocio_id: negocioId, nombre: { equals: nombre, mode: 'insensitive' } } });
    if (!producto) throw new Error(`El catálogo actual no contiene el desechable: ${nombre}`);
    await prisma.products.update({ where: { id: producto.id }, data: { linea_operacion: 'desechables', tipo_operativo: 'desechable', costo_promedio: costo, ultimo_costo: costo, precio_venta_fijo: venta, markup_caja: 0 } });
  }
}

async function main() {
  const org = await prisma.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  await prisma.negocios.update({ where: { id: org.id }, data: { inventario_dias: [3] } });
  const caja = await prisma.unidades.upsert({ where: { negocio_id_nombre: { negocio_id: org.id, nombre: 'Caja' } }, update: {}, create: { negocio_id: org.id, nombre: 'Caja' } });
  const catCarne = await prisma.categorias.upsert({ where: { negocio_id_nombre: { negocio_id: org.id, nombre: 'Carnicería' } }, update: {}, create: { negocio_id: org.id, nombre: 'Carnicería', orden: 0 } });

  const empresas = {
    BPM: await prisma.empresas_clientes.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'BPM' } }, update: { nombre: 'Burrito Parrilla Mexicana', dias_credito_carne: 14, dias_credito_desechables: 14 }, create: { negocio_id: org.id, codigo: 'BPM', nombre: 'Burrito Parrilla Mexicana', tipo: 'interna', dias_credito_carne: 14, dias_credito_desechables: 14 } }),
    AUR: await prisma.empresas_clientes.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'AUR' } }, update: { nombre: 'Taquería Aurora', dias_credito_carne: 7, dias_credito_desechables: 7 }, create: { negocio_id: org.id, codigo: 'AUR', nombre: 'Taquería Aurora', tipo: 'externa', dias_credito_carne: 7, dias_credito_desechables: 7 } }),
    LBT: await prisma.empresas_clientes.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'LBT' } }, update: { nombre: 'Los Burritos Tapatíos', dias_credito_carne: 0, dias_credito_desechables: 0 }, create: { negocio_id: org.id, codigo: 'LBT', nombre: 'Los Burritos Tapatíos', tipo: 'externa', dias_credito_carne: 0, dias_credito_desechables: 0 } }),
  };
  await prisma.ubicaciones.updateMany({ where: { negocio_id: org.id, codigo: { in: bpmActivas } }, data: { empresa_cliente_id: empresas.BPM.id } });
  for (const [nombre, codigo, activo] of nuevas) {
    const empresa = codigo.startsWith('T') ? empresas.LBT.id : ['AUROR', 'BURLI'].includes(codigo) ? empresas.AUR.id : empresas.BPM.id;
    await prisma.ubicaciones.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo } }, update: { nombre, activo, empresa_cliente_id: empresa }, create: { negocio_id: org.id, nombre, codigo, tipo: 'sucursal', activo, empresa_cliente_id: empresa } });
  }
  const aurora = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: org.id, codigo: 'AUROR' } });
  await prisma.ubicaciones.update({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'BURLI' } }, data: { entrega_en_ubicacion_id: aurora.id } });
  const carniceria = await prisma.ubicaciones.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'CARN' } }, update: { nombre: 'Carnicería', activo: true }, create: { negocio_id: org.id, nombre: 'Carnicería', codigo: 'CARN', tipo: 'bodega' } });

  await seedDesechables(org.id);
  for (const p of carne) {
    const data = { nombre: p.nombre, categoria_id: catCarne.id, unidad_distribucion_id: caja.id, unidad_compra_id: caja.id, unidad_almacen_id: caja.id, linea_operacion: 'carne' as const, tipo_operativo: p.tipo, requiere_refrigeracion: p.tipo !== 'servicio', peso_caja_lb: p.peso, markup_caja: p.markup, precio_venta_fijo: 'precio' in p ? p.precio : null, produccion_dias: p.dias };
    await prisma.products.upsert({ where: { negocio_id_sku: { negocio_id: org.id, sku: p.sku } }, update: data, create: { negocio_id: org.id, sku: p.sku, ...data } });
  }
  for (const nombre of ['Christ Panos', 'Gordon', 'Sysco', 'Amigos', 'Super Clean', 'BRD']) {
    await prisma.proveedores.upsert({ where: { negocio_id_nombre: { negocio_id: org.id, nombre } }, update: { activo: true }, create: { negocio_id: org.id, nombre } });
  }
  const ubicaciones = new Map((await prisma.ubicaciones.findMany({ where: { negocio_id: org.id } })).map((u) => [u.codigo, u]));
  for (const r of rutas) {
    const plantilla = await prisma.plantillas_ruta.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: r.codigo } }, update: { nombre: r.nombre, linea_operacion: r.linea, dia_semana: r.dia, conductor: r.conductor, activo: true }, create: { negocio_id: org.id, nombre: r.nombre, codigo: r.codigo, linea_operacion: r.linea, dia_semana: r.dia, conductor: r.conductor } });
    await prisma.plantilla_ruta_paradas.deleteMany({ where: { plantilla_id: plantilla.id } });
    await prisma.plantilla_ruta_paradas.createMany({ data: r.paradas.map((codigo, i) => { const u = ubicaciones.get(codigo); if (!u) throw new Error(`Falta ubicación ${codigo}`); return { plantilla_id: plantilla.id, ubicacion_id: u.id, orden: i + 1, opcional: r.opcionales?.includes(codigo) ?? false }; }) });
  }

  let reparto = await prisma.usuarios.findFirst({ where: { negocio_id: org.id, rol: 'encargado_bodega', activo: true }, orderBy: { id: 'asc' } });
  if (!reparto) reparto = await prisma.usuarios.create({ data: { negocio_id: org.id, nombre: 'Bodega y reparto', rol: 'encargado_bodega', pin_hash: await bcrypt.hash(process.env.SEED_REPARTO_PIN ?? '4321', 10) } });
  const adison = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: org.id, codigo: 'BOD' } });
  for (const ubicacion_id of [adison.id, carniceria.id]) await prisma.usuario_ubicaciones.upsert({ where: { usuario_id_ubicacion_id: { usuario_id: reparto.id, ubicacion_id } }, update: {}, create: { usuario_id: reparto.id, ubicacion_id } });
  console.log('✅ Operación 3Q preparada: empresas, ubicaciones, productos, proveedores y 8 rutas.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
