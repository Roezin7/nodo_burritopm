import { PrismaClient, type LineaOperacion } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Snapshot de Week (28). Vive en código para que el bootstrap de Coolify no dependa
// de archivos del equipo de desarrollo. Solo llena campos todavía no configurados.
const desechables = [
  ['SABERT BASE THREE COMP', 54, 62.1], ['SABERT LIDS THREE COMP', 36.93, 42.47], ['DINNER NAPKIN', 29.95, 35.94],
  ['TORTA - 8X6 32oz', 23, 27.6], ['CLEAR CUP 24oz', 38.95, 46.74], ['CLEAR CUP 12oz', 44.95, 53.94],
  ['LIDS 16oz 24oz', 18.25, 21.9], ['CUP HOLDER', 29.95, 35.94], ['STRAWS WRAPPED BLACK', 22.95, 27.54],
  ['PORTION CUP 1.5oz', 21.99, 26.39], ['PORTION LID 2oz', 18.745, 22.49], ['KIT FORK & KNIFE HVY', 27.5, 33],
  ['FORK HD PLASTIC', 11.07, 13.28], ['SPOON PLASTIC', 13.03, 15.64], ['T-SHIRT BAG', 18.95, 22.74],
  ['2oz PORTION CUP', 22.95, 27.54], ['XL NITRILE GLOVES', 33.95, 40.74], ['MD VINYL GLOVES', 15.85, 19.02],
  ['FOIL STD 12X1000', 21.95, 26.34], ['THERMAL PAPER ROLL 3 1/8"', 33.5, 40.2], ['DELI CONTAINER 32OZ CLEAR', 35.71, 42.85],
  ['WAX PAPER 10X10', 77.2, 96.5], ['BAGS #8 CRAFT PAPER', 13.8, 16.56], ['SOAP 4-1', 27.99, 33.59],
  ['OVEN & GRILL 4-1', 32.99, 39.59], ['BAGS TRASH', 23.05, 27.66], ['EVAPORATED MILK', 26.11, 31.33],
  ['CONDENSED MILK', 42.24, 50.69], ['COCO LOPEZ', 75.69, 90.83], ['GARLIC SALT', 5, 6], ['BLUE TAPE', 30, 36],
  ['MARKERS', 5, 6], ['CLEAR TAPE', 5, 6], ['TRAPOS AMARILLOS', 5, 6], ['ARBOL BLEND', 25, 30],
  ['RED SAUCE BLEND', 25, 30], ['GREEN SAUCE BLEND', 25, 30], ['HABANERO BLEND', 25, 30], ['MOLE BLEND', 25, 30],
  ['RANCHERO BLEND', 25, 30], ['POBLANO BLEND', 25, 30], ['CARNITAS BLEND', 25, 30], ['RICE BLEND', 35, 42],
  ['MANGO', 21.5, 25.8], ['CUCUMBER LEMON', 21.5, 25.8], ['JAMAICA', 21.5, 25.8],
  ['TAPATIOS THREE COMPARTMENT', 29.07, 34.88], ['TAPATIOS ONE COMPARTMENT', 29.07, 34.88],
  ['TAPATIOS SUIZO', 23.55, 28.26], ['FRIED ICE CREAM', 27.55, 33.06], ['CUPS 12 BLACK', 20.46, 24.55], ['RICE FLOUR', 20, 24],
] as const;

