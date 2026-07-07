/** Valor monetario (cantidad × costo). Sin costo => 0. */
export function valor(cantidad: number, costoUnitario: number | null): number {
  if (costoUnitario == null) return 0;
  return Math.round(cantidad * costoUnitario * 100) / 100;
}
