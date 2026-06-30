import { describe, it, expect } from 'vitest';
import { calcularStockObjetivo, zDeNivelServicio, type ObservacionConsumo } from './stockObjetivo.logic.js';

describe('zDeNivelServicio', () => {
  it('mapea niveles de servicio comunes al cuantil normal', () => {
    expect(zDeNivelServicio(50)).toBeCloseTo(0, 2);
    expect(zDeNivelServicio(90)).toBeCloseTo(1.282, 2);
    expect(zDeNivelServicio(95)).toBeCloseTo(1.645, 2);
    expect(zDeNivelServicio(97.5)).toBeCloseTo(1.96, 2);
    expect(zDeNivelServicio(99)).toBeCloseTo(2.326, 2);
  });
  it('acota a [50%, 99.9%] y nunca es negativo', () => {
    expect(zDeNivelServicio(10)).toBe(0);
    expect(zDeNivelServicio(99.99)).toBeGreaterThan(2.5);
  });
});

const ciclos = (consumos: number[], dias = 7): ObservacionConsumo[] => consumos.map((c) => ({ consumo: c, dias }));

describe('calcularStockObjetivo', () => {
  it('sin observaciones → sin_datos y ceros', () => {
    const r = calcularStockObjetivo([]);
    expect(r.confianza).toBe('sin_datos');
    expect(r.stockObjetivo).toBe(0);
    expect(r.stockSeguridad).toBe(0);
  });

  it('demanda estable → objetivo ≈ μ·P y seguridad pequeña', () => {
    // 8 ciclos de 7 días consumiendo 70 c/u → 10/día. P = 7 + 1 = 8.
    const r = calcularStockObjetivo(ciclos([70, 70, 70, 70, 70, 70, 70, 70]), { leadTimeDias: 1 });
    expect(r.consumoDiario).toBeCloseTo(10, 1);
    expect(r.coberturaDias).toBeCloseTo(8, 1);
    expect(r.stockObjetivo).toBeCloseTo(80, 0);
    expect(r.stockSeguridad).toBeLessThan(5); // demanda sin varianza → colchón mínimo
    expect(r.confianza).toBe('alta');
  });

  it('demanda volátil → mayor stock de seguridad que una estable con misma media', () => {
    // Serie volátil simétrica (termina en la media) para que la recencia no sesgue μ.
    const estable = calcularStockObjetivo(ciclos([70, 70, 70, 70, 70, 70]));
    const volatil = calcularStockObjetivo(ciclos([120, 20, 110, 30, 100, 70]));
    expect(Math.abs(volatil.consumoDiario - estable.consumoDiario)).toBeLessThan(2.5);
    expect(volatil.stockSeguridad).toBeGreaterThan(estable.stockSeguridad);
  });

  it('mayor nivel de servicio → mayor stock de seguridad', () => {
    const obs = ciclos([50, 90, 60, 100, 70, 80]);
    const s95 = calcularStockObjetivo(obs, { nivelServicio: 95 });
    const s99 = calcularStockObjetivo(obs, { nivelServicio: 99 });
    expect(s99.stockSeguridad).toBeGreaterThan(s95.stockSeguridad);
  });

  it('descarta consumos negativos como anomalías', () => {
    const r = calcularStockObjetivo(ciclos([70, -5, 70, 70]));
    expect(r.anomalias).toBe(1);
    expect(r.ciclos).toBe(3);
  });

  it('con un solo dato usa un prior de variabilidad (colchón > 0)', () => {
    const r = calcularStockObjetivo(ciclos([70]));
    expect(r.ciclos).toBe(1);
    expect(r.confianza).toBe('baja');
    expect(r.stockSeguridad).toBeGreaterThan(0);
  });

  it('pondera por recencia: una subida reciente sostenida sube μ', () => {
    const viejaBaja = calcularStockObjetivo(ciclos([20, 20, 20, 20, 100, 100, 100, 100]));
    const planoMedio = calcularStockObjetivo(ciclos([60, 60, 60, 60, 60, 60, 60, 60]));
    expect(viejaBaja.consumoDiario).toBeGreaterThan(planoMedio.consumoDiario);
  });

  it('normaliza por días: ciclos largos no inflan el consumo diario', () => {
    const r = calcularStockObjetivo([
      { consumo: 140, dias: 14 },
      { consumo: 70, dias: 7 },
      { consumo: 30, dias: 3 },
    ]);
    expect(r.consumoDiario).toBeCloseTo(10, 1);
  });
});
