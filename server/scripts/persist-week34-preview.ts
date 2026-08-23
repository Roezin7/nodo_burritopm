import { prisma } from '../src/db.js';

const ACTION = 'persistir_prevision_semana_34_20260823';
const expected = { carne: 137534.64, desechables: 228851.36, cobrar: 279487.76, pagar: 129108.65, balance: 516765.11 };

async function main() {
  if (process.env.APPLY !== '1') { console.log(JSON.stringify({ dryRun: true, expected }, null, 2)); return; }
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.auditoria_operativa.findFirst({ where: { negocio_id: 1n, accion: ACTION }, select: { id: true, datos: true } });
    if (previous) return { alreadyApplied: true, auditId: previous.id.toString(), datos: previous.datos };
    const week = await tx.semanas_operativas.findUnique({ where: { id: 81n } });
    if (!week || week.anio !== 2026 || week.semana !== 34 || week.estado === 'cerrada') throw new Error('Semana 34 no está disponible para guardar la previsualización');
    const current = { carne: Number(week.valor_carne), desechables: Number(week.valor_desechables), cobrar: Number(week.cuentas_por_cobrar), pagar: Number(week.cuentas_por_pagar), balance: Number(week.balance_neto) };
    const audit = await tx.auditoria_operativa.create({ data: {
      negocio_id: 1n, usuario_id: 1n, accion: ACTION, entidad: 'semanas_operativas', entidad_id: 81n,
      datos: { source: 'vistaPreviaCierre(1, 1, 2026-08-22)', current, persisted: expected, excel_billing_window: 284107.18, billing_difference_not_applied: 4619.42 },
    } });
    await tx.semanas_operativas.update({ where: { id: 81n }, data: { valor_carne: expected.carne, valor_desechables: expected.desechables, cuentas_por_cobrar: expected.cobrar, cuentas_por_pagar: expected.pagar, balance_neto: expected.balance } });
    return { auditId: audit.id.toString(), persisted: expected };
  }, { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
