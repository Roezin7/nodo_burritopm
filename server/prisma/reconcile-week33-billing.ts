import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';

const prisma = new PrismaClient();
const EXCEL_PATH = process.env.BPM_INVENTORY_XLSX;
const APPLY = process.env.APPLY_WEEK33_BILLING === '1';
const SIMULATE = process.env.SIMULATE_WEEK33_BILLING === '1';
const SOURCE_ONLY = process.env.BILLING33_SOURCE_ONLY === '1';
const KEY = 'billing-semana-33-conciliado-excel-v1';
const inicio = new Date('2026-08-09T00:00:00.000Z');
const fin = new Date('2026-08-15T00:00:00.000Z');
const negocioNombre = 'Burrito Parrilla Mexicana';

type Linea = 'carne' | 'desechables';
type BillingTarget = { codigo: string; cantidad: string; importe: string };
type BillingAmount = { codigo: string; carne: number; desechables: number; total: number };

const targets: BillingTarget[] = [
  { codigo: 'LOMBA', cantidad: 'E', importe: 'F' },
  { codigo: 'NAPER', cantidad: 'H', importe: 'I' },
  { codigo: 'CAROL', cantidad: 'K', importe: 'L' },
  { codigo: 'LISLE', cantidad: 'N', importe: 'O' },
  { codigo: 'GLEND', cantidad: 'Q', importe: 'R' },
  { codigo: 'WESTC', cantidad: 'T', importe: 'U' },
  { codigo: 'BATAV', cantidad: 'W', importe: 'X' },
  { codigo: 'ALGON', cantidad: 'Z', importe: 'AA' },
  { codigo: 'NAPER2', cantidad: 'AC', importe: 'AD' },
  { codigo: 'ROLLI', cantidad: 'AF', importe: 'AG' },
  { codigo: 'SCHAU', cantidad: 'AI', importe: 'AJ' },
  { codigo: 'CRYST', cantidad: 'AL', importe: 'AM' },
  { codigo: 'LAKEZ', cantidad: 'AO', importe: 'AP' },
  { codigo: 'FRANK', cantidad: 'AR', importe: 'AS' },
  { codigo: 'PLAIN', cantidad: 'AU', importe: 'AV' },
  { codigo: 'AUROR', cantidad: 'BS', importe: 'BT' },
  { codigo: 'BURLI', cantidad: 'BV', importe: 'BW' },
  { codigo: 'TGE', cantidad: 'BY', importe: 'BZ' },
  { codigo: 'TST', cantidad: 'CB', importe: 'CC' },
  { codigo: 'TLO', cantidad: 'CE', importe: 'CF' },
  { codigo: 'TNA', cantidad: 'CH', importe: 'CI' },
  { codigo: 'TBO', cantidad: 'CK', importe: 'CL' },
];

function numberValue(value: ExcelJS.CellValue): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value === 'object' && 'result' in value) return numberValue(value.result as ExcelJS.CellValue);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseBilling(workbook: ExcelJS.Workbook): BillingAmount[] {
  const sheet = workbook.getWorksheet('Billing (33)');
  if (!sheet) throw new Error('El Excel no contiene Billing (33).');
  if (String(sheet.getCell(2, 1).value ?? '').trim().toUpperCase() !== 'PRODUCT') throw new Error('Billing (33) no tiene la estructura esperada.');
  return targets.map((target) => {
    const carne = rounded(numberValue(sheet.getCell(`${target.importe}20`).value) + numberValue(sheet.getCell(`${target.importe}21`).value));
    const desechables = rounded(numberValue(sheet.getCell(`${target.importe}22`).value));
    return { codigo: target.codigo, carne, desechables, total: rounded(carne + desechables) };
  });
}

function printSource(amounts: BillingAmount[]) {
  const totalCarne = rounded(amounts.reduce((sum, item) => sum + item.carne, 0));
  const totalDesechables = rounded(amounts.reduce((sum, item) => sum + item.desechables, 0));
  console.log(`Billing (33): carne $${totalCarne.toFixed(2)} · desechables $${totalDesechables.toFixed(2)} · total $${rounded(totalCarne + totalDesechables).toFixed(2)}`);
  console.log(amounts.filter((item) => item.total > 0).map((item) => `${item.codigo}: M $${item.carne.toFixed(2)} / D $${item.desechables.toFixed(2)}`).join(' · '));
}

function numeroFactura(empresa: string, ubicacion: string, linea: Linea) {
  const limpio = (value: string, max: number) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, max) || 'X';
  return `2026-33-${limpio(empresa, 8)}-${limpio(ubicacion, 12)}-${linea === 'carne' ? 'M' : 'D'}`;
}

