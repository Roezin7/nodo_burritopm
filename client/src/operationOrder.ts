export type LineaOperacion = 'carne' | 'desechables';

export interface ProductoOrdenable {
  id: number;
  sku: string;
  nombre: string;
  linea: LineaOperacion;
  tipo: string;
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
  { nombre: 'TAPATIOS TACO M', skus: ['MEAT-TAPATIOS-TACO'] },
] as const;

// El formato completo de Disposables contiene los 52 productos de la hoja semanal.
// Se reutilizan los mismos SKU de los consumibles que también aparecen en carne;
// nunca se crean productos duplicados en el catálogo.
export const FILAS_DESECHABLES: readonly FilaOrden[] = Array.from({ length: 52 }, (_, i) => ({
  nombre: '',
  skus: [`BPM-${String(i + 1).padStart(4, '0')}`],
}));

export function filasOrden(linea: LineaOperacion, productos: ProductoOrdenable[]): FilaOrden[] {
  if (linea === 'carne') return [...FILAS_CARNE];
  const porSku = new Map(productos.map((p) => [p.sku, p]));
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

export function productosParaPedido<T extends ProductoOrdenable>(productos: T[], linea: LineaOperacion, empresaCodigo?: string): T[] {
  const porSku = new Map(productos.map((p) => [p.sku, p]));
  const filas = filasOrden(linea, productos);
  const resultado: T[] = [];
  for (const fila of filas) {
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
