import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

const prisma = new PrismaClient();
const EXCEL_PATH = process.env.BPM_INVENTORY_XLSX;
const APPLY = process.env.APPLY_WEEK33_EXCEL_SUMMARY === '1';
const KEY = 'cierre-semana-33-resumen-excel-v3';
const negocioNombre = 'Burrito Parrilla Mexicana';

function numberValue(value: ExcelJS.CellValue): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value === 'object' && 'result' in value) return numberValue(value.result as ExcelJS.CellValue);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function main() {
  if (!EXCEL_PATH) throw new Error('Falta BPM_INVENTORY_XLSX con la ruta de Inventarios .xlsx.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.getWorksheet('Billing (33)');
  if (!sheet) throw new Error('El Excel no contiene la hoja Billing (33).');

  const source = {
    carne: numberValue(sheet.getCell('CO3').value),
    congelado: numberValue(sheet.getCell('CO4').value),
    desechables: numberValue(sheet.getCell('CO5').value),
    billing31: numberValue(sheet.getCell('CO6').value),
    billing32: numberValue(sheet.getCell('CO7').value),
    billing: numberValue(sheet.getCell('CO8').value),
    inventarioCierre: numberValue(sheet.getCell('CO9').value),
    cuentasAbiertas: numberValue(sheet.getCell('CO17').value),
    total: numberValue(sheet.getCell('CO18').value),
  };
  const esperado = {
    carne: rounded(source.carne),
    congelado: rounded(source.congelado),
    desechables: rounded(source.desechables),
    billing: rounded(source.billing),
    cuentasPorCobrar: rounded(source.billing31 + source.billing32 + source.billing),
    cuentasPorPagar: rounded(Math.abs(source.cuentasAbiertas)),
  };
  console.log(`Excel Billing (33): carne $${source.carne.toFixed(3)} · desechables $${source.desechables.toFixed(3)} · billing $${source.billing.toFixed(3)}.`);
  console.log(`Excel cierre: inventario $${source.inventarioCierre.toFixed(3)} · abiertos $${source.cuentasAbiertas.toFixed(2)} · total $${source.total.toFixed(3)}.`);
  if (!APPLY) {
    console.log('Sin cambios. Usa APPLY_WEEK33_EXCEL_SUMMARY=1 para aplicar.');
    return;
  }

  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: negocioNombre } });
  const admin = await prisma.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' } });
  const result = await prisma.$transaction(async (tx) => {
    if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: KEY } } })) {
      return { omitido: true, semana: 33 };
    }

    const semana = await tx.semanas_operativas.findUniqueOrThrow({ where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 33 } } });
    const lombard = await tx.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'LOMBA' } });
    const lombardInvoices = await tx.facturas.findMany({ where: { negocio_id: negocio.id, semana_id: semana.id, ubicacion_id: lombard.id, estado: { not: 'anulada' } }, include: { pagos: true } });
    if (lombardInvoices.some((invoice) => invoice.pagos.length > 0 || invoice.estado === 'pagada')) {
      throw new Error('No se puede excluir LOMBA del Billing 33 porque tiene una factura pagada o con pagos.');
    }
    for (const invoice of lombardInvoices) await tx.facturas.update({ where: { id: invoice.id }, data: { estado: 'anulada' } });

    const cuentasPorCobrar = Number(semana.cuentas_por_cobrar);
    const cuentasPorPagar = Number(semana.cuentas_por_pagar);
    const inventarioTotal = rounded(esperado.carne + esperado.congelado + esperado.desechables);
    const balance = rounded(source.total);
    await tx.semanas_operativas.update({
      where: { id: semana.id },
      data: {
        valor_carne: esperado.carne,
        valor_congelado: esperado.congelado,
        valor_desechables: esperado.desechables,
        cuentas_por_cobrar: esperado.cuentasPorCobrar,
        cuentas_por_pagar: esperado.cuentasPorPagar,
        balance_neto: balance,
      },
    });
    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: KEY } });
    await tx.auditoria_operativa.create({
      data: {
        negocio_id: negocio.id, usuario_id: admin.id, accion: 'conciliar_resumen_excel_semana_33', entidad: 'semana_operativa', entidad_id: semana.id,
        datos: {
          fuente: EXCEL_PATH,
          excel: source,
          aplicado: { ...esperado, inventario_total: inventarioTotal, balance_neto: balance },
          facturas_lomba_anuladas: lombardInvoices.map((invoice) => invoice.id.toString()),
          criterio_billing: 'Billing (33)!CO8 = CO23; excluye LOMBA (columnas E:F).',
          criterio_cartera: 'CO6 + CO7 + CO8 = cuentas por cobrar; -CO17 = cuentas por pagar.',
        },
      },
    });
    return { semana: 33, carne: esperado.carne, desechables: esperado.desechables, billing: esperado.billing, facturasLombaAnuladas: lombardInvoices.length };
  }, { timeout: 120000 });
  console.log('✅ Resumen de semana 33 conciliado:', result);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
