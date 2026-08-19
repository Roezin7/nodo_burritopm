import { describe, expect, it } from 'vitest';
import { fechaISOEnZona } from './semana-operativa.js';

describe('fecha operativa por zona horaria', () => {
  it('usa la fecha del negocio en el cambio de día', () => {
    const instante = new Date('2026-08-19T04:30:00.000Z');
    expect(fechaISOEnZona(instante, 'America/Chicago')).toBe('2026-08-18');
    expect(fechaISOEnZona(instante, 'America/Mexico_City')).toBe('2026-08-18');
  });

  it('no depende de la zona horaria local del servidor', () => {
    const instante = new Date('2026-08-19T06:30:00.000Z');
    expect(fechaISOEnZona(instante, 'America/Chicago')).toBe('2026-08-19');
    expect(fechaISOEnZona(instante, 'America/Los_Angeles')).toBe('2026-08-18');
  });
});
