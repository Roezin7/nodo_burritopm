import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = fileURLToPath(new URL('../../prisma/data/3q/', import.meta.url));
async function libro(nombre: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, nombre));
  return wb;
}
const n = (cell: ExcelJS.Cell) => {
  const value = cell.value;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'result' in value) return Number(value.result ?? 0);
  return 0;
};

describe('plantillas Excel 3Q', () => {
  it('conserva el orden horizontal de restaurantes en Weekly Order y Billing', async () => {
    const weekly = (await libro('1. Weekly Order 2026 3Q.xlsx')).getWorksheet('Meat Order 29')!;
    expect([1, 11, 21, 31, 41, 51, 61, 71, 81, 91, 101, 151, 161, 171, 181, 191, 201]
      .map((col) => weekly.getCell(7, col).text)).toEqual([
      'LOMBARD', 'NAPERVILLE', 'CAROL STREAM', 'LISLE', 'GLENDALE HEIGHTS', 'WEST CHICAGO',
      'BATAVIA', 'ALGONQUIN', 'NAPERVILLE TWO', 'ROLLING MEADOWS', 'SCHAUMBURG',
      'TAQUERIA AURORA', 'TAQUERIA BURLINGTON', 'TAPATIOS GLEN ELLYN',
      'TAPATIOS STREAMWOOD', 'TAPATIOS LOMBARD', 'TAPATIOS NAPERVILLE',
    ]);
    const billing = (await libro('4. Billing 2026 3Q.xlsx')).getWorksheet('Billing (29)')!;
    expect([5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 56, 59, 62, 65, 68, 71]
      .map((col) => billing.getCell(2, col).text)).toEqual([
      'LOMBARD', 'NAPERVILLE I', 'CAROL STREAM', 'LISLE', 'GLENDALE H.', 'WEST CHICAGO',
      'BATAVIA', 'ALGONQUIN', 'NAPERVILLE II', 'RO-ME', 'SCHAUMBURG', 'TAQ. AURORA',
      'TAQ. AURORA #2', 'LBT GLEN ELLYN', 'LBT STREAMWOOD', 'LBT LOMBARD', 'LBT NAPERVILLE',
    ]);
  });

  it('ubica inventario de desechables después del último importe de LBT', async () => {
    const ws = (await libro('2. Disposables 2026 3Q.xlsx')).getWorksheet('Week (29)')!;
    expect(ws.getColumn(106).letter).toBe('DB');
    expect(ws.getColumn(107).letter).toBe('DC');
    expect(ws.getColumn(109).letter).toBe('DE');
    expect(ws.getCell('DC1').text).toBe('LBT-8');
    expect(ws.getCell('DE1').text).toBe('INITIAL INV.');
    expect(ws.getCell('DG1').text).toBe('NEW ORDER');
    expect(ws.getCell('DI1').text).toBe('SOLD');
    expect(ws.getCell('DK1').text).toBe('FINAL INV.');
  });

  it('alinea las columnas LBT de desechables con sus facturas históricas', async () => {
    const disposables = (await libro('2. Disposables 2026 3Q.xlsx')).getWorksheet('Week (28)')!;
    const lbt = (await libro('5. LBT 2026 3Q.xlsx')).getWorksheet('Week (28)')!;
    // Tapatíos Three Compartment: AO=TGE, AQ=TST, AS=TLO, AU=TNA.
    expect([41, 43, 45, 47].map((col) => n(disposables.getCell(48, col))))
      .toEqual([1, 10, 19, 28].map((base) => n(lbt.getCell(28, base + 6))));
    expect([41, 43, 45, 47].map((col) => n(disposables.getCell(49, col))))
      .toEqual([1, 10, 19, 28].map((base) => n(lbt.getCell(29, base + 6))));
  });

  it('separa Pulpa de Tapatíos Taco Meat usando Billing sin perder el total de Weekly Order', async () => {
    const weekly = (await libro('1. Weekly Order 2026 3Q.xlsx')).getWorksheet('Meat Order (28)')!;
    const billing = (await libro('4. Billing 2026 3Q.xlsx')).getWorksheet('Billing (28)')!;
    for (const [baseWeekly, colBilling] of [[171, 62], [181, 65]] as const) {
      const totalOrden = [1, 4, 7].reduce((a, offset) => a + n(weekly.getCell(29, baseWeekly + offset)), 0);
      expect(totalOrden).toBe(n(billing.getCell(16, colBilling)) + n(billing.getCell(17, colBilling)));
    }
  });

  it('mantiene las capacidades y renglones operativos de Production', async () => {
    const ws = (await libro('3. Production 2026 3Q.xlsx')).getWorksheet('Production (29)')!;
    expect([3, 7, 11, 15, 19, 23].map((row) => ws.getCell(row, 1).text)).toEqual([
      'INSIDE SKIRT STEAK', 'CHICKEN BREAST', 'PORK BUTT', 'OUTSIDE SKIRT', 'INSIDE ROUND', 'TAPATIOS TACO MEAT',
    ]);
    expect([3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23].map((row) => ws.getCell(row, 41).text)).toEqual([
      'STEAK TACO MEAT', 'CHICKEN TACO MEAT', 'ALPASTOR TACO MEAT', 'CARNE ASADA', 'FAJITAS',
      'MILANESA', 'TAMAL ROJO', 'CHILE RELLENO', 'TACO DORADO', 'CARNITAS', 'TAPATIOS TACO MEAT',
    ]);
    expect(ws.getColumn(32).letter).toBe('AF');
    expect(ws.getColumn(35).letter).toBe('AI');
    expect(ws.getColumn(36).letter).toBe('AJ');
  });
});
