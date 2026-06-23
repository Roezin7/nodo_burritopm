// Lógica pura de abastecimiento (sin DB). Es la fórmula crítica del sistema, va testeada.
// La sucursal NO pide: la cantidad sugerida surge del conteo físico y de los parámetros.

/** Redondeo a 3 decimales evitando ruido de punto flotante. */
export function redondear3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

/** Redondea HACIA ARRIBA al múltiplo de empaque (para alcanzar el objetivo). */
export function redondearAlMultiplo(n: number, multiplo: number): number {
  if (multiplo <= 0) return redondear3(n);
  return redondear3(Math.ceil((n - 1e-9) / multiplo) * multiplo);
}

export interface ParametrosEnvio {
  stock_objetivo: number;
  stock_seguridad: number;
  disponible: number; // del último conteo cerrado de la sucursal
  en_transito: number; // mercancía ya en camino (MVP: 0)
  multiplo_distribucion: number;
  minimo_envio: number;
}

/**
 * Cantidad sugerida a enviar:
 *   cruda = objetivo + seguridad − disponible − en_transito
 *   si cruda ≤ 0 → 0
 *   se redondea hacia arriba al múltiplo de distribución
 *   si 0 < sugerida < mínimo de envío → se sube al mínimo de envío
 * Nunca negativa.
 */
export function sugerirEnvio(p: ParametrosEnvio): number {
  const cruda = p.stock_objetivo + p.stock_seguridad - p.disponible - p.en_transito;
  if (cruda <= 0) return 0;
  let sugerida = redondearAlMultiplo(cruda, p.multiplo_distribucion || 1);
  if (p.minimo_envio > 0 && sugerida > 0 && sugerida < p.minimo_envio) {
    sugerida = redondearAlMultiplo(p.minimo_envio, p.multiplo_distribucion || 1);
  }
  return redondear3(Math.max(0, sugerida));
}

/** Valor monetario (cantidad × costo). Sin costo => 0. */
export function valor(cantidad: number, costoUnitario: number | null): number {
  if (costoUnitario == null) return 0;
  return Math.round(cantidad * costoUnitario * 100) / 100;
}
