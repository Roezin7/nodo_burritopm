export type LineaOperacion = 'carne' | 'desechables';

export interface ProductoOrdenable {
  id: number;
  sku: string;
  nombre: string;
  linea: LineaOperacion;
  tipo: string;
  /** Orden maestro proveniente del catálogo/Excel. */
  orden?: number;
  /** Si existe, la configuración explícita de sucursal limita dónde se pide. */
  ubicaciones_habilitadas?: number[];
}

export interface FilaOrden {
  nombre: string;
  skus: readonly string[];
}

export const FILAS_CARNE: readonly FilaOrden[] = [
  { nombre: 'STEAK TACO', skus: ['MEAT-STEAK'] },
  { nombre: 'CHICKEN', skus: ['MEAT-CHICKEN'] },
  { nombre: 'ALPASTOR', skus: ['MEAT-PASTOR-BPM', 'MEAT-PASTOR-TAP'] },
  { nombre: 'CARNE ASADA', skus: ['MEAT-ASADA'] },
  { nombre: 'FAJITAS', skus: ['MEAT-FAJITAS'] },
  { nombre: 'MILANESA', skus: ['MEAT-MILANESA'] },
  { nombre: 'TAMAL ROJO', skus: ['MEAT-TAMAL'] },
  { nombre: 'CHILE RELLENO', skus: ['MEAT-CHILE'] },
  { nombre: 'TACO DORADO', skus: ['MEAT-DORADO'] },
  { nombre: 'ADOBO PICADILLO', skus: ['MEAT-ADOBO'] },
  { nombre: 'CARNITAS', skus: ['MEAT-CARNITAS'] },
  { nombre: 'CATERING', skus: ['MEAT-CATERING'] },
  { nombre: 'FOIL 12X1000', skus: ['BPM-0019'] },
  { nombre: 'THREE COMP CONT', skus: ['BPM-0047'] },
  { nombre: 'ONE COMP CONT', skus: ['BPM-0048'] },
  { nombre: 'SUIZO CONT', skus: ['BPM-0049'] },
  { nombre: 'THERMAL PAPER', skus: ['BPM-0020'] },
  { nombre: 'COCO LOPEZ', skus: ['BPM-0029'] },
  { nombre: 'XL NITRILE GLOVES', skus: ['BPM-0017'] },
  { nombre: 'CUP HOLDER', skus: ['BPM-0008'] },
  { nombre: 'TAPATIOS TACO M', skus: ['MEAT-TAPATIOS-TACO'] },
] as const;

// El formato de inventario de la semana 34 contiene 54 productos. Los SKU
// BPM-0047..0052 ya existen en históricos y por eso se conservan; los dos
// productos nuevos se muestran en la posición que ocupa el Excel mediante
// BPM-0053 y BPM-0054, sin renumerar el catálogo anterior.
export const FILAS_DESECHABLES: readonly FilaOrden[] = [
  ...Array.from({ length: 46 }, (_, i) => ({ nombre: '', skus: [`BPM-${String(i + 1).padStart(4, '0')}`] })),
  { nombre: '', skus: ['BPM-0053'] },
  { nombre: '', skus: ['BPM-0054'] },
  ...Array.from({ length: 6 }, (_, i) => ({ nombre: '', skus: [`BPM-${String(i + 47).padStart(4, '0')}`] })),
] as const;

