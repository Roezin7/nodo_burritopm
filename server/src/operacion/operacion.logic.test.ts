import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { calcularConsumoFifo, calcularCostoSalidaProduccion, calcularPrecioProteinaSemanal, precioVentaProducto, skuPastorParaEmpresa } from './service.js';
import { semanaDeFecha } from '../cierre/service.js';

const d = (n: number) => new Prisma.Decimal(n);

describe('reglas de precio de carne', () => {
  it('suma $15 una sola vez a una proteína producida', () => {
    expect(precioVentaProducto({ tipo_operativo: 'proteina', precio_venta_fijo: null, ultimo_costo: d(123.45), costo_promedio: d(120), markup_caja: d(15) })).toBe(138.45);
  });

  it('usa el costo promedio ponderado de toda la producción semanal más $15', () => {
    expect(calcularPrecioProteinaSemanal(10, 1200, 15)).toBe(135);
    expect(calcularPrecioProteinaSemanal(0, 0, 15)).toBeNull();
  });

  it('respeta el precio fijo sin aplicar markup', () => {
    expect(precioVentaProducto({ tipo_operativo: 'precio_fijo', precio_venta_fijo: d(90), ultimo_costo: d(75), costo_promedio: d(70), markup_caja: d(15) })).toBe(90);
  });

  it('deja pendiente un producto sin costo ni precio fijo', () => {
    expect(precioVentaProducto({ tipo_operativo: 'servicio', precio_venta_fijo: null, ultimo_costo: null, costo_promedio: null, markup_caja: d(0) })).toBeNull();
  });
});

describe('cierre operativo', () => {
  it('calcula semana ISO 28 y su rango lunes-sábado', () => {
    const s = semanaDeFecha(new Date('2026-07-11T00:00:00.000Z'));
    expect(s.anio).toBe(2026);
    expect(s.semana).toBe(28);
    expect(s.lunes.toISOString().slice(0, 10)).toBe('2026-07-06');
    expect(s.sabado.toISOString().slice(0, 10)).toBe('2026-07-11');
  });
});

describe('materia prima con cajas de peso variable', () => {
  it('consume el peso y costo reales de cada lote en orden FIFO', () => {
    const calculo = calcularConsumoFifo([
      { cajas: 2, peso_lb: 140, costo: 350 },
      { cajas: 3, peso_lb: 180, costo: 450 },
    ], 3);

    expect(calculo.cajas_faltantes).toBe(0);
    expect(calculo.peso_total).toBe(200);
    expect(calculo.costo_total).toBe(500);
    expect(calculo.consumos).toEqual([
      { indice: 0, cajas: 2, peso: 140, costo: 350 },
      { indice: 1, cajas: 1, peso: 60, costo: 150 },
    ]);
  });

  it('prorratea una caja parcial dentro del lote correspondiente', () => {
    const calculo = calcularConsumoFifo([{ cajas: 4, peso_lb: 286, costo: 720 }], 1.5);
    expect(calculo.peso_total).toBe(107.25);
    expect(calculo.costo_total).toBe(270);
  });
});

describe('subproducto de carnitas', () => {
  it('deja Carnitas sin costo y conserva todo el costo en Pastor', () => {
    const pastor = calcularCostoSalidaProduccion(3280.47, 1380, 1380, 69);
    const carnitas = calcularCostoSalidaProduccion(3280.47, 1380, 0, 25);

    expect(pastor.costoTotal).toBe(3280.47);
    expect(pastor.costoUnidad).toBe(47.543);
    expect(carnitas).toEqual({ costoTotal: 0, costoUnidad: 0 });
  });
});

describe('pastor por empresa', () => {
  it('usa el producto exclusivo de Tapatíos para LBT', () => {
    expect(skuPastorParaEmpresa('LBT')).toBe('MEAT-PASTOR-TAP');
  });

  it('conserva el pastor regular para BPM y Aurora', () => {
    expect(skuPastorParaEmpresa('BPM')).toBe('MEAT-PASTOR-BPM');
    expect(skuPastorParaEmpresa('AUR')).toBe('MEAT-PASTOR-BPM');
  });
});