async function main() {
  if (!EXCEL_PATH) throw new Error('Falta BPM_INVENTORY_XLSX con la ruta de Inventarios .xlsx.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(EXCEL_PATH);
  const amounts = parseBilling(workbook);
  printSource(amounts);
  if (SOURCE_ONLY) return;

  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: negocioNombre } });
  const result = await prisma.$transaction(async (tx) => {
    if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: KEY } } })) {
      return { omitido: true, cambios: 0 };
    }
    const semana = await tx.semanas_operativas.findUniqueOrThrow({ where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 33 } } });
    const admin = await tx.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' } });
    const locations = await tx.ubicaciones.findMany({ where: { negocio_id: negocio.id, codigo: { in: targets.map((target) => target.codigo) } }, include: { empresa_cliente: true } });
    const locationByCode = new Map(locations.map((location) => [location.codigo, location]));
    const missingLocations = targets.filter((target) => !locationByCode.has(target.codigo)).map((target) => target.codigo);
    if (missingLocations.length) throw new Error(`Faltan ubicaciones de Billing (33): ${missingLocations.join(', ')}.`);

    const facturas = await tx.facturas.findMany({
      where: { negocio_id: negocio.id, semana_id: semana.id },
      include: { pagos: true, lineas: true, ajustes: true },
      orderBy: { version: 'desc' },
    });
    const cambios: Array<{ codigo: string; linea: Linea; anterior: number; corregido: number; diferencia: number; accion: string }> = [];

    for (const amount of amounts) {
      const location = locationByCode.get(amount.codigo)!;
      if (!location.empresa_cliente_id) throw new Error(`La ubicación ${amount.codigo} no tiene empresa cliente.`);
      for (const linea of ['carne', 'desechables'] as const) {
        const esperado = amount[linea];
        const relacionadas = facturas.filter((factura) => factura.ubicacion_id === location.id && factura.linea_operacion === linea);
        const vigentes = relacionadas.filter((factura) => factura.estado !== 'anulada');
        const actual = vigentes[0];
        if (vigentes.length > 1) throw new Error(`Hay ${vigentes.length} facturas vigentes para ${amount.codigo} ${linea}; se detuvo la conciliación.`);
        if (actual && (actual.estado === 'pagada' || actual.pagos.length > 0)) {
          const anterior = rounded(Number(actual.total));
          if (Math.abs(anterior - esperado) > 0.01) throw new Error(`La factura pagada de ${amount.codigo} ${linea} difiere: $${anterior.toFixed(2)} vs $${esperado.toFixed(2)}.`);
          continue;
        }
        const anterior = actual ? rounded(Number(actual.total)) : 0;
        if (Math.abs(anterior - esperado) <= 0.01) continue;
        if (!esperado && actual) {
          await tx.facturas.update({ where: { id: actual.id }, data: { estado: 'anulada' } });
          cambios.push({ codigo: amount.codigo, linea, anterior, corregido: 0, diferencia: rounded(-anterior), accion: 'anular_factura_sin_importe_en_billing' });
          continue;
        }

        const maxVersion = relacionadas.reduce((max, factura) => Math.max(max, factura.version), 0);
        const diasCredito = linea === 'carne' ? location.empresa_cliente!.dias_credito_carne : location.empresa_cliente!.dias_credito_desechables;
        const factura = await tx.facturas.create({
          data: {
            negocio_id: negocio.id, semana_id: semana.id, empresa_cliente_id: location.empresa_cliente_id,
            ubicacion_id: location.id, linea_operacion: linea,
            numero: numeroFactura(location.empresa_cliente!.codigo, location.codigo, linea),
            emitida_at: fin, vence_at: new Date(fin.getTime() + diasCredito * 86400000), estado: 'emitida',
            subtotal: esperado, total: esperado, version: maxVersion + 1, reemplaza_factura_id: actual?.id ?? null,
          },
        });
        if (actual) {
          const diferencia = rounded(esperado - anterior);
          await tx.factura_lineas.createMany({
            data: [
              ...actual.lineas.map((line) => ({ factura_id: factura.id, product_id: line.product_id, descripcion: line.descripcion, cantidad: line.cantidad, precio_unitario: line.precio_unitario, importe: line.importe })),
              { factura_id: factura.id, product_id: null, descripcion: 'Ajuste de conciliación Billing (33)', cantidad: 1, precio_unitario: diferencia, importe: diferencia },
            ],
          });
          if (actual.ajustes.length) await tx.ajustes_facturacion.updateMany({ where: { id: { in: actual.ajustes.map((adjustment) => adjustment.id) } }, data: { factura_id: factura.id } });
          await tx.facturas.update({ where: { id: actual.id }, data: { estado: 'anulada' } });
        } else {
          await tx.factura_lineas.create({ data: { factura_id: factura.id, product_id: null, descripcion: 'Importe conciliado con Billing (33)', cantidad: 1, precio_unitario: esperado, importe: esperado } });
        }
        cambios.push({ codigo: amount.codigo, linea, anterior, corregido: esperado, diferencia: rounded(esperado - anterior), accion: actual ? 'crear_version_correctiva' : 'crear_factura_faltante' });
      }
    }

    if (SIMULATE) throw new Error(`SIMULATION_ROLLBACK:${JSON.stringify(cambios)}`);
    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: KEY } });
    await tx.auditoria_operativa.create({
      data: {
        negocio_id: negocio.id, usuario_id: admin.id, accion: 'conciliar_billing_semana_33', entidad: 'semana_operativa', entidad_id: semana.id,
        datos: { fuente: EXCEL_PATH, total_billing: rounded(amounts.reduce((sum, item) => sum + item.total, 0)), cambios },
      },
    });
    return { omitido: false, cambios: cambios.length, detalle: cambios };
  }, { timeout: 120000 });
  console.log('✅ Billing de semana 33 conciliado:', result);
}

main().catch((error) => {
  if (error instanceof Error && error.message.startsWith('SIMULATION_ROLLBACK:')) {
    console.log(`✅ Simulación revertida: ${error.message.slice('SIMULATION_ROLLBACK:'.length)}`);
    return;
  }
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
