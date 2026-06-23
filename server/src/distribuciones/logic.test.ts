import { describe, it, expect } from 'vitest';
import { sugerirEnvio, redondearAlMultiplo, valor } from './logic.js';

const base = { stock_objetivo: 8, stock_seguridad: 0, disponible: 3, en_transito: 0, multiplo_distribucion: 1, minimo_envio: 0 };

describe('sugerirEnvio', () => {
  it('objetivo 8 − disponible 3 = 5', () => {
    expect(sugerirEnvio(base)).toBe(5);
  });

  it('nunca negativa (disponible mayor al objetivo)', () => {
    expect(sugerirEnvio({ ...base, disponible: 12 })).toBe(0);
  });

  it('descuenta mercancía en tránsito', () => {
    // 8 + 0 − 3 − 1 = 4
    expect(sugerirEnvio({ ...base, en_transito: 1 })).toBe(4);
  });

  it('suma el stock de seguridad', () => {
    // 8 + 2 − 3 = 7
    expect(sugerirEnvio({ ...base, stock_seguridad: 2 })).toBe(7);
  });

  it('redondea hacia arriba al múltiplo de empaque', () => {
    // cruda = 8 − 3 = 5; múltiplo 4 → 8
    expect(sugerirEnvio({ ...base, multiplo_distribucion: 4 })).toBe(8);
  });

  it('respeta el mínimo de envío cuando la sugerencia es menor', () => {
    // cruda = 8 − 7 = 1; mínimo 6 → 6
    expect(sugerirEnvio({ ...base, disponible: 7, minimo_envio: 6 })).toBe(6);
  });

  it('admite cantidades decimales con múltiplo fraccionario', () => {
    // 2.5 − 1.25 = 1.25; múltiplo 0.25 → 1.25
    expect(sugerirEnvio({ ...base, stock_objetivo: 2.5, disponible: 1.25, multiplo_distribucion: 0.25 })).toBe(1.25);
  });

  it('con múltiplo 1 (unidades enteras) redondea hacia arriba un decimal', () => {
    // 2.5 − 1.25 = 1.25; múltiplo 1 → 2
    expect(sugerirEnvio({ ...base, stock_objetivo: 2.5, disponible: 1.25 })).toBe(2);
  });

  it('exactamente en el objetivo no sugiere nada', () => {
    expect(sugerirEnvio({ ...base, disponible: 8 })).toBe(0);
  });
});

describe('redondearAlMultiplo', () => {
  it('redondea hacia arriba', () => {
    expect(redondearAlMultiplo(5, 4)).toBe(8);
    expect(redondearAlMultiplo(8, 4)).toBe(8);
    expect(redondearAlMultiplo(0.1, 1)).toBe(1);
  });
  it('múltiplo 0 o 1 deja el número igual', () => {
    expect(redondearAlMultiplo(5, 1)).toBe(5);
    expect(redondearAlMultiplo(5, 0)).toBe(5);
  });
});

describe('valor', () => {
  it('cantidad × costo', () => {
    expect(valor(5, 8.5)).toBe(42.5);
  });
  it('sin costo => 0', () => {
    expect(valor(5, null)).toBe(0);
  });
});