const bpmActivas = ['LOMBA', 'LISLE', 'NAPER2', 'NAPER', 'BATAV', 'WESTC', 'CAROL', 'GLEND', 'SCHAU', 'ROLLI', 'ALGON'];
const ubicacionesBpm = [
  ['Lombard', 'LOMBA'], ['Lisle', 'LISLE'], ['Naperville II', 'NAPER2'], ['Naperville', 'NAPER'],
  ['Batavia', 'BATAV'], ['West Chicago', 'WESTC'], ['Carol Stream', 'CAROL'], ['Glendale Heights', 'GLEND'],
  ['Schaumburg', 'SCHAU'], ['Rolling Meadows', 'ROLLI'], ['Algonquin', 'ALGON'],
] as const;
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
  // Cajas terminadas: 20 lb; únicamente Carne Asada y Fajitas usan caja de 10 lb.
  { nombre: 'Steak Taco', sku: 'MEAT-STEAK', tipo: 'proteina' as const, peso: 20, costo: 205.8387, markup: 15, dias: [2, 5] },
  { nombre: 'Chicken', sku: 'MEAT-CHICKEN', tipo: 'proteina' as const, peso: 20, costo: 37.213, markup: 15, dias: [3, 6] },
  { nombre: 'Al Pastor BPM', sku: 'MEAT-PASTOR-BPM', tipo: 'proteina' as const, peso: 20, costo: 59.4189, markup: 15, dias: [1, 4] },
  { nombre: 'Al Pastor Tapatíos', sku: 'MEAT-PASTOR-TAP', tipo: 'proteina' as const, peso: 20, costo: 59.4189, markup: 15, dias: [1, 4] },
  { nombre: 'Tapatíos Taco Meat', sku: 'MEAT-TAPATIOS-TACO', tipo: 'proteina' as const, peso: 20, costo: 129.6953, markup: 15, dias: [1, 4] },
  { nombre: 'Carne Asada', sku: 'MEAT-ASADA', tipo: 'proteina' as const, peso: 10, costo: 197.5758, markup: 15, dias: [2, 5] },
  { nombre: 'Fajitas', sku: 'MEAT-FAJITAS', tipo: 'proteina' as const, peso: 10, costo: 197.5758, markup: 15, dias: [2, 5] },
  { nombre: 'Milanesa', sku: 'MEAT-MILANESA', tipo: 'proteina' as const, peso: 20, costo: 142.25, markup: 15, dias: [] },
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
  { codigo: 'DES-SUR-MIE', nombre: 'Desechables Sur · miércoles', linea: 'desechables', dia: 3, conductor: 'Pablo', paradas: ['LOMBA', 'LISLE', 'NAPER2', 'NAPER', 'AUROR', 'BATAV', 'WESTC', 'CAROL', 'GLEND', 'ALGON', 'TGE', 'TST', 'TLO', 'TNA'] },
];

async function seedDesechables(negocioId: bigint, categoriaId: bigint, cajaId: bigint) {
  for (const [indice, [nombre, costo, venta]] of desechables.entries()) {
    const sku = `BPM-${String(indice + 1).padStart(4, '0')}`;
    const producto = await prisma.products.findFirst({
      where: { negocio_id: negocioId, OR: [{ nombre: { equals: nombre, mode: 'insensitive' } }, { sku }] },
    }) ?? await prisma.products.create({
      data: {
        negocio_id: negocioId, nombre, sku, categoria_id: categoriaId,
        unidad_distribucion_id: cajaId, unidad_compra_id: cajaId, unidad_almacen_id: cajaId,
        linea_operacion: 'desechables', tipo_operativo: 'desechable',
        costo_promedio: costo, ultimo_costo: costo, precio_venta_fijo: venta, orden_operativo: indice + 1,
      },
    });
    await prisma.products.update({
      where: { id: producto.id },
      data: {
        categoria_id: producto.categoria_id ?? categoriaId,
        linea_operacion: producto.linea_operacion ?? 'desechables', tipo_operativo: producto.tipo_operativo ?? 'desechable',
        costo_promedio: producto.costo_promedio ?? costo, ultimo_costo: producto.ultimo_costo ?? costo,
        precio_venta_fijo: producto.precio_venta_fijo ?? venta,
        // 999 significa "sin ordenar". Una vez que el admin define una posición,
        // el bootstrap no vuelve a imponer el orden del archivo inicial.
        orden_operativo: producto.orden_operativo === 999 ? indice + 1 : producto.orden_operativo,
      },
    });
  }
}

