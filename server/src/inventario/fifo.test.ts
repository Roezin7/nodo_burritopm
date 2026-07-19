import { describe, expect, it } from 'vitest';
import { calcularConsumoFifo } from './fifo.js';

describe('calcularConsumoFifo', () => {
  it('consume un solo lote cuando alcanza', () => {
    const r = calcularConsumoFifo([{ cajas: 10, peso_lb: 500, costo: 100 }], 4);
    expect(r.cajas_faltantes).toBe(0);
    expect(r.consumos).toEqual([{ indice: 0, cajas: 4, peso: 200, costo: 40 }]);
    expect(r.peso_total).toBe(200);
    expect(r.costo_total).toBe(40);
  });

  it('consume varios lotes en orden (más antiguo primero) cuando el primero no alcanza', () => {
    const lotes = [
      { cajas: 3, peso_lb: 150, costo: 30 }, // más antiguo, primero en la lista
      { cajas: 10, peso_lb: 500, costo: 100 },
    ];
    const r = calcularConsumoFifo(lotes, 5);
    expect(r.cajas_faltantes).toBe(0);
    expect(r.consumos).toHaveLength(2);
    expect(r.consumos[0]).toEqual({ indice: 0, cajas: 3, peso: 150, costo: 30 });
    // Del segundo lote solo se toman 2 de 10 cajas (proporción 0.2): peso y costo proporcionales.
    expect(r.consumos[1]).toEqual({ indice: 1, cajas: 2, peso: 100, costo: 20 });
    expect(r.peso_total).toBe(250);
    expect(r.costo_total).toBe(50);
  });

  it('reporta cajas_faltantes cuando ningún lote alcanza para cubrir lo solicitado', () => {
    const r = calcularConsumoFifo([{ cajas: 2, peso_lb: 100, costo: 20 }], 5);
    expect(r.cajas_faltantes).toBe(3);
    expect(r.consumos).toEqual([{ indice: 0, cajas: 2, peso: 100, costo: 20 }]);
  });

  it('ignora lotes agotados (cajas en 0 o negativas) y sigue con el siguiente', () => {
    const lotes = [
      { cajas: 0, peso_lb: 0, costo: 0 },
      { cajas: -1, peso_lb: 0, costo: 0 }, // dato inconsistente defensivo: nunca debe restar
      { cajas: 5, peso_lb: 250, costo: 50 },
    ];
    const r = calcularConsumoFifo(lotes, 5);
    expect(r.cajas_faltantes).toBe(0);
    expect(r.consumos).toEqual([{ indice: 2, cajas: 5, peso: 250, costo: 50 }]);
  });

  it('no consume nada si no se solicitan cajas', () => {
    const r = calcularConsumoFifo([{ cajas: 10, peso_lb: 500, costo: 100 }], 0);
    expect(r.consumos).toEqual([]);
    expect(r.cajas_faltantes).toBe(0);
    expect(r.peso_total).toBe(0);
    expect(r.costo_total).toBe(0);
  });

  it('redondea a 3 decimales las cajas/peso y a 2 el costo por consumo', () => {
    const r = calcularConsumoFifo([{ cajas: 3, peso_lb: 100, costo: 33.333 }], 1);
    expect(r.consumos[0]!.cajas).toBe(1);
    // proporción 1/3: peso 33.333..., costo 11.111 → redondeados
    expect(r.consumos[0]!.peso).toBeCloseTo(33.333, 3);
    expect(r.consumos[0]!.costo).toBeCloseTo(11.11, 2);
  });

  it('consume exactamente el total disponible entre varios lotes sin dejar faltante', () => {
    const lotes = [
      { cajas: 2, peso_lb: 100, costo: 20 },
      { cajas: 3, peso_lb: 150, costo: 30 },
    ];
    const r = calcularConsumoFifo(lotes, 5);
    expect(r.cajas_faltantes).toBe(0);
    expect(r.consumos).toHaveLength(2);
    expect(r.consumos[1]!.cajas).toBe(3);
  });
});
