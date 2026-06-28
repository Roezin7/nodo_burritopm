/**
 * Habilita TODOS los productos activos en TODAS las sucursales activas y les pone un
 * stock objetivo de prueba ALEATORIO entre MIN y MAX (para probar la distribución).
 *
 * Crea/actualiza una fila de producto_ubicacion por (sucursal × producto):
 *   habilitado = true, stock_objetivo = aleatorio[MIN..MAX], stock_seguridad = SEGURIDAD,
 *   multiplo_distribucion = 1, minimo_envio = 0.
 *
 * Uso:
 *   npx tsx scripts/seed-sucursales-stock.ts                 (objetivo aleatorio 4..10)
 *   MIN=4 MAX=10 SEGURIDAD=0 npx tsx scripts/seed-sucursales-stock.ts
 *   DRY_RUN=1 npx tsx scripts/seed-sucursales-stock.ts        (solo muestra el plan)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO = 'Burrito Parrilla Mexicana';
const MIN = Number(process.env.MIN ?? 4);
const MAX = Number(process.env.MAX ?? 10);
const SEGURIDAD = Number(process.env.SEGURIDAD ?? 0);
const DRY_RUN = process.env.DRY_RUN === '1';

/** Entero aleatorio entre MIN y MAX (ambos inclusive). */
const objetivoAleatorio = () => MIN + Math.floor(Math.random() * (MAX - MIN + 1));

async function main() {
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: NEGOCIO } });
  const sucursales = await prisma.ubicaciones.findMany({
    where: { negocio_id: negocio.id, tipo: 'sucursal', activo: true },
    select: { id: true, nombre: true },
  });
  const productos = await prisma.products.findMany({
    where: { negocio_id: negocio.id, activo: true },
    select: { id: true },
  });

  const total = sucursales.length * productos.length;
  console.log(`Negocio: ${negocio.nombre} (id ${negocio.id})`);
  console.log(`Sucursales activas: ${sucursales.length} · productos activos: ${productos.length}`);
  console.log(`Filas a crear/actualizar: ${total} · stock_objetivo=aleatorio ${MIN}..${MAX} stock_seguridad=${SEGURIDAD}`);

  if (DRY_RUN) {
    console.log('DRY_RUN=1 → no se aplican cambios.');
    return;
  }

  let n = 0;
  for (const suc of sucursales) {
    await prisma.$transaction(
      productos.map((p) => {
        const objetivo = objetivoAleatorio();
        return prisma.producto_ubicacion.upsert({
          where: { ubicacion_id_product_id: { ubicacion_id: suc.id, product_id: p.id } },
          create: {
            negocio_id: negocio.id,
            ubicacion_id: suc.id,
            product_id: p.id,
            habilitado: true,
            stock_objetivo: objetivo,
            stock_seguridad: SEGURIDAD,
            multiplo_distribucion: 1,
            minimo_envio: 0,
          },
          update: { habilitado: true, stock_objetivo: objetivo, stock_seguridad: SEGURIDAD },
        });
      }),
    );
    n += productos.length;
    console.log(`  · ${suc.nombre}: ${productos.length} productos habilitados`);
  }
  console.log(`Listo. ${n} filas de producto_ubicacion creadas/actualizadas.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
