import { describe, it, expect } from 'vitest';
import {
  paradaCerrada,
  estadoTrasEntrega,
  estadoRutaDesdeParadas,
  siguienteParada,
  normalizarOrden,
  type EstadoParada,
} from './rutas.logic.js';

describe('paradaCerrada', () => {
  it('entregada/confirmada/con_incidencia/omitida están cerradas', () => {
    for (const e of ['entregada', 'confirmada', 'con_incidencia', 'omitida'] as EstadoParada[]) {
      expect(paradaCerrada(e)).toBe(true);
    }
  });
  it('pendiente y en_camino siguen abiertas', () => {
    expect(paradaCerrada('pendiente')).toBe(false);
    expect(paradaCerrada('en_camino')).toBe(false);
  });
});

describe('estadoTrasEntrega', () => {
  it('entrega de 1 toque sin faltante → entregada', () => {
    expect(estadoTrasEntrega({})).toBe('entregada');
  });
  it('con faltante reportado → con_incidencia', () => {
    expect(estadoTrasEntrega({ hayFaltante: true })).toBe('con_incidencia');
  });
  it('omitir gana sobre faltante → omitida', () => {
    expect(estadoTrasEntrega({ omitida: true, hayFaltante: true })).toBe('omitida');
  });
});

describe('estadoRutaDesdeParadas', () => {
  it('sin paradas → planificada', () => {
    expect(estadoRutaDesdeParadas([], true)).toBe('planificada');
  });
  it('todas cerradas → completada', () => {
    expect(estadoRutaDesdeParadas(['entregada', 'confirmada', 'con_incidencia'], true)).toBe('completada');
  });
  it('despachada con alguna abierta → en_curso', () => {
    expect(estadoRutaDesdeParadas(['entregada', 'pendiente'], true)).toBe('en_curso');
  });
  it('no despachada → planificada aunque haya paradas', () => {
    expect(estadoRutaDesdeParadas(['pendiente', 'pendiente'], false)).toBe('planificada');
  });
});

describe('siguienteParada', () => {
  it('toma la primera parada pendiente por orden, ignorando entregadas', () => {
    const paradas = [
      { orden: 2, estado: 'pendiente' as EstadoParada, n: 'B' },
      { orden: 1, estado: 'entregada' as EstadoParada, n: 'A' },
      { orden: 3, estado: 'pendiente' as EstadoParada, n: 'C' },
    ];
    expect(siguienteParada(paradas)?.n).toBe('B');
  });
  it('null cuando todas están cerradas', () => {
    expect(siguienteParada([{ orden: 1, estado: 'confirmada' as EstadoParada }])).toBeNull();
  });
});

describe('normalizarOrden', () => {
  it('reescribe el orden a 1..n respetando el orden recibido', () => {
    const r = normalizarOrden([
      { ubicacion_id: 10, orden: 5 },
      { ubicacion_id: 20, orden: 2 },
      { ubicacion_id: 30, orden: 9 },
    ]);
    expect(r).toEqual([
      { ubicacion_id: 20, orden: 1 },
      { ubicacion_id: 10, orden: 2 },
      { ubicacion_id: 30, orden: 3 },
    ]);
  });
});
