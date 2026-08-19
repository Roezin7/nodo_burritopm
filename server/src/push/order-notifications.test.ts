import { describe, expect, it } from 'vitest';
import { diferenciasPedido } from './order-notifications.js';

const detalle = (product_id: number, nombre: string, cantidad: number, notas: string | null = null) => ({ product_id, nombre, cantidad, notas });

describe('diferencias de pedidos para notificaciones', () => {
  it('ignora reordenamientos y guardados idénticos', () => {
    expect(diferenciasPedido(
      [detalle(2, 'B', 3), detalle(1, 'A', 2)],
      [detalle(1, 'A', 2), detalle(2, 'B', 3)],
    )).toEqual([]);
  });

  it('detecta altas, bajas y cambios de cantidad', () => {
    expect(diferenciasPedido(
      [detalle(1, 'A', 2), detalle(2, 'B', 4)],
      [detalle(1, 'A', 5), detalle(3, 'C', 1)],
    )).toEqual([
      { product_id: 1, nombre: 'A', anterior: 2, nuevo: 5, notas_anteriores: null, notas_nuevas: null },
      { product_id: 2, nombre: 'B', anterior: 4, nuevo: 0, notas_anteriores: null, notas_nuevas: null },
      { product_id: 3, nombre: 'C', anterior: 0, nuevo: 1, notas_anteriores: null, notas_nuevas: null },
    ]);
  });

  it('detecta cambios de notas aunque la cantidad no cambie', () => {
    expect(diferenciasPedido(
      [detalle(1, 'A', 2, 'sin salsa')],
      [detalle(1, 'A', 2, 'extra salsa')],
    )).toEqual([
      { product_id: 1, nombre: 'A', anterior: 2, nuevo: 2, notas_anteriores: 'sin salsa', notas_nuevas: 'extra salsa' },
    ]);
  });
});
