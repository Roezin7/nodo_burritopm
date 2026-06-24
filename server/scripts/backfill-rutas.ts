// Único uso: crea rutas EN CURSO para las distribuciones que ya están en tránsito sin ruta
// (cargadas antes de que la carga creara la ruta automáticamente). Idempotente.
//   npx tsx scripts/backfill-rutas.ts
import { prisma } from '../src/db.js';
import { asegurarRutaEnCurso } from '../src/distribuciones/rutas.service.js';

async function main() {
  const dists = await prisma.distribuciones.findMany({
    where: { estado: { in: ['en_transito', 'parcialmente_entregada'] } },
    select: { id: true, negocio_id: true, cargado_por: true, creado_por: true },
  });
  let creadas = 0;
  for (const d of dists) {
    const antes = await prisma.rutas.count({ where: { distribucion_id: d.id } });
    await prisma.$transaction((tx) => asegurarRutaEnCurso(tx, d.negocio_id, d.id, d.cargado_por ?? d.creado_por));
    const despues = await prisma.rutas.count({ where: { distribucion_id: d.id } });
    if (despues > antes) { creadas++; console.log(`  + ruta creada para distribución #${d.id}`); }
  }
  console.log(`Backfill listo. Distribuciones en tránsito: ${dists.length}. Rutas creadas: ${creadas}.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