export function filasOrden(linea: LineaOperacion, productos: ProductoOrdenable[]): FilaOrden[] {
  if (linea === 'carne') {
    const porSku = new Map(productos.map((p) => [p.sku, p]));
    const conocidos = new Set(FILAS_CARNE.flatMap((fila) => fila.skus));
    const filasConOrden = FILAS_CARNE
      .map((fila, indice) => {
        const encontrados = fila.skus.map((sku) => porSku.get(sku)).filter((p): p is ProductoOrdenable => Boolean(p));
        return { fila, indice, orden: encontrados.length ? Math.min(...encontrados.map((p) => p.orden ?? 999)) : 999 };
      })
      .filter(({ fila }) => fila.skus.some((sku) => porSku.has(sku)));
    const adicionales = productos
      .filter((p) => p.linea === 'carne' && p.tipo !== 'materia_prima' && !conocidos.has(p.sku))
      .map((p, indice) => ({ fila: { nombre: p.nombre.toUpperCase(), skus: [p.sku] }, indice: FILAS_CARNE.length + indice, orden: p.orden ?? 999 }));
    return [...filasConOrden, ...adicionales]
      .sort((a, b) => a.orden - b.orden || a.indice - b.indice)
      .map(({ fila }) => fila);
  }
  const catalogo = productos
    .filter((p) => p.linea === 'desechables' && p.tipo !== 'materia_prima')
    .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999) || a.nombre.localeCompare(b.nombre, 'es') || a.sku.localeCompare(b.sku));
  if (catalogo.length) return catalogo.map((p) => ({ nombre: p.nombre.toUpperCase(), skus: [p.sku] }));
  const porSku = new Map(productos.map((p) => [p.sku, p]));
  // Compatibilidad con catálogos antiguos que todavía no exponen productos/orden.
  return FILAS_DESECHABLES.map((f) => ({ ...f, nombre: porSku.get(f.skus[0])?.nombre.toUpperCase() ?? f.skus[0] }));
}

export function nombreEnOrden(sku: string, nombre: string, linea: LineaOperacion): string {
  if (linea === 'carne') {
    const fila = FILAS_CARNE.find((f) => f.skus.includes(sku));
    if (fila) return fila.nombre;
  }
  return nombre.toUpperCase();
}

/** En captura se distingue el producto; los formatos impresos conservan ALPASTOR. */
export function nombreEnVenta(sku: string, nombre: string, linea: LineaOperacion): string {
  if (linea === 'carne' && sku === 'MEAT-PASTOR-TAP') return 'PASTOR TAPATÍOS';
  return nombreEnOrden(sku, nombre, linea);
}

export function productosParaPedido<T extends ProductoOrdenable>(productos: T[], linea: LineaOperacion, empresaCodigo?: string, ubicacionId?: number): T[] {
  const disponibles = productos.filter((p) => !p.ubicaciones_habilitadas || ubicacionId == null || p.ubicaciones_habilitadas.includes(ubicacionId));
  if (linea === 'desechables') {
    return disponibles
      .filter((p) => p.linea === 'desechables' && p.tipo !== 'materia_prima')
      .sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999) || a.nombre.localeCompare(b.nombre, 'es') || a.sku.localeCompare(b.sku));
  }
  const porSku = new Map(disponibles.map((p) => [p.sku, p]));
  const filas = filasOrden(linea, disponibles);
  const resultado: T[] = [];
  for (const fila of filas) {
    const esConsumibleExclusivoTapatios = fila.skus.includes('BPM-0017') || fila.skus.includes('BPM-0008');
    if (esConsumibleExclusivoTapatios && empresaCodigo !== 'LBT') continue;
    const esPastor = fila.skus.includes('MEAT-PASTOR-BPM') || fila.skus.includes('MEAT-PASTOR-TAP');
    const skus = esPastor
      ? [empresaCodigo === 'LBT' ? 'MEAT-PASTOR-TAP' : 'MEAT-PASTOR-BPM']
      : fila.skus;
    const producto = skus.map((sku) => porSku.get(sku)).find((p): p is T => p != null);
    if (producto && producto.tipo !== 'materia_prima') resultado.push(producto);
  }
  return resultado;
}

export function indiceEnOrden(sku: string, linea: LineaOperacion): number {
  const filas = linea === 'carne' ? FILAS_CARNE : FILAS_DESECHABLES;
  const indice = filas.findIndex((f) => f.skus.includes(sku));
  return indice >= 0 ? indice : 999;
}
