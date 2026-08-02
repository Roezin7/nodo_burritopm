import { describe, expect, it } from 'vitest';
import { aperturaConDatos, calcularFilaConciliacion, calcularSaldoSemanal, normalizarSaldoApertura, rangoSemana } from './conciliacion.js';

describe('conciliación semanal de inventario', () => {
  it('aísla desechables a apertura + entradas − salidas del periodo', () => {
    expect(calcularSaldoSemanal(100, 25, 40)).toBe(85);
  });

  it('no interpreta una fotografía financiera sin renglones como inventario en cero', () => {
    expect(aperturaConDatos(new Map())).toBe(false);
    expect(aperturaConDatos(new Map([['producto', 0]]))).toBe(true);
  });

  it('incluye el domingo dentro de la semana que cierra el sábado siguiente', () => {
    expect(rangoSemana('2026-07-19')).toEqual({
      desde: '2026-07-19',
      hasta: '2026-07-25',
      corteMiercoles: '2026-07-22',
    });
    expect(rangoSemana('2026-07-22')).toEqual({
      desde: '2026-07-19',
      hasta: '2026-07-25',
      corteMiercoles: '2026-07-22',
    });
  });

  it('calcula los cortes de miércoles y sábado en orden operativo', () => {
    const r = calcularFilaConciliacion({
      inicial: 20,
      actual: 12,
      fisicoFinal: 11,
      compras1: 0,
      compras2: 0,
      produccionEntrada1: 0,
      produccionEntrada2: 0,
      produccionSalida1: 15,
      produccionSalida2: 8,
      salidas1: 10,
      salidas2: 21,
      pedidos1: 10,
      pedidos2: 21,
    });
    expect(r.saldoMiercoles).toBe(25);
    expect(r.teoricoFinal).toBe(12);
    expect(r.diferenciaFinal).toBe(-1);
  });

  it('trata el consumo de materia prima como salida de producción', () => {
    const r = calcularFilaConciliacion({
      inicial: 25,
      actual: 14,
      fisicoFinal: 13,
      compras1: 5,
      compras2: 4,
      produccionEntrada1: 12,
      produccionEntrada2: 8,
      produccionSalida1: 0,
      produccionSalida2: 0,
      salidas1: 0,
      salidas2: 0,
      pedidos1: 0,
      pedidos2: 0,
    });
    expect(r.saldoMiercoles).toBe(18);
    expect(r.teoricoFinal).toBe(14);
    expect(r.diferenciaFinal).toBe(-1);
  });

  it('no arrastra un faltante negativo como inventario inicial de la semana siguiente', () => {
    expect(normalizarSaldoApertura(-7.25)).toBe(0);
    expect(normalizarSaldoApertura(12.3454)).toBe(12.345);
  });

  it('aísla el saldo semanal aunque el inventario vivo ya tenga movimientos posteriores', () => {
    const base = {
      inicial: 10,
      fisicoFinal: null,
      compras1: 0,
      compras2: 0,
      produccionEntrada1: 0,
      produccionEntrada2: 0,
      produccionSalida1: 20,
      produccionSalida2: 0,
      salidas1: 8,
      salidas2: 7,
      pedidos1: 8,
      pedidos2: 7,
    };

    expect(calcularFilaConciliacion({ ...base, actual: 15 }).teoricoFinal).toBe(15);
    // La semana siguiente ya consumió 12 cajas y el saldo vivo bajó a 3.
    expect(calcularFilaConciliacion({ ...base, actual: 3 }).teoricoFinal).toBe(15);
  });
});
