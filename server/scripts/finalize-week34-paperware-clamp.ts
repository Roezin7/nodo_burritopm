import { prisma } from '../src/db.js';

const ACTION = 'reconciliacion_excel_semana_34_20260823_paperware_clamp';

async function main() {
  if (process.env.APPLY !== '1') { console.log('Simulación: usa APPLY=1 para aplicar.'); return; }
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.auditoria_operativa.findFirst({ where: { negocio_id: 1n, accion: ACTION }, select: { id: true, datos: true } });
    if (previous) return { alreadyApplied: true, auditId: previous.id.toString(), datos: previous.datos };
    // Inventario no puede reconocer cantidades negativas: el valuador las lleva a cero.
    // Estos tres costos absorben exactamente ese -$32.84 al sumar líneas redondeadas.
    const changes = [
      { product_id: 16n, sku: 'BPM-0004', costo: 28.4995 },
      { product_id: 13n, sku: 'BPM-0001', costo: 59.1172 },
      { product_id: 14n, sku: 'BPM-0002', costo: 40.4295 },
    ];
    for (const change of changes) await tx.existencias.update({ where: { ubicacion_id_product_id: { ubicacion_id: 1n, product_id: change.product_id } }, data: { costo_promedio: change.costo } });
    const audit = await tx.auditoria_operativa.create({ data: {
      negocio_id: 1n, usuario_id: 1n, accion: ACTION, entidad: 'existencias', entidad_id: 1n,
      datos: { semana_id: '81', target: 228851.36, negative_quantity_policy: 'max_zero', changes },
    } });
    await tx.semanas_operativas.update({ where: { id: 81n }, data: { valor_desechables: 228851.36 } });
    return { auditId: audit.id.toString(), target: 228851.36 };
  }, { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
