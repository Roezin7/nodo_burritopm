import type { Prisma } from '@prisma/client';
import { num, num0 } from '../lib/num.js';

/**
 * Cost used to value an inventory row.
 *
 * Historical counts may not have copied the cost into `existencias` or into
 * `inventario_semanal`, even though the product catalog still has it.  Every
 * inventory reader must use the same fallback order so a missing row-level
 * cost cannot turn real stock into a zero-valued asset.
 */
export function costoParaValuacionInventario(
  costoExistencia: number | Prisma.Decimal | null | undefined,
  costoProducto: number | Prisma.Decimal | null | undefined,
  ultimoCosto: number | Prisma.Decimal | null | undefined,
) {
  return num(costoExistencia) ?? num(costoProducto) ?? num(ultimoCosto) ?? 0;
}

export function valorExistencia(
  cantidadDisponible: number | Prisma.Decimal | null | undefined,
  cantidadTransito: number | Prisma.Decimal | null | undefined,
  costoExistencia: number | Prisma.Decimal | null | undefined,
  costoTransito: number | Prisma.Decimal | null | undefined,
  costoProducto: number | Prisma.Decimal | null | undefined,
  ultimoCosto: number | Prisma.Decimal | null | undefined,
) {
  const costo = costoParaValuacionInventario(costoExistencia, costoProducto, ultimoCosto);
  const costoHold = num(costoTransito) ?? costo;
  return Math.max(0, num0(cantidadDisponible)) * costo
    + Math.max(0, num0(cantidadTransito)) * costoHold;
}
