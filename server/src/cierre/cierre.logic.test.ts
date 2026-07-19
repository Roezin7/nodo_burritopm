import { describe, expect, it } from 'vitest';
import { distribuirCreditosCliente, inicioVentanaCuentasPorCobrar, numeroFactura } from './service.js';

describe('folios de cierre semanal', () => {
  it('no colisiona sucursales cuyos códigos comparten los primeros cinco caracteres', () => {
    const naperville = numeroFactura(2026, 29, 'BPM', 'NAPER', 'carne');
    const napervilleDos = numeroFactura(2026, 29, 'BPM', 'NAPER2', 'carne');

    expect(naperville).toBe('2026-29-BPM-NAPER-M');
    expect(napervilleDos).toBe('2026-29-BPM-NAPER2-M');
    expect(napervilleDos).not.toBe(naperville);
  });
});

describe('créditos por ubicación', () => {
  const fecha = new Date('2026-07-18T00:00:00.000Z');

  it('compensa el crédito negativo de Lisle contra otra factura de Lisle', () => {
    const resultado = distribuirCreditosCliente([
      { id: 'lisle-carne', ubicacion_id: 'lisle', semana_id: '29', emitida_at: fecha, total: -60.78, pagado: 0 },
      { id: 'lisle-desechables', ubicacion_id: 'lisle', semana_id: '29', emitida_at: fecha, total: 1332.31, pagado: 0 },
    ]);

    expect(resultado.saldos.get('lisle-desechables')).toBe(1271.53);
    expect(resultado.creditoAplicado.get('lisle-desechables')).toBe(60.78);
    expect(resultado.creditoDisponible).toBe(0);
  });

  it('nunca aplica el crédito de Lisle a otro restaurante', () => {
    const resultado = distribuirCreditosCliente([
      { id: 'credito-lisle', ubicacion_id: 'lisle', semana_id: '29', emitida_at: fecha, total: -100, pagado: 0 },
      { id: 'lombard', ubicacion_id: 'lombard', semana_id: '29', emitida_at: fecha, total: 250, pagado: 0 },
    ]);

    expect(resultado.saldos.get('lombard')).toBe(250);
    expect(resultado.creditoDisponiblePorUbicacion.get('lisle')).toBe(100);
  });

  it('mantiene cubierto el remanente nominal después de cobrar el saldo neto', () => {
    const resultado = distribuirCreditosCliente([
      { id: 'credito-lisle', ubicacion_id: 'lisle', semana_id: '29', emitida_at: fecha, total: -60.78, pagado: 0 },
      { id: 'factura-lisle', ubicacion_id: 'lisle', semana_id: '29', emitida_at: fecha, total: 1332.31, pagado: 1271.53 },
    ]);

    expect(resultado.saldos.get('factura-lisle')).toBe(0);
    expect(resultado.creditoDisponible).toBe(0);
  });
});

describe('ventana móvil de cuentas por cobrar', () => {
  it('incluye la semana del cierre y exactamente las dos anteriores', () => {
    expect(inicioVentanaCuentasPorCobrar(new Date('2026-07-12T00:00:00.000Z')).toISOString().slice(0, 10)).toBe('2026-06-28');
    expect(inicioVentanaCuentasPorCobrar(new Date('2026-07-19T00:00:00.000Z')).toISOString().slice(0, 10)).toBe('2026-07-05');
  });
});
