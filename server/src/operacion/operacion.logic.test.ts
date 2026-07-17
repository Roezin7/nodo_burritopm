import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { precioVentaProducto } from './service.js';
import { semanaDeFecha } from '../cierre/service.js';

const d = (n: number) => new Prisma.Decimal(n);

describe('reglas de precio de carne', () => {
  it('suma $15 una sola vez a una proteína producida', () => {
    expect(precioVentaProducto({ tipo_operativo: 'proteina', precio_venta_fijo: null, ultimo_costo: d(123.45), costo_promedio: d(120), markup_caja: d(15) })).toBe(138.45);
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
