import { prisma } from '../src/db.js';

const ACTION = 'reconciliacion_excel_semana_34_20260823_paperware_rounding';
const TARGET = 228851.36;

async function main() {
  if (process.env.APPLY !== '1') { console.log('Simulación: usa APPLY=1 para aplicar.'); return; }
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.auditoria_operativa.findFirst({ where: { negocio_id: 1n, accion: ACTION }, select: { id: true, datos: true } });
    if (previous) return { alreadyApplied: true, auditId: previous.id.toString(), datos: previous.datos };
    // La valuación de la pantalla redondea cada renglón a centavos. Estos dos
    // costos conservan la asignación total del Excel después de ese redondeo.
    await tx.existencias.update({ where: { ubicacion_id_product_id: { ubicacion_id: 1n, product_id: 45n } }, data: { costo_promedio: 5.4775 } });
    await tx.existencias.update({ where: { ubicacion_id_product_id: { ubicacion_id: 1n, product_id: 47n } }, data: { costo_promedio: 27.3701 } });
    const audit = await tx.auditoria_operativa.create({ data: {
      negocio_id: 1n, usuario_id: 1n, accion: ACTION, entidad: 'existencias', entidad_id: 1n,
      datos: { semana_id: '81', target: TARGET, adjustments: [{ product_id: '45', sku: 'BPM-0033', costo: 5.4775 }, { product_id: '47', sku: 'BPM-0035', costo: 27.3701 }] },
    } });
    await tx.semanas_operativas.update({ where: { id: 81n }, data: { valor_desechables: TARGET } });
    return { auditId: audit.id.toString(), target: TARGET };
  }, { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
