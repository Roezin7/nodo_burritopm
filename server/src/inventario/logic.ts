// Lógica pura de inventario (sin DB). Es donde más duele un error, así que va testeada.
// Reglas (spec §5.2):
//   total_base de un producto = Σ_zonas (qty_captura * factor)
//   faltante de compra        = max(0, base_qty - total_base)
//   valor de inventario       = Σ (total_base * unit_cost) [productos sin unit_cost no suman]
//   lista de compras          = productos con faltante > 0, agrupados por store con subtotales

export interface LineaConteo {
  qty_captura: number;
  factor: number;
}

/** Suma qty_captura * factor sobre todas las líneas/zonas de un producto. */
export function totalBaseProducto(lineas: LineaConteo[]): number {
  return redondear(lineas.reduce((acc, l) => acc + l.qty_captura * l.factor, 0));
}

/** Lo que hay que comprar para llegar al stock mínimo (base_qty). Nunca negativo. */
export function faltanteCompra(baseQty: number, totalBase: number): number {
  return redondear(Math.max(0, baseQty - totalBase));
}

/** Valor a costo de un producto. Sin costo => 0 (y se reporta aparte). */
export function valorProducto(totalBase: number, unitCost: number | null): number {
  if (unitCost == null) return 0;
  return redondear(totalBase * unitCost);
}

export interface ProductoFaltante {
  product_id: number;
  nombre: string;
  store_id: number;
  store: string;
  base_qty: number;
  total_base: number;
  faltante: number;
  unit_cost: number | null;
  valor_faltante: number; // faltante * unit_cost (0 si sin costo)
}

export interface GrupoTienda {
  store_id: number;
  store: string;
  items: ProductoFaltante[];
  subtotal: number;
}

export interface ListaCompras {
  grupos: GrupoTienda[];
  total: number;
}

/** Agrupa los productos con faltante > 0 por tienda, con subtotal por tienda y total general. */
export function armarListaCompras(faltantes: ProductoFaltante[]): ListaCompras {
  const conFaltante = faltantes.filter((f) => f.faltante > 0);
  const porTienda = new Map<number, GrupoTienda>();

  for (const item of conFaltante) {
    let grupo = porTienda.get(item.store_id);
    if (!grupo) {
      grupo = { store_id: item.store_id, store: item.store, items: [], subtotal: 0 };
      porTienda.set(item.store_id, grupo);
    }
    grupo.items.push(item);
    grupo.subtotal = redondear(grupo.subtotal + item.valor_faltante);
  }

  const grupos = [...porTienda.values()].sort((a, b) => a.store.localeCompare(b.store, 'es'));
  const total = redondear(grupos.reduce((acc, g) => acc + g.subtotal, 0));
  return { grupos, total };
}

/** Redondeo a 2 decimales evitando ruido de punto flotante. */
export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
