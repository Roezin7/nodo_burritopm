import { prisma } from '../src/db.js';

const NEGOCIO_ID = 1n;
const SEMANA_ID = 81n;
const BOD_ID = 1n;
const TARGET = 228851.36;
const ACTION = 'reconciliacion_excel_semana_34_20260823_paperware';
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const n = (v: unknown) => (v == null ? 0 : Number(v));

async function main() {
  if (process.env.APPLY !== '1') {
    console.log('Simulación: usa APPLY=1 para aplicar la valuación explícita de desechables.');
    return;
  }
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.auditoria_operativa.findFirst({ where: { negocio_id: NEGOCIO_ID, accion: ACTION }, select: { id: true, datos: true } });
    if (previous) return { alreadyApplied: true, auditId: previous.id.toString(), datos: previous.datos };
    const rows = await tx.existencias.findMany({
      where: { negocio_id: NEGOCIO_ID, ubicacion_id: BOD_ID },
      include: { products: { select: { sku: true, linea_operacion: true, costo_promedio: true, ultimo_costo: true } } },
      orderBy: { product_id: 'asc' },
    });
    const disposable = rows.filter((row) => row.products.linea_operacion === 'desechables' && n(row.cantidad_disponible) !== 0);
    const effective = disposable.map((row) => ({
      row,
      costo: n(row.costo_promedio ?? row.products.costo_promedio ?? row.products.ultimo_costo),
    }));
    const current = effective.reduce((sum, item) => sum + n(item.row.cantidad_disponible) * item.costo, 0);
    if (current <= 0) throw new Error('No se pudo obtener el valor efectivo actual de desechables');
    let remaining = TARGET;
    const changes: Record<string, unknown>[] = [];
    for (let index = 0; index < effective.length; index += 1) {
      const item = effective[index];
      const currentLine = n(item.row.cantidad_disponible) * item.costo;
      const targetLine = index === effective.length - 1 ? remaining : round2((currentLine / current) * TARGET);
      const targetCost = round4(targetLine / n(item.row.cantidad_disponible));
      await tx.existencias.update({
        where: { ubicacion_id_product_id: { ubicacion_id: BOD_ID, product_id: item.row.product_id } },
        data: { costo_promedio: targetCost },
      });
      remaining = round2(remaining - targetLine);
      changes.push({ sku: item.row.products.sku, cantidad: n(item.row.cantidad_disponible), costo_anterior: item.costo, costo_nuevo: targetCost, valor_nuevo: targetLine });
    }
    const audit = await tx.auditoria_operativa.create({
      data: {
        negocio_id: NEGOCIO_ID,
        usuario_id: 1n,
        accion: ACTION,
        entidad: 'existencias',
        entidad_id: BOD_ID,
        datos: { source: '/Users/arturohernandez/Downloads/Inventarios -2.xlsx', semana_id: SEMANA_ID.toString(), current_effective_value: round2(current), target_value: TARGET, changes },
      },
    });
    await tx.semanas_operativas.update({ where: { id: SEMANA_ID }, data: { valor_desechables: TARGET } });
    return { auditId: audit.id.toString(), current: round2(current), target: TARGET, rows: changes.length };
  }, { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