async function main() {
  const org = await prisma.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  if (!org.inventario_dias.length) await prisma.negocios.update({ where: { id: org.id }, data: { inventario_dias: [3] } });
  const caja = await prisma.unidades.upsert({ where: { negocio_id_nombre: { negocio_id: org.id, nombre: 'Caja' } }, update: {}, create: { negocio_id: org.id, nombre: 'Caja' } });
  const pieza = await prisma.unidades.upsert({ where: { negocio_id_nombre: { negocio_id: org.id, nombre: 'Pieza' } }, update: {}, create: { negocio_id: org.id, nombre: 'Pieza' } });
  const catCarne = await prisma.categorias.upsert({ where: { negocio_id_nombre: { negocio_id: org.id, nombre: 'Carnicería' } }, update: {}, create: { negocio_id: org.id, nombre: 'Carnicería', orden: 0 } });
  const catDesechables = await prisma.categorias.upsert({ where: { negocio_id_nombre: { negocio_id: org.id, nombre: 'Desechables' } }, update: {}, create: { negocio_id: org.id, nombre: 'Desechables', orden: 1 } });

  const empresas = {
    BPM: await prisma.empresas_clientes.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'BPM' } }, update: {}, create: { negocio_id: org.id, codigo: 'BPM', nombre: 'Burrito Parrilla Mexicana', tipo: 'interna', dias_credito_carne: 14, dias_credito_desechables: 14 } }),
    AUR: await prisma.empresas_clientes.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'AUR' } }, update: {}, create: { negocio_id: org.id, codigo: 'AUR', nombre: 'Taquería Aurora', tipo: 'externa', dias_credito_carne: 7, dias_credito_desechables: 7 } }),
    LBT: await prisma.empresas_clientes.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'LBT' } }, update: {}, create: { negocio_id: org.id, codigo: 'LBT', nombre: 'Los Burritos Tapatíos', tipo: 'externa', dias_credito_carne: 0, dias_credito_desechables: 0 } }),
  };
  for (const [nombre, codigo] of ubicacionesBpm) {
    await prisma.ubicaciones.upsert({
      where: { negocio_id_codigo: { negocio_id: org.id, codigo } },
      update: {},
      create: { negocio_id: org.id, nombre, codigo, tipo: 'sucursal', empresa_cliente_id: empresas.BPM.id },
    });
  }
  await prisma.ubicaciones.upsert({
    where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'BOD' } },
    update: {},
    create: { negocio_id: org.id, nombre: 'Bodega Adison', codigo: 'BOD', tipo: 'bodega' },
  });
  await prisma.ubicaciones.updateMany({ where: { negocio_id: org.id, codigo: { in: bpmActivas }, empresa_cliente_id: null }, data: { empresa_cliente_id: empresas.BPM.id } });
  for (const [nombre, codigo, activo] of nuevas) {
    const empresa = codigo.startsWith('T') ? empresas.LBT.id : ['AUROR', 'BURLI'].includes(codigo) ? empresas.AUR.id : empresas.BPM.id;
    await prisma.ubicaciones.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo } }, update: {}, create: { negocio_id: org.id, nombre, codigo, tipo: 'sucursal', activo, empresa_cliente_id: empresa } });
  }
  const aurora = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: org.id, codigo: 'AUROR' } });
  await prisma.ubicaciones.updateMany({ where: { negocio_id: org.id, codigo: 'BURLI', entrega_en_ubicacion_id: null }, data: { entrega_en_ubicacion_id: aurora.id } });
  const carniceria = await prisma.ubicaciones.upsert({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: 'CARN' } }, update: {}, create: { negocio_id: org.id, nombre: 'Carnicería', codigo: 'CARN', tipo: 'bodega' } });

  // Mismo orden horizontal que Weekly Order/Billing. Los proyectos inactivos conservan
  // su posición para que al abrirlos no cambie el libro ni la captura semanal.
  const ordenUbicaciones = ['LOMBA', 'NAPER', 'CAROL', 'LISLE', 'GLEND', 'WESTC', 'BATAV', 'ALGON', 'NAPER2', 'ROLLI', 'SCHAU', 'CRYST', 'LAKEZ', 'FRANK', 'PLAIN', 'AUROR', 'BURLI', 'TGE', 'TST', 'TLO', 'TNA', 'TBO'];
  for (const [indice, codigo] of ordenUbicaciones.entries()) {
    await prisma.ubicaciones.updateMany({ where: { negocio_id: org.id, codigo, orden_operativo: 999 }, data: { orden_operativo: indice + 1 } });
  }

  await seedDesechables(org.id, catDesechables.id, caja.id);
  const ordenCarne: Record<string, number> = {
    'MEAT-STEAK': 1, 'MEAT-CHICKEN': 2, 'MEAT-PASTOR-BPM': 3, 'MEAT-PASTOR-TAP': 3,
    'MEAT-ASADA': 4, 'MEAT-FAJITAS': 5, 'MEAT-MILANESA': 6, 'MEAT-TAMAL': 7,
    'MEAT-CHILE': 8, 'MEAT-DORADO': 9, 'MEAT-ADOBO': 10, 'MEAT-CARNITAS': 11,
    'MEAT-CATERING': 12, 'MEAT-PULPA': 13, 'MEAT-TAPATIOS-TACO': 19,
  };
  let ordenMateriaPrima = 101;
  for (const p of carne) {
    const costo = 'costo' in p ? p.costo : null;
    const esCaja = p.tipo === 'proteina' || p.tipo === 'materia_prima';
    const pesoNormalizado = p.tipo === 'proteina' ? (['MEAT-ASADA', 'MEAT-FAJITAS'].includes(p.sku) ? 10 : 20) : p.peso;
    const unidadId = esCaja ? caja.id : pieza.id;
    const orden = ordenCarne[p.sku] ?? ordenMateriaPrima++;
    const data = { nombre: p.nombre, categoria_id: catCarne.id, unidad_distribucion_id: unidadId, unidad_compra_id: esCaja ? caja.id : pieza.id, unidad_almacen_id: unidadId, linea_operacion: 'carne' as const, tipo_operativo: p.tipo, requiere_refrigeracion: p.tipo !== 'servicio', peso_caja_lb: pesoNormalizado, ultimo_costo: costo, costo_promedio: costo, markup_caja: p.markup, precio_venta_fijo: 'precio' in p ? p.precio : null, produccion_dias: p.dias, orden_operativo: orden };
    const producto = await prisma.products.upsert({
      where: { negocio_id_sku: { negocio_id: org.id, sku: p.sku } },
      update: {},
      create: { negocio_id: org.id, sku: p.sku, ...data },
    });
    if (costo != null && producto.ultimo_costo == null) await prisma.products.update({ where: { id: producto.id }, data: { ultimo_costo: costo, costo_promedio: producto.costo_promedio ?? costo } });
  }
  const productosCarne = new Map((await prisma.products.findMany({ where: { negocio_id: org.id, sku: { in: carne.map((p) => p.sku) } } })).map((p) => [p.sku, p.id]));
  const recetas = [
    ['RAW-INSIDE-SKIRT', 'MEAT-STEAK', false], ['RAW-CHICKEN', 'MEAT-CHICKEN', false],
    ['RAW-PORK-BUTT', 'MEAT-PASTOR-BPM', false], ['RAW-PORK-BUTT', 'MEAT-PASTOR-TAP', false],
    ['RAW-PORK-BUTT', 'MEAT-CARNITAS', true], ['RAW-OUTSIDE-SKIRT', 'MEAT-ASADA', false],
    ['RAW-OUTSIDE-SKIRT', 'MEAT-FAJITAS', false], ['RAW-INSIDE-ROUND', 'MEAT-MILANESA', false],
    ['RAW-TAPATIOS-TACO', 'MEAT-TAPATIOS-TACO', false],
  ] as const;
  for (const [orden, [materiaSku, salidaSku, sinCosto]] of recetas.entries()) {
    const materia_prima_id = productosCarne.get(materiaSku); const producto_salida_id = productosCarne.get(salidaSku);
    if (!materia_prima_id || !producto_salida_id) continue;
    await prisma.recetas_produccion.upsert({
      where: { producto_salida_id }, update: {},
      create: { negocio_id: org.id, materia_prima_id, producto_salida_id, sin_costo: sinCosto, orden },
    });
  }
  for (const nombre of ['Christ Panos', 'Gordon', 'Sysco', 'Amigos', 'Super Clean', 'BRD']) {
    await prisma.proveedores.upsert({ where: { negocio_id_nombre: { negocio_id: org.id, nombre } }, update: {}, create: { negocio_id: org.id, nombre } });
  }
  const ubicaciones = new Map((await prisma.ubicaciones.findMany({ where: { negocio_id: org.id } })).map((u) => [u.codigo, u]));
  for (const r of rutas) {
    const existente = await prisma.plantillas_ruta.findUnique({ where: { negocio_id_codigo: { negocio_id: org.id, codigo: r.codigo } } });
    if (existente) continue;
    const plantilla = await prisma.plantillas_ruta.create({ data: { negocio_id: org.id, nombre: r.nombre, codigo: r.codigo, linea_operacion: r.linea, dia_semana: r.dia, conductor: r.conductor } });
    await prisma.plantilla_ruta_paradas.createMany({ data: r.paradas.map((codigo, i) => { const u = ubicaciones.get(codigo); if (!u) throw new Error(`Falta ubicación ${codigo}`); return { plantilla_id: plantilla.id, ubicacion_id: u.id, orden: i + 1, opcional: r.opcionales?.includes(codigo) ?? false }; }) });
  }

  let reparto = await prisma.usuarios.findFirst({ where: { negocio_id: org.id, rol: 'encargado_bodega', activo: true }, orderBy: { id: 'asc' } });
  let repartoCreado = false;
  if (!reparto) {
    if (process.env.NODE_ENV === 'production' && !process.env.SEED_REPARTO_PIN) {
      throw new Error('SEED_REPARTO_PIN es obligatorio para crear el usuario de bodega en producción');
    }
    reparto = await prisma.usuarios.create({ data: { negocio_id: org.id, nombre: 'Bodega y reparto', rol: 'encargado_bodega', pin_hash: await bcrypt.hash(process.env.SEED_REPARTO_PIN ?? '4321', 10), requiere_cambio_pin: true } });
    repartoCreado = true;
  }
  if (await bcrypt.compare('4321', reparto.pin_hash)) await prisma.usuarios.update({ where: { id: reparto.id }, data: { requiere_cambio_pin: true } });
  const adison = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: org.id, codigo: 'BOD' } });
  if (repartoCreado) {
    for (const ubicacion_id of [adison.id, carniceria.id]) await prisma.usuario_ubicaciones.create({ data: { usuario_id: reparto.id, ubicacion_id } });
  }
  console.log('✅ Operación 3Q preparada: empresas, ubicaciones, productos, proveedores y 8 rutas.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
