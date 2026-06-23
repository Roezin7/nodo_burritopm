import type { Prisma } from '@prisma/client';

/** Convierte Decimal de Prisma (o null) a number | null. */
export function num(d: Prisma.Decimal | number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  return Number(d);
}

/** Igual que num pero con default 0 cuando es null/undefined. */
export function num0(d: Prisma.Decimal | number | null | undefined): number {
  return num(d) ?? 0;
}
