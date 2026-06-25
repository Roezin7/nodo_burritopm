// Reset operativo: borra productos, distribuciones, rutas, inventarios, existencias,
// movimientos e incidencias; reemplaza las sucursales por la lista nueva; deja SOLO al
// admin Martin y crea un usuario por ubicación (bodega + cada sucursal).
//   npx tsx scripts/reset-operativo.ts
import { prisma } from '../src/db.js';
import bcrypt from 'bcryptjs';

const SUCURSALES: { nombre: string; direccion: string }[] = [
  { nombre: 'Naperville on 59th', direccion: '5059 Ace Ln, Naperville, IL 60564' },
  { nombre: 'Carol Stream', direccion: '415 S Schmale Rd, Carol Stream, IL 60188' },
  { nombre: 'Lombard', direccion: '2770 S Highland Ave #101, Lombard, IL 60148' },
  { nombre: 'Lisle', direccion: '1500 Maple Ave, Lisle, IL 60532' },
  { nombre: 'Glendale Heights', direccion: '280 E Army Trail Rd, Addison, IL 60101' },
  { nombre: 'West Chicago', direccion: '100 W Roosevelt Rd, West Chicago, IL 60185' },
  { nombre: 'Batavia', direccion: '76 S Randall Rd, Batavia, IL 60510' },
  { nombre: 'Algonquin', direccion: '2321 Algonquin Rd, Algonquin, IL 60102' },
  { nombre: 'Naperville on Ogden', direccion: '820 E Ogden Ave, Naperville, IL 60563' },
  { nombre: 'Rolling Meadows', direccion: '2101 S Plum Grove Rd, Rolling Meadows, IL 60008' },
  { nombre: 'Schaumburg', direccion: '720 E Higgins Rd, Schaumburg, IL 60173' },
];

function codigoDe(nombre: string, usados: Set<string>): string {
  const base = nombre.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5) || 'SUC';
  let cod = base;
  let n = 2;
  while (usados.has(cod)) cod = `${base}${n++}`.slice(0, 8);
  usados.add(cod);
  return cod;
}

async function main() {
  const org = await prisma.negocios.findFirst();
  if (!org) throw new Error('No hay organización');
  const martin =
    (await prisma.usuarios.findFirst({ where: { negocio_id: org.id, nombre: 'Martin', rol: 'admin' } })) ??
    (await prisma.usuarios.findFirst({ where: { negocio_id: org.id, rol: 'admin' } }));
  if (!martin) throw new Error('No hay admin para conservar');

  // 1) Borra datos operativos en orden de dependencias.
  await prisma.incidencias.deleteMany({});
  await prisma.movimientos_inventario.deleteMany({});
  await prisma.existencias.deleteMany({});
  await prisma.ruta_paradas.deleteMany({});
  await prisma.rutas.deleteMany({});
  await prisma.distribucion_lineas.deleteMany({});
  await prisma.distribuciones.deleteMany({});
  await prisma.conteo_lineas.deleteMany({});
  await prisma.conteos.deleteMany({});
  await prisma.producto_ubicacion.deleteMany({});
  await prisma.products.deleteMany({});

  // 2) Usuarios: deja solo a Martin (usuario_ubicaciones se borra en cascada).
  await prisma.usuarios.deleteMany({ where: { negocio_id: org.id, id: { not: martin.id } } });

  // 3) Ubicaciones: conserva una bodega central, elimina el resto.
  const bodega = await prisma.ubicaciones.findFirst({ where: { negocio_id: org.id, tipo: 'bodega' }, orderBy: { id: 'asc' } });
  if (!bodega) throw new Error('No hay bodega central que conservar');
  await prisma.ubicaciones.deleteMany({ where: { negocio_id: org.id, id: { not: bodega.id } } });

  // 4) Crea un usuario por ubicación con PIN único.
  const hash = (p: string) => bcrypt.hashSync(p, 10);
  const usados = new Set<string>([bodega.codigo]);
  const creds: { ubicacion: string; rol: string; pin: string }[] = [];
  let pin = 1001;

  const uBodega = await prisma.usuarios.create({
    data: { negocio_id: org.id, nombre: bodega.nombre, rol: 'encargado_bodega', pin_hash: hash(String(pin)) },
  });
  await prisma.usuario_ubicaciones.create({ data: { usuario_id: uBodega.id, ubicacion_id: bodega.id } });
  creds.push({ ubicacion: bodega.nombre, rol: 'Bodega y reparto', pin: String(pin) });
  pin++;

  for (const { nombre, direccion } of SUCURSALES) {
    const ubic = await prisma.ubicaciones.create({
      data: { negocio_id: org.id, nombre, codigo: codigoDe(nombre, usados), tipo: 'sucursal', direccion },
    });
    const user = await prisma.usuarios.create({
      data: { negocio_id: org.id, nombre, rol: 'encargado_sucursal', pin_hash: hash(String(pin)) },
    });
    await prisma.usuario_ubicaciones.create({ data: { usuario_id: user.id, ubicacion_id: ubic.id } });
    creds.push({ ubicacion: nombre, rol: 'Sucursal', pin: String(pin) });
    pin++;
  }

  console.log(`\nAdmin conservado: ${martin.nombre} (no se tocó su PIN).`);
  console.log(`Sucursales creadas: ${SUCURSALES.length}. Productos/distribuciones/inventarios: borrados.\n`);
  console.table(creds);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
