/**
 * Importa el inventario REAL de Burrito Parrilla Mexicana (hoja "Inventario M&G").
 *
 * Qué hace (todo dentro de UNA transacción, acotado al negocio):
 *   1. Borra distribuciones (y por cascada: líneas, rutas y paradas) e incidencias.
 *   2. Borra conteos (y por cascada: sus líneas).
 *   3. Borra movimientos, existencias, producto_ubicacion y productos previos.
 *   4. Crea los 52 productos reales con su costo.
 *   5. Carga el inventario inicial como existencia DISPONIBLE en la bodega central (Bodega Adison).
 *
 * Reglas acordadas:
 *   - Inventario inicial negativo (COCO LOPEZ, TRAPOS AMARILLOS) → 0 (la bodega no arranca en negativo).
 *   - Unidad de distribución por defecto: "Caja" (ajustable luego por producto).
 *   - El precio de venta de la hoja no se importa (el modelo no tiene ese campo; es de costos).
 *
 * Uso:  npx tsx scripts/import-bpm-inventory.ts            (aplica)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === '1';
const NEGOCIO = 'Burrito Parrilla Mexicana';
const UNIDAD_DEFAULT = 'Caja';

// nombre, costo unitario, inventario inicial (de la hoja, filas 2-53).
const PRODUCTOS: [string, number, number][] = [
  ['SABERT BASE THREE COMP', 54, 177],
  ['SABERT LIDS THREE COMP', 36.93, 178],
  ['DINNER NAPKIN', 29.95, 803],
  ['TORTA - 8X6 32oz', 23, 810],
  ['CLEAR CUP 24oz', 38.95, 242],
  ['CLEAR CUP 12oz', 44.95, 69],
  ['LIDS 16oz 24oz', 18.25, 126],
  ['CUP HOLDER', 29.95, 41],
  ['STRAWS WRAPPED BLACK', 22.95, 98],
  ['PORTION CUP 1.5oz', 21.99, 378],
  ['PORTION LID 2oz', 18.745, 517],
  ['KIT FORK & KNIFE HVY', 15.62, 15],
  ['FORK HD PLASTIC', 11.07, 120],
  ['SPOON PLASTIC', 13.03, 51],
  ['T-SHIRT BAG', 18.95, 69],
  ['2oz PORTION CUP', 22.95, 83],
  ['XL NITRILE GLOVES', 33.95, 381],
  ['MD VINYL GLOVES', 15.85, 42],
  ['FOIL STD 12X1000', 21.95, 1789],
  ['THERMAL PAPER ROLL 3 1/8"', 33.5, 77],
  ['DELI CONTAINER 32OZ CLEAR', 35.71, 13],
  ['WAX PAPER 10X10', 77.2, 155],
  ['BAGS #8 CRAFT PAPER', 13.8, 614],
  ['SOAP 4-1', 27.99, 76],
  ['OVEN & GRILL 4-1', 32.99, 83],
  ['BAGS TRASH', 23.05, 131],
  ['EVAPORATED MILK', 26.11, 72],
  ['CONDENSED MILK', 42.24, 87],
  ['COCO LOPEZ', 75.69, -4],
  ['GARLIC SALT', 5, 6],
  ['BLUE TAPE', 30, 2],
  ['MARKERS', 5, 15],
  ['CLEAR TAPE', 5, 10],
  ['TRAPOS AMARILLOS', 5, -18],
  ['ARBOL BLEND', 25, 19],
  ['RED SAUCE BLEND', 25, 45],
  ['GREEN SAUCE BLEND', 25, 78],
  ['HABANERO BLEND', 25, 58],
  ['MOLE BLEND', 25, 68],
  ['RANCHERO BLEND', 25, 50],
  ['POBLANO BLEND', 25, 17],
  ['CARNITAS BLEND', 25, 61],
  ['RICE BLEND', 35, 113],
  ['MANGO', 21.5, 29],
  ['CUCUMBER LEMON', 21.5, 86],
  ['JAMAICA', 21.5, 30],
  ['TAPATIOS THREE COMPARTMENT', 29.07, 543],
  ['TAPATIOS ONE COMPARTMENT', 29.07, 61],
  ['TAPATIOS SUIZO', 23.55, 170],
  ['FRIED ICE CREAM', 27.55, 184],
  ['CUPS 12 BLACK', 20.46, 0],
  ['RICE FLOUR', 20, 0],
];

function sku(i: number) {
  return `BPM-${String(i + 1).padStart(4, '0')}`;
}

async function main() {
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: NEGOCIO } });
  const bodega = await prisma.ubicaciones.findFirstOrThrow({
    where: { negocio_id: negocio.id, tipo: 'bodega', activo: true },
    orderBy: { id: 'asc' },
  });
  const unidad = await prisma.unidades.findFirstOrThrow({ where: { negocio_id: negocio.id, nombre: UNIDAD_DEFAULT } });

  const cargados = PRODUCTOS.length;
  const dispTotal = PRODUCTOS.reduce((a, [, , inv]) => a + Math.max(0, inv), 0);
  console.log(`Negocio: ${negocio.nombre} (id ${negocio.id})`);
  console.log(`Bodega central: ${bodega.nombre} (id ${bodega.id})`);
  console.log(`Unidad por defecto: ${unidad.nombre}`);
  console.log(`Productos a cargar: ${cargados} · inventario disponible total: ${dispTotal} (negativos a 0)`);

  if (DRY_RUN) {
    console.log('DRY_RUN=1 → no se aplican cambios.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Distribuciones (cascada: líneas, rutas, paradas) + incidencias.
    await tx.incidencias.deleteMany({ where: { negocio_id: negocio.id } });
    const delDist = await tx.distribuciones.deleteMany({ where: { negocio_id: negocio.id } });
    // 2. Conteos (cascada: conteo_lineas).
    const delConteos = await tx.conteos.deleteMany({ where: { negocio_id: negocio.id } });
    // 3. Inventario y catálogo previo.
    await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id } });
    await tx.existencias.deleteMany({ where: { negocio_id: negocio.id } });
    await tx.producto_ubicacion.deleteMany({ where: { negocio_id: negocio.id } });
    const delProds = await tx.products.deleteMany({ where: { negocio_id: negocio.id } });
    console.log(`Borrado: distribuciones=${delDist.count} conteos=${delConteos.count} productos=${delProds.count}`);

    // 4 + 5. Crear productos y existencia inicial en bodega.
    for (let i = 0; i < PRODUCTOS.length; i++) {
      const [nombre, costo, inv] = PRODUCTOS[i];
      const disponible = Math.max(0, inv);
      const prod = await tx.products.create({
        data: {
          negocio_id: negocio.id,
          nombre: nombre.trim(),
          sku: sku(i),
          unidad_distribucion_id: unidad.id,
          costo_promedio: costo,
          ultimo_costo: costo,
          activo: true,
        },
      });
      await tx.existencias.create({
        data: {
          negocio_id: negocio.id,
          ubicacion_id: bodega.id,
          product_id: prod.id,
          cantidad_disponible: disponible,
          cantidad_reservada: 0,
          cantidad_transito: 0,
          costo_promedio: costo,
        },
      });
      // Habilita el producto en la bodega para que se pueda CONTAR (inventario físico).
      await tx.producto_ubicacion.create({
        data: { negocio_id: negocio.id, ubicacion_id: bodega.id, product_id: prod.id, habilitado: true },
      });
    }
    console.log(`Creados ${PRODUCTOS.length} productos con existencia inicial + habilitados en ${bodega.nombre}.`);
  });

  console.log('Listo.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
