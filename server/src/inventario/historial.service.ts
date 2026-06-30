import { prisma } from '../db.js';

export interface FilaHistorial {
  ubicacion_id?: number;
  sucursal?: string; // nombre de la sucursal (alternativa a ubicacion_id)
  product_id?: number;
  sku?: string;
  producto?: string; // nombre del producto (alternativa a product_id/sku)
  fecha: string; // YYYY-MM-DD
  cantidad: number;
}

const norm = (s: string) => s.trim().toLowerCase();
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Importa pedidos históricos resolviendo sucursal y producto por id, sku o nombre.
 * Reporta filas no resueltas en vez de fallar todo. Con reemplazar=true borra el historial
 * previo del negocio (re-importación idempotente).
 */
export async function importarHistorial(negocioId: bigint, filas: FilaHistorial[], reemplazar = false) {
  const [sucursales, productos] = await Promise.all([
    prisma.ubicaciones.findMany({ where: { negocio_id: negocioId, tipo: 'sucursal' }, select: { id: true, nombre: true } }),
    prisma.products.findMany({ where: { negocio_id: negocioId }, select: { id: true, nombre: true, sku: true } }),
  ]);
  const sucPorId = new Map(sucursales.map((s) => [s.id.toString(), s.id]));
  const sucPorNombre = new Map(sucursales.map((s) => [norm(s.nombre), s.id]));
  const prodPorId = new Map(productos.map((p) => [p.id.toString(), p.id]));
  const prodPorSku = new Map(productos.filter((p) => p.sku).map((p) => [norm(p.sku!), p.id]));
  const prodPorNombre = new Map(productos.map((p) => [norm(p.nombre), p.id]));

  const data: { negocio_id: bigint; ubicacion_id: bigint; product_id: bigint; fecha: Date; cantidad: number; origen: string }[] = [];
  const errores: { fila: number; motivo: string }[] = [];
  const sucsNoEncontradas = new Set<string>();
  const prodsNoEncontrados = new Set<string>();

  filas.forEach((f, i) => {
    const ubicId = f.ubicacion_id != null ? sucPorId.get(String(f.ubicacion_id)) : f.sucursal ? sucPorNombre.get(norm(f.sucursal)) : undefined;
    const prodId = f.product_id != null ? prodPorId.get(String(f.product_id))
      : f.sku ? prodPorSku.get(norm(f.sku))
      : f.producto ? prodPorNombre.get(norm(f.producto)) : undefined;
    if (!ubicId) { errores.push({ fila: i + 1, motivo: `Sucursal no encontrada: ${f.sucursal ?? f.ubicacion_id ?? '—'}` }); if (f.sucursal) sucsNoEncontradas.add(f.sucursal); return; }
    if (!prodId) { errores.push({ fila: i + 1, motivo: `Producto no encontrado: ${f.producto ?? f.sku ?? f.product_id ?? '—'}` }); if (f.producto ?? f.sku) prodsNoEncontrados.add(String(f.producto ?? f.sku)); return; }
    if (!f.fecha || !FECHA_RE.test(f.fecha)) { errores.push({ fila: i + 1, motivo: `Fecha inválida (usa YYYY-MM-DD): ${f.fecha ?? '—'}` }); return; }
    const cantidad = Number(f.cantidad);
    if (!Number.isFinite(cantidad) || cantidad < 0) { errores.push({ fila: i + 1, motivo: `Cantidad inválida: ${f.cantidad}` }); return; }
    if (cantidad === 0) return; // un cero no aporta señal de demanda
    data.push({ negocio_id: negocioId, ubicacion_id: ubicId, product_id: prodId, fecha: new Date(`${f.fecha}T00:00:00.000Z`), cantidad, origen: 'import' });
  });

  let insertados = 0;
  await prisma.$transaction(async (tx) => {
    if (reemplazar) await tx.historial_pedidos.deleteMany({ where: { negocio_id: negocioId } });
    if (data.length) {
      const r = await tx.historial_pedidos.createMany({ data });
      insertados = r.count;
    }
  });

  return {
    insertados,
    descartados: errores.length,
    errores: errores.slice(0, 50), // recorta para no devolver miles
    sucursales_no_encontradas: [...sucsNoEncontradas].slice(0, 30),
    productos_no_encontrados: [...prodsNoEncontrados].slice(0, 30),
  };
}

/** Resumen del historial cargado: por sucursal, nº de pedidos y rango de fechas. */
export async function resumenHistorial(negocioId: bigint) {
  const filas = await prisma.historial_pedidos.findMany({
    where: { negocio_id: negocioId },
    select: { ubicacion_id: true, fecha: true },
  });
  const sucursales = await prisma.ubicaciones.findMany({ where: { negocio_id: negocioId, tipo: 'sucursal' }, select: { id: true, nombre: true } });
  const nombre = new Map(sucursales.map((s) => [s.id.toString(), s.nombre]));
  const porSuc = new Map<string, { pedidos: number; min: Date; max: Date }>();
  for (const f of filas) {
    const k = f.ubicacion_id.toString();
    const cur = porSuc.get(k);
    if (!cur) porSuc.set(k, { pedidos: 1, min: f.fecha, max: f.fecha });
    else { cur.pedidos++; if (f.fecha < cur.min) cur.min = f.fecha; if (f.fecha > cur.max) cur.max = f.fecha; }
  }
  return {
    total: filas.length,
    sucursales: [...porSuc.entries()].map(([id, v]) => ({
      ubicacion_id: Number(id),
      nombre: nombre.get(id) ?? `#${id}`,
      pedidos: v.pedidos,
      desde: v.min.toISOString().slice(0, 10),
      hasta: v.max.toISOString().slice(0, 10),
    })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  };
}
