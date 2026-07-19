export interface InventarioResumen {
  id: number;
  estado: string;
  fecha: string | null;
  creado_at: string;
  cerrado_at: string | null;
  total_lineas: number;
  contadas: number;
}

export interface Sesion {
  fecha: string;
  programado: boolean;
  dias: number[];
  proximo: string | null;
  conteo: { id: number; estado: string; total_lineas: number; contadas: number } | null;
}

export interface LineaInventario {
  product_id: number;
  nombre: string;
  sku: string;
  categoria: string | null;
  unidad: string;
  qty: number;
  contado: boolean;
  atipico: boolean;
  comentario: string | null;
  stock_objetivo: number;
}

export interface InventarioDetalle {
  id: number;
  estado: string;
  editable: boolean;
  fecha: string | null;
  ubicacion: { id: number; nombre: string; tipo: string };
  creado_at: string;
  cerrado_at: string | null;
  lineas: LineaInventario[];
}

export interface ProdCat {
  id: number;
  nombre: string;
  sku: string;
  unidad_distribucion: string;
  ultimo_costo: number | null;
  activo: boolean;
  es_cargo_compra: boolean;
}

export interface ExistItem { product_id: number; nombre: string; unidad: string; disponible: number; costo_promedio: number | null; valor: number }
export interface ExistResp { items: ExistItem[]; valor_total: number }

export interface ValuacionResp { ubicaciones: { id: number; nombre: string; tipo: string; skus: number; valor: number }[]; valor_total: number }

/** 'YYYY-MM-DD' → "sáb, 22 jun" (zona del negocio, sin desfase). */
export function fechaLarga(iso: string | null): string {
  if (!iso) return 'Inventario';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'America/Chicago',
  });
}

export const usd = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
