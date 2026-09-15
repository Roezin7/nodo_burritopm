import { describe, expect, it } from 'vitest';
import { conciliarLineaTemporal, type EventoInventario } from './conciliacion-semanal.js';

const e = (fecha: string, tipo: EventoInventario['tipo'], cantidad: number, documento = tipo): EventoInventario => ({ producto: 'taco', fecha, tipo, cantidad, documento });
const semana = ['2026-09-06', '2026-09-12'] as const;

describe('herencia y ecuación de inventario por fecha operativa', () => {
  it('explica las 10 cajas de apertura, compra y consumo de 10 y físico final de 5', () => {
    const r = conciliarLineaTemporal([
      e('2026-09-05', 'snapshot', 2), e('2026-09-06', 'apertura', 10),
      e('2026-09-07', 'compra', 10), e('2026-09-12', 'consumo_produccion', -10),
      e('2026-09-12', 'fisico', 5),
    ], ...semana, 5);
    expect(r.inicial).toBe(10);
    expect(r.ajuste_apertura).toBe(8);
    expect(r.teoricoFinal).toBe(10);
    expect(r.diferenciaFinal).toBe(-5);
    expect(r.saldoOperativoFinal).toBe(5);
    expect(r.diferencia_ledger).toBe(0);
  });

  it('actualiza una apertura automática futura y conserva la actividad de las semanas intermedias', () => {
    const r = conciliarLineaTemporal([
      e('2026-09-12', 'fisico', 5), e('2026-09-15', 'compra', 7),
      e('2026-09-18', 'despacho', -3), e('2026-09-20', 'heredado', 2),
    ], '2026-09-20', '2026-09-26', 9);
    expect(r.inicial).toBe(9);
    expect(r.apertura_registrada).toBe(2);
    expect(r.saldoOperativoFinal).toBe(9);
    expect(r.diferencia_ledger).toBe(0);
  });

  it('conserva el saldo histórico y explica movimientos posteriores a un físico', () => {
    const r = conciliarLineaTemporal([
      e('2026-09-06', 'apertura', 10), e('2026-09-12', 'fisico', 5),
      e('2026-09-14', 'compra', 7), e('2026-09-16', 'despacho', -3),
    ], ...semana, 9);
    expect(r.saldoOperativoFinal).toBe(5);
    expect(r.movimientos_posteriores).toBe(4);
    expect(r.saldo_actual_esperado).toBe(9);
    expect(r.diferencia_ledger).toBe(0);
  });

  it('un físico a mitad de semana no borra las operaciones posteriores', () => {
    const r = conciliarLineaTemporal([
      e('2026-09-06', 'apertura', 10), e('2026-09-09', 'fisico', 8),
      e('2026-09-10', 'ingreso', 4), e('2026-09-12', 'retiro', -3),
    ], ...semana, 9);
    expect(r.fisico_final).toBe(8);
    expect(r.diferenciaFinal).toBe(-2);
    expect(r.saldoOperativoFinal).toBe(9);
    expect(r.teoricoFinal + r.ajustes_fisicos).toBe(r.saldoOperativoFinal);
  });

  it('el cero contado es evidencia y puede producir un saldo final sin ninguna otra actividad', () => {
    expect(conciliarLineaTemporal([e('2026-09-06', 'apertura', 10), e('2026-09-12', 'fisico', 0)], ...semana, 0).saldoOperativoFinal).toBe(0);
    expect(conciliarLineaTemporal([e('2026-09-06', 'apertura', 0), e('2026-09-12', 'fisico', 5)], ...semana, 5).saldoOperativoFinal).toBe(5);
  });

  it('un saldo vivo distinto de la ecuación se reporta sin ocultar la diferencia', () => {
    const r = conciliarLineaTemporal([e('2026-09-06', 'apertura', 10)], ...semana, 2);
    expect(r.saldo_actual_esperado).toBe(10);
    expect(r.diferencia_ledger).toBe(-8);
  });

  it('conserva la política de registrar el faltante en su semana y heredar cero', () => {
    const eventos = [e('2026-09-06', 'apertura', 2), e('2026-09-12', 'despacho', -5)];
    expect(conciliarLineaTemporal(eventos, ...semana, -3).saldoOperativoFinal).toBe(-3);
    expect(conciliarLineaTemporal(eventos, '2026-09-13', '2026-09-19', -3).inicial).toBe(0);
  });

  it('una apertura automática futura no regulariza por sí sola un faltante vivo', () => {
    const r = conciliarLineaTemporal([e('2026-09-06', 'apertura', 2), e('2026-09-12', 'despacho', -5), e('2026-09-20', 'heredado', 0)], ...semana, -3);
    expect(r.saldoOperativoFinal).toBe(-3);
    expect(r.saldo_actual_esperado).toBe(-3);
    expect(r.diferencia_ledger).toBe(0);
  });
});
