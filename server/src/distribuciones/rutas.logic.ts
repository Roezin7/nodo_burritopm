// Lógica pura de rutas de entrega (sin DB). Decide el estado de una parada tras la
// entrega y el estado de la ruta a partir de sus paradas. Va testeada.

export type EstadoParada = 'pendiente' | 'en_camino' | 'entregada' | 'confirmada' | 'con_incidencia' | 'omitida';
export type EstadoRuta = 'planificada' | 'en_curso' | 'completada' | 'cerrada' | 'cancelada';

/** Una parada está "cerrada" para la operación cuando ya no espera al repartidor. */
export function paradaCerrada(estado: EstadoParada): boolean {
  return estado === 'entregada' || estado === 'confirmada' || estado === 'con_incidencia' || estado === 'omitida';
}

/**
 * Estado de la parada tras la entrega del repartidor.
 * - Sin ajuste (entrega completa de 1 toque) → "entregada".
 * - Con ajuste por "hubo un problema" (algún faltante respecto a lo cargado) → "con_incidencia".
 * - omitir=true (no se entregó) → "omitida".
 */
export function estadoTrasEntrega(opts: { omitida?: boolean; hayFaltante?: boolean }): EstadoParada {
  if (opts.omitida) return 'omitida';
  return opts.hayFaltante ? 'con_incidencia' : 'entregada';
}

/**
 * Estado de la ruta a partir de los estados de sus paradas:
 * - sin paradas → planificada
 * - todas cerradas → completada
 * - alguna abierta → en_curso (una vez despachada)
 */
export function estadoRutaDesdeParadas(estados: EstadoParada[], despachada: boolean): EstadoRuta {
  if (estados.length === 0) return 'planificada';
  if (estados.every(paradaCerrada)) return 'completada';
  return despachada ? 'en_curso' : 'planificada';
}

/** Marca como en_camino la primera parada pendiente (la "siguiente" del repartidor). */
export function siguienteParada<T extends { orden: number; estado: EstadoParada }>(paradas: T[]): T | null {
  return [...paradas].sort((a, b) => a.orden - b.orden).find((p) => p.estado === 'pendiente' || p.estado === 'en_camino') ?? null;
}

/** Normaliza el orden de las paradas a 1..n respetando el orden recibido (estable). */
export function normalizarOrden<T extends { ubicacion_id: number; orden: number }>(paradas: T[]): T[] {
  return [...paradas]
    .sort((a, b) => a.orden - b.orden)
    .map((p, i) => ({ ...p, orden: i + 1 }));
}
