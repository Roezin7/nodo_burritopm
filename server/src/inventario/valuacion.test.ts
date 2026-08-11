import { describe, expect, it } from 'vitest';
import { costoParaValuacionInventario, valorExistencia } from './valuacion.js';

describe('valuación uniforme de inventario', () => {
  it('prioriza el costo guardado en la existencia', () => {
    expect(costoParaValuacionInventario(10, 12, 14)).toBe(10);
  });

  it('usa el costo promedio del producto cuando falta el costo de la fila', () => {
    expect(costoParaValuacionInventario(null, 22.95, 24)).toBe(22.95);
  });

  it('usa el último costo como último respaldo', () => {
    expect(costoParaValuacionInventario(null, null, 18.5)).toBe(18.5);
  });

  it('incluye disponible y tránsito con sus respectivos costos', () => {
    expect(valorExistencia(10, 2, null, 9, 12, 14)).toBe(138);
  });
});
