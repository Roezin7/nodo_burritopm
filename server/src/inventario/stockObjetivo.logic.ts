// ============================================================================
//  MOTOR DE STOCK OBJETIVO (lógica pura, sin DB) — el corazón del sistema.
//
//  Modelo: inventario de REVISIÓN PERIÓDICA con nivel "order-up-to" S.
//  Cada ciclo la sucursal se rellena hasta S = stock_objetivo + stock_seguridad.
//  Para no quedarse sin stock, S debe cubrir la demanda durante la "ventana de
//  protección" P = (días entre reabastos) + (lead time de entrega), más un colchón
//  por la variabilidad de esa demanda:
//
//      S      = μ·P  +  z·σ·√P
//      objetivo  = μ·P            (demanda esperada del ciclo)
//      seguridad = z·σ·√P         (colchón; z según nivel de servicio)
//
//  μ = consumo diario esperado (media ponderada por recencia)
//  σ = desviación estándar del consumo diario
//  z = cuantil normal del nivel de servicio (95% → 1.645, 97.5% → 1.960, …)
//
//  La señal de consumo se reconstruye fuera de aquí a partir de conteos físicos
//  y recepciones (demanda real, no las órdenes). Aquí solo entran observaciones.
// ============================================================================

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const ceil3 = (n: number) => Math.ceil((n - 1e-9) * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Una observación = un ciclo entre dos conteos cerrados consecutivos. */
export interface ObservacionConsumo {
  consumo: number; // unidades consumidas en el ciclo (puede venir negativo por error de conteo)
  dias: number; // duración del ciclo en días
}

export type Confianza = 'alta' | 'media' | 'baja' | 'sin_datos';

export interface ParametrosCalculo {
  nivelServicio: number; // % (50–99.9). A mayor nivel, mayor colchón. Default 97.5
  leadTimeDias: number; // demora de entrega tras el pedido (default 1)
  lambda: number; // peso de recencia 0–1 (1 = sin decaimiento). Default 0.85
  coberturaMinDias: number; // piso de la ventana de protección (default 1)
  coberturaMaxDias: number; // techo de la ventana de protección (default 21)
  cvPrior: number; // coef. de variación supuesto cuando hay pocos datos (default 0.4)
}

export const PARAMETROS_DEFAULT: ParametrosCalculo = {
  nivelServicio: 97.5,
  leadTimeDias: 1,
  lambda: 0.85,
  coberturaMinDias: 1,
  coberturaMaxDias: 21,
  cvPrior: 0.4,
};

export interface ResultadoStock {
  consumoDiario: number; // μ
  sigmaDiario: number; // σ usada (mezcla medición + prior si hay pocos datos)
  coberturaDias: number; // P (ventana de protección)
  ciclos: number; // nº de observaciones válidas usadas
  anomalias: number; // observaciones descartadas por consumo negativo
  z: number;
  stockObjetivo: number; // μ·P redondeado
  stockSeguridad: number; // z·σ·√P redondeado (hacia arriba)
  nivelS: number; // objetivo + seguridad
  confianza: Confianza;
}

/**
 * Cuantil de la normal estándar (inversa de Φ) — algoritmo de Acklam.
 * Permite cualquier nivel de servicio, no solo unos pocos tabulados.
 */
export function zDeNivelServicio(nivelPct: number): number {
  const p = clamp(nivelPct / 100, 0.5, 0.999);
  if (p === 0.5) return 0;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239] as const;
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1] as const;
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783] as const;
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416] as const;
  const plow = 0.02425;
  const phigh = 1 - plow;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return Math.max(0, r3(x));
}

/** Mediana de una lista (no muta el arreglo original). */
function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function confianzaDe(n: number): Confianza {
  if (n <= 0) return 'sin_datos';
  if (n >= 6) return 'alta';
  if (n >= 3) return 'media';
  return 'baja';
}

/**
 * Núcleo del cálculo. Recibe observaciones en orden CRONOLÓGICO (más antigua primero)
 * y devuelve el stock objetivo + seguridad sugeridos con sus diagnósticos.
 */
export function calcularStockObjetivo(observaciones: ObservacionConsumo[], params: Partial<ParametrosCalculo> = {}): ResultadoStock {
  const p = { ...PARAMETROS_DEFAULT, ...params };
  const z = zDeNivelServicio(p.nivelServicio);

  // Consumo negativo = imposible físicamente (mal conteo / recepción no registrada): se descarta.
  const anomalias = observaciones.filter((o) => o.consumo < 0).length;
  const validas = observaciones
    .filter((o) => o.consumo >= 0 && o.dias >= 1)
    .map((o) => ({ daily: o.consumo / o.dias, dias: o.dias }));
  const n = validas.length;

  if (n === 0) {
    return { consumoDiario: 0, sigmaDiario: 0, coberturaDias: 0, ciclos: 0, anomalias, z, stockObjetivo: 0, stockSeguridad: 0, nivelS: 0, confianza: 'sin_datos' };
  }

  // Ventana de protección: ciclo típico (mediana de días) + lead time, acotada.
  const cicloDias = clamp(mediana(validas.map((v) => v.dias)), p.coberturaMinDias, p.coberturaMaxDias);
  const P = cicloDias + p.leadTimeDias;

  // Pesos por recencia: la más reciente pesa 1, cada anterior ×lambda.
  const pesos = validas.map((_, i) => Math.pow(p.lambda, n - 1 - i));
  const sumaPesos = pesos.reduce((a, b) => a + b, 0);
  const mu = validas.reduce((acc, v, i) => acc + v.daily * pesos[i]!, 0) / sumaPesos;

  // Varianza ponderada (insesgada con pesos de frecuencia reducidos).
  let sigmaMedida = 0;
  if (n >= 2) {
    const varNum = validas.reduce((acc, v, i) => acc + pesos[i]! * (v.daily - mu) ** 2, 0);
    const denom = sumaPesos - pesos.reduce((a, b) => a + b * b, 0) / sumaPesos; // corrección de sesgo
    sigmaMedida = denom > 0 ? Math.sqrt(varNum / denom) : 0;
  }

  // Con pocos datos no podemos medir bien la variabilidad: inyectamos un prior (CV supuesto)
  // para garantizar colchón y "nunca quedarse sin stock". A más datos, domina lo medido.
  const sigmaPrior = mu * p.cvPrior;
  let sigma: number;
  if (n >= 6) sigma = sigmaMedida;
  else if (n >= 3) sigma = Math.max(sigmaMedida, 0.5 * sigmaPrior);
  else if (n === 2) sigma = Math.max(sigmaMedida, sigmaPrior);
  else sigma = sigmaPrior; // n === 1

  const stockObjetivo = r3(mu * P);
  const stockSeguridad = ceil3(z * sigma * Math.sqrt(P));
  return {
    consumoDiario: r3(mu),
    sigmaDiario: r3(sigma),
    coberturaDias: r3(P),
    ciclos: n,
    anomalias,
    z,
    stockObjetivo,
    stockSeguridad,
    nivelS: r3(stockObjetivo + stockSeguridad),
    confianza: confianzaDe(n),
  };
}
