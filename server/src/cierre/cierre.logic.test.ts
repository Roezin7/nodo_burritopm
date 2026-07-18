import { describe, expect, it } from 'vitest';
import { numeroFactura } from './service.js';

describe('folios de cierre semanal', () => {
  it('no colisiona sucursales cuyos códigos comparten los primeros cinco caracteres', () => {
    const naperville = numeroFactura(2026, 29, 'BPM', 'NAPER', 'carne');
    const napervilleDos = numeroFactura(2026, 29, 'BPM', 'NAPER2', 'carne');

    expect(naperville).toBe('2026-29-BPM-NAPER-M');
    expect(napervilleDos).toBe('2026-29-BPM-NAPER2-M');
    expect(napervilleDos).not.toBe(naperville);
  });
});
