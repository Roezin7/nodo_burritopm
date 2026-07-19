import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { calcularCoberturaBpm, calcularConsumoFifo, calcularCostoSalidaProduccion, calcularPrecioProteinaSemanal, calcularResumenProteina, fechasDespachables, precioVentaProducto, skuPastorParaEmpresa } from './service.js';
import { semanaDeFecha } from '../cierre/service.js';

const d = (n: number) => new Prisma.Decimal(n);

describe('cobertura configurada de BPM', () => {
  it('respeta rutas por día y puntos físicos de entrega compartidos', () => {
    const fechas = [new Date('2026-07-15T00:00:00.000Z'), new Date('2026-07-18T00:00:00.000Z')];
    const sucursales = [
      { id: 1n, nombre: 'Lombard', entrega_en_ubicacion_id: null },
      { id: 2n, nombre: 'Burlington', entrega_en_ubicacion_id: 3n },
      { id: 4n, nombre: 'Fuera de ruta', entrega_en_ubicacion_id: null },
    ];
    const paradas = new Map([[3, new Set(['1', '3'])], [6, new Set(['1'])]]);
    const presentes = new Set(['2026-07-15:1', '2026-07-18:1']);
    expect(calcularCoberturaBpm(fechas, sucursales, paradas, presentes)).toEqual([
      { fecha: '2026-07-15', total: 2, confirmados: 1, pendientes: ['Burlington'] },
      { fecha: '2026-07-18', total: 1, confirmados: 1, pendientes: [] },
    ]);
  });

  it('no bloquea la ruta externa del lunes por pedidos BPM del miércoles', () => {
    expect(fechasDespachables('2026-07-19', '2026-07-25', [
      { fecha: '2026-07-20', pendientes: [] },
      { fecha: '2026-07-22', pendientes: ['Lisle'] },
      { fecha: '2026-07-25', pendientes: ['Lisle'] },
    ])).toContain('2026-07-20');
    expect(fechasDespachables('2026-07-19', '2026-07-25', [
      { fecha: '2026-07-20', pendientes: [] },
      { fecha: '2026-07-22', pendientes: ['Lisle'] },
    ])).not.toContain('2026-07-22');
  });
});

describe('reglas de precio de carne', () => {
  it('suma $15 una sola vez a una proteína producida', () => {
    expect(precioVentaProducto({ tipo_operativo: 'proteina', precio_venta_fijo: null, ultimo_costo: d(123.45), costo_promedio: d(120), markup_caja: d(15) })).toBe(138.45);
    expect(precioVentaProducto({ tipo_operativo: 'proteina', precio_venta_fijo: null, ultimo_costo: d(203.04), costo_promedio: d(203.04), markup_caja: d(15) })).toBe(218.04);
  });

  it('usa el costo promedio ponderado de toda la producción semanal más $15', () => {
    expect(calcularPrecioProteinaSemanal(10, 1200)).toBe(135);
    expect(calcularPrecioProteinaSemanal(0, 0)).toBeNull();
  });

  it('separa costo total, costo por caja y venta por caja con markup fijo', () => {
    expect(calcularResumenProteina(10, 2030.4)).toEqual({
      cajas: 10,
      costo_total: 2030.4,
      costo_caja: 203.04,
      markup_caja: 15,
      precio_venta_caja: 218.04,
      venta_total: 2180.4,
    });
  });

  it('respeta el precio fijo sin aplicar markup', () => {
    expect(precioVentaProducto({ tipo_operativo: 'precio_fijo', precio_venta_fijo: d(90), ultimo_costo: d(75), costo_promedio: d(70), markup_caja: d(15) })).toBe(90);
  });

  it('deja pendiente un producto sin costo ni precio fijo', () => {
    expect(precioVentaProducto({ tipo_operativo: 'servicio', precio_venta_fijo: null, ultimo_costo: null, costo_promedio: null, markup_caja: d(0) })).toBeNull();
  });
});

describe('cierre operativo', () => {
  it('calcula semana 28 y su rango domingo-sábado', () => {
    const s = semanaDeFecha(new Date('2026-07-11T00:00:00.000Z'));
    expect(s.anio).toBe(2026);
    expect(s.semana).toBe(28);
    expect(s.domingo.toISOString().slice(0, 10)).toBe('2026-07-05');
    expect(s.sabado.toISOString().slice(0, 10)).toBe('2026-07-11');
  });

  it('abre la semana 30 el domingo 19 de julio', () => {
    const s = semanaDeFecha(new Date('2026-07-19T00:00:00.000Z'));
    expect(s.anio).toBe(2026);
    expect(s.semana).toBe(30);
    expect(s.domingo.toISOString().slice(0, 10)).toBe('2026-07-19');
    expect(s.sabado.toISOString().slice(0, 10)).toBe('2026-07-25');
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
