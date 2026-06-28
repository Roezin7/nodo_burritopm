/**
 * Deshace el ÚLTIMO inventario (conteo) de la bodega central: revierte el efecto de su
 * reconciliación sobre las existencias (deja el stock como estaba antes) y borra el conteo
 * y sus movimientos de ajuste. Todo en una transacción.
 *
 * Supuesto: nada más tocó esos productos en la bodega después del conteo (carga, retiro…).
 * Si hubo movimientos posteriores, revisa antes con DRY_RUN.
 *
 * Uso:
 *   DRY_RUN=1 npx tsx scripts/undo-last-bodega-count.ts   (muestra qué haría, no aplica)
 *   npx tsx scripts/undo-last-bodega-count.ts             (aplica)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const NEGOCIO = 'Burrito Parrilla Mexicana';
const DRY_RUN = process.env.DRY_RUN === '1';
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

async function main() {
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: NEGOCIO } });
  const bodega = await prisma.ubicaciones.findFirstOrThrow({
    where: { negocio_id: negocio.id, tipo: 'bodega', activo: true },
    orderBy: { id: 'asc' },
  });
  const conteo = await prisma.conteos.findFirst({
    where: { negocio_id: negocio.id, ubicacion_id: bodega.id, estado: { in: ['cerrado', 'reabierto'] } },
    orderBy: { id: 'desc' },
  });
  if (!conteo) throw new Error('No hay un conteo cerrado de la bodega para deshacer.');

  const movs = await prisma.movimientos_inventario.findMany({
    where: { negocio_id: negocio.id, documento_tipo: 'conteo', documento_id: conteo.id },
    select: { product_id: true, tipo: true, cantidad: true },
  });
  // Neto firmado aplicado a existencias por producto (positivo = se sumó; negativo = se restó).
  const neto = new Map<string, number>();
  for (const m of movs) {
    const signo = m.tipo === 'ajuste_negativo' ? -1 : 1;
    const k = m.product_id.toString();
    neto.set(k, r3((neto.get(k) ?? 0) + signo * Number(m.cantidad)));
  }

  console.log(`Bodega: ${bodega.nombre} (id ${bodega.id})`);
  console.log(`Conteo a deshacer: #${conteo.id} (estado ${conteo.estado}, fecha ${conteo.fecha?.toISOString().slice(0, 10) ?? '—'})`);
  console.log(`Movimientos de ajuste: ${movs.length} · productos afectados: ${neto.size}`);

  if (DRY_RUN) {
    console.log('DRY_RUN=1 → no se aplican cambios.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const [pid, d] of neto) {
      if (d === 0) continue;
      await tx.existencias.update({
        where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: BigInt(pid) } },
        data: { cantidad_disponible: { decrement: d }, actualizado_at: new Date() },
      });
    }
    await tx.movimientos_inventario.deleteMany({
      where: { negocio_id: negocio.id, documento_tipo: 'conteo', documento_id: conteo.id },
    });
    await tx.conteos.delete({ where: { id: conteo.id } }); // cascada: conteo_lineas
  });

  console.log(`Listo. Conteo #${conteo.id} deshecho y existencias revertidas.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
