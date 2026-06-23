import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// PIN inicial del admin sembrado. Cámbialo luego desde la app.
const PIN_INICIAL = process.env.SEED_ADMIN_PIN ?? '1234';
// SEED_DEMO=1 siembra además un conjunto de datos de ejemplo (ubicaciones, catálogo,
// usuarios de bodega/sucursal) para probar el flujo de punta a punta.
const DEMO = process.env.SEED_DEMO === '1';

async function main() {
  // 1) Organización Burrito Parrilla Mexicana (idempotente por nombre).
  let org = await prisma.negocios.findFirst({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  if (!org) {
    org = await prisma.negocios.create({
      data: { nombre: 'Burrito Parrilla Mexicana', tipo: 'restaurante', zona_horaria: 'America/Chicago' },
    });
  }
  console.log(`Organización: ${org.nombre} (id ${org.id})`);

  // 2) Usuario administrador general (idempotente por nombre).
  let admin = await prisma.usuarios.findFirst({ where: { negocio_id: org.id, nombre: 'Admin' } });
  if (!admin) {
    admin = await prisma.usuarios.create({
      data: { negocio_id: org.id, nombre: 'Admin', rol: 'admin', pin_hash: await bcrypt.hash(PIN_INICIAL, 10) },
    });
    console.log(`  + usuario admin "Admin" (PIN inicial: ${PIN_INICIAL})`);
  }

  if (DEMO) await sembrarDemo(org.id);

  console.log('\n✅ Seed completo. Cambia el PIN inicial desde la app cuanto antes.');
}

async function sembrarDemo(negocioId: bigint) {
  console.log('  · sembrando datos demo…');

  // Ubicaciones
  const ubics: { nombre: string; codigo: string; tipo: 'bodega' | 'sucursal' }[] = [
    { nombre: 'Bodega Central', codigo: 'BOD', tipo: 'bodega' },
    { nombre: 'Sucursal Pilsen', codigo: 'PIL', tipo: 'sucursal' },
    { nombre: 'Sucursal Logan', codigo: 'LOG', tipo: 'sucursal' },
  ];
  for (const u of ubics) {
    await prisma.ubicaciones.upsert({
      where: { negocio_id_codigo: { negocio_id: negocioId, codigo: u.codigo } },
      update: {},
      create: { negocio_id: negocioId, ...u },
    });
  }

  // Unidades
  for (const nombre of ['Caja', 'Pieza', 'Galón', 'Bolsa', 'Paquete']) {
    await prisma.unidades.upsert({
      where: { negocio_id_nombre: { negocio_id: negocioId, nombre } },
      update: {},
      create: { negocio_id: negocioId, nombre },
    });
  }
  const unidad = async (nombre: string) =>
    (await prisma.unidades.findFirstOrThrow({ where: { negocio_id: negocioId, nombre } })).id;
  const caja = await unidad('Caja');
  const pieza = await unidad('Pieza');
  const galon = await unidad('Galón');
  const bolsa = await unidad('Bolsa');

  // Categorías
  for (const nombre of ['Desechables', 'Abarrotes', 'Bebidas']) {
    await prisma.categorias.upsert({
      where: { negocio_id_nombre: { negocio_id: negocioId, nombre } },
      update: {},
      create: { negocio_id: negocioId, nombre },
    });
  }
  const cat = async (nombre: string) =>
    (await prisma.categorias.findFirstOrThrow({ where: { negocio_id: negocioId, nombre } })).id;

  // Productos
  const productos = [
    { nombre: 'Servilletas', sku: 'SERV-001', cat: 'Desechables', dist: caja, alm: pieza, factor: 500, costo: 8.5 },
    { nombre: 'Vasos 16oz', sku: 'VASO-016', cat: 'Desechables', dist: caja, alm: pieza, factor: 1000, costo: 22 },
    { nombre: 'Salsa Verde', sku: 'SALS-VER', cat: 'Abarrotes', dist: galon, alm: galon, factor: 1, costo: 12.75 },
    { nombre: 'Tortilla de maíz', sku: 'TORT-MAI', cat: 'Abarrotes', dist: bolsa, alm: bolsa, factor: 1, costo: 1.9 },
    { nombre: 'Refresco cola', sku: 'REF-COLA', cat: 'Bebidas', dist: caja, alm: pieza, factor: 24, costo: 9.6 },
  ];
  for (const p of productos) {
    const existe = await prisma.products.findFirst({ where: { negocio_id: negocioId, sku: p.sku } });
    if (!existe) {
      await prisma.products.create({
        data: {
          negocio_id: negocioId,
          nombre: p.nombre,
          sku: p.sku,
          categoria_id: await cat(p.cat),
          unidad_distribucion_id: p.dist,
          unidad_compra_id: caja,
          unidad_almacen_id: p.alm,
          factor_almacen_distribucion: p.factor,
          ultimo_costo: p.costo,
          costo_promedio: p.costo,
        },
      });
    }
  }

  // Usuarios de bodega y sucursal con ubicaciones asignadas.
  const pilsen = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocioId, codigo: 'PIL' } });
  const bodega = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocioId, codigo: 'BOD' } });
  const demoUsers: { nombre: string; rol: 'encargado_bodega' | 'encargado_sucursal'; pin: string; ubic: bigint }[] = [
    { nombre: 'Maria (Pilsen)', rol: 'encargado_sucursal', pin: '5678', ubic: pilsen.id },
    { nombre: 'Beto (Bodega)', rol: 'encargado_bodega', pin: '4321', ubic: bodega.id },
  ];
  for (const u of demoUsers) {
    let usr = await prisma.usuarios.findFirst({ where: { negocio_id: negocioId, nombre: u.nombre } });
    if (!usr) {
      usr = await prisma.usuarios.create({
        data: { negocio_id: negocioId, nombre: u.nombre, rol: u.rol, pin_hash: await bcrypt.hash(u.pin, 10) },
      });
    }
    await prisma.usuario_ubicaciones.upsert({
      where: { usuario_id_ubicacion_id: { usuario_id: usr.id, ubicacion_id: u.ubic } },
      update: {},
      create: { usuario_id: usr.id, ubicacion_id: u.ubic },
    });
  }
  console.log('  · demo lista (3 ubicaciones, 5 productos, usuarios Maria/Beto)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
