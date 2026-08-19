import { PrismaClient } from '@prisma/client';

/**
 * Auditoría de solo lectura para detectar inconsistencias antes de tocar datos.
 *
 * Uso:
 *   DATABASE_URL=... npm run audit:operacion -w server
 *   BPM_AUDIT_STRICT=1 ...  # termina con código 2 si hay hallazgos altos
 */

const prisma = new PrismaClient();
const negocioNombre = process.env.BPM_AUDIT_NEGOCIO ?? 'Burrito Parrilla Mexicana';
const estricto = process.env.BPM_AUDIT_STRICT === '1';
const json = process.env.BPM_AUDIT_JSON === '1';

type Severidad = 'alta' | 'media' | 'baja';
type Hallazgo = { severidad: Severidad; regla: string; detalle: string };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const n = (v: unknown) => {
  const value = Number(v ?? 0);
  return Number.isFinite(value) ? value : 0;
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const masDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86_400_000);
const clave = (...values: unknown[]) => values.map(String).join('|');

function agregar(hallazgos: Hallazgo[], severidad: Severidad, regla: string, detalle: string) {
  hallazgos.push({ severidad, regla, detalle });
}

async function main() {
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: negocioNombre } });
  const [semanas, facturas, compras, productos, conteos, pedidos, distribuciones, existencias] = await Promise.all([
    prisma.semanas_operativas.findMany({
      where: { negocio_id: negocio.id },
      include: { _count: { select: { facturas: true, inventario_semanal: true } } },
      orderBy: [{ inicia_at: 'asc' }, { id: 'asc' }],
    }),
    prisma.facturas.findMany({
      where: { negocio_id: negocio.id },
      include: { lineas: true, pagos: true, semana: { select: { anio: true, semana: true, inicia_at: true, termina_at: true } }, ubicacion: { select: { codigo: true, nombre: true } } },
      orderBy: { id: 'asc' },
    }),
    prisma.compras.findMany({
      where: { negocio_id: negocio.id },
      include: { lineas: true, pagos: true, proveedor: { select: { nombre: true } } },
      orderBy: { id: 'asc' },
    }),
    prisma.products.findMany({
      where: { negocio_id: negocio.id, activo: true },
      select: { id: true, sku: true, nombre: true, linea_operacion: true, tipo_operativo: true, orden_operativo: true, costo_promedio: true, ultimo_costo: true, precio_venta_fijo: true },
      orderBy: [{ linea_operacion: 'asc' }, { orden_operativo: 'asc' }, { nombre: 'asc' }],
    }),
    prisma.conteos.findMany({
      where: { negocio_id: negocio.id, fecha: { not: null } },
      select: { id: true, ubicacion_id: true, fecha: true, estado: true, notas: true },
    }),
    prisma.pedidos_operativos.findMany({
      where: { negocio_id: negocio.id },
      include: { lineas: { include: { producto: { select: { sku: true, linea_operacion: true } } } }, ubicacion: { select: { codigo: true } } },
    }),
    prisma.distribuciones.findMany({
      where: { negocio_id: negocio.id },
      select: { id: true, estado: true, fecha_entrega: true, lineas: { select: { cantidad_aprobada: true, cantidad_cargada: true, cantidad_recibida: true } } },
    }),
    prisma.existencias.findMany({
      where: { negocio_id: negocio.id },
      select: { ubicacion_id: true, product_id: true, cantidad_disponible: true, cantidad_reservada: true, cantidad_transito: true },
    }),
  ]);

  const hallazgos: Hallazgo[] = [];

  // Semanas operativas: domingo-sábado, sin fechas que se solapen.
  for (const semana of semanas) {
    const esperadoFin = masDias(semana.inicia_at, 6);
    if (iso(esperadoFin) !== iso(semana.termina_at) || semana.inicia_at.getUTCDay() !== 0) {
      agregar(hallazgos, 'alta', 'semana_rango', `Semana ${semana.anio}-${semana.semana} tiene rango ${iso(semana.inicia_at)}–${iso(semana.termina_at)}; se esperaba domingo-sábado.`);
    }
    if (semana.estado === 'cerrada' && semana._count.inventario_semanal === 0) {
      agregar(hallazgos, 'alta', 'cierre_sin_fotografia', `Semana ${semana.anio}-${semana.semana} está cerrada sin fotografía de inventario.`);
    }
  }
  for (let i = 1; i < semanas.length; i += 1) {
    const anterior = semanas[i - 1]!;
    const actual = semanas[i]!;
    if (iso(actual.inicia_at) !== iso(masDias(anterior.inicia_at, 7))) {
      agregar(hallazgos, 'media', 'semanas_discontinuas', `Hay un salto entre ${iso(anterior.inicia_at)} y ${iso(actual.inicia_at)}.`);
    }
  }

  // Facturación: una sola factura vigente por restaurante/línea/semana y totales reproducibles.
  const facturasVigentes = facturas.filter((f) => f.estado !== 'anulada');
  const facturasPorClave = new Map<string, typeof facturasVigentes>();
  for (const factura of facturasVigentes) {
    const k = clave(factura.semana_id, factura.ubicacion_id, factura.linea_operacion);
    const grupo = facturasPorClave.get(k) ?? [];
    grupo.push(factura);
    facturasPorClave.set(k, grupo);
    const totalLineas = r2(factura.lineas.reduce((suma, linea) => suma + n(linea.importe), 0));
    if (Math.abs(totalLineas - n(factura.total)) > 0.01) {
      agregar(hallazgos, 'alta', 'factura_total', `${factura.numero}: total ${n(factura.total).toFixed(2)} vs renglones ${totalLineas.toFixed(2)}.`);
    }
    for (const linea of factura.lineas) {
      const esperado = r2(n(linea.cantidad) * n(linea.precio_unitario));
      if (Math.abs(esperado - n(linea.importe)) > 0.01) agregar(hallazgos, 'alta', 'factura_linea', `${factura.numero} · ${linea.descripcion}: importe ${n(linea.importe).toFixed(2)} vs ${esperado.toFixed(2)}.`);
    }
    const pagos = r2(factura.pagos.reduce((suma, pago) => suma + n(pago.monto), 0));
    if (n(factura.total) >= 0 && pagos - n(factura.total) > 0.01) agregar(hallazgos, 'alta', 'factura_sobrepagada', `${factura.numero}: pagos ${pagos.toFixed(2)} superan total ${n(factura.total).toFixed(2)}.`);
  }
  for (const [k, grupo] of facturasPorClave) {
    if (grupo.length > 1) agregar(hallazgos, 'alta', 'facturas_duplicadas', `${k}: ${grupo.map((f) => f.numero).join(', ')} están vigentes al mismo tiempo.`);
  }

  // Compras: la cuenta por pagar debe ser el total menos pagos, nunca negativa.
  for (const compra of compras) {
    const totalLineas = r2(compra.lineas.reduce((suma, linea) => suma + n(linea.costo_total), 0));
    if (Math.abs(totalLineas - n(compra.total)) > 0.01) agregar(hallazgos, 'media', 'compra_total', `Compra ${compra.id} · ${compra.proveedor.nombre}: total ${n(compra.total).toFixed(2)} vs renglones ${totalLineas.toFixed(2)}.`);
    const pagos = r2(compra.pagos.reduce((suma, pago) => suma + n(pago.monto), 0));
    if (pagos - n(compra.total) > 0.01) agregar(hallazgos, 'alta', 'compra_sobrepagada', `Compra ${compra.id} · ${compra.proveedor.nombre}: pagos ${pagos.toFixed(2)} superan total ${n(compra.total).toFixed(2)}.`);
    const saldo = r2(Math.max(0, n(compra.total) - pagos));
    if (compra.estado === 'pagada' && saldo > 0.01) agregar(hallazgos, 'media', 'estado_compra', `Compra ${compra.id} aparece pagada pero conserva saldo ${saldo.toFixed(2)}.`);
    if (compra.estado === 'pendiente' && saldo <= 0.01) agregar(hallazgos, 'media', 'estado_compra', `Compra ${compra.id} aparece pendiente pero no conserva saldo.`);
  }

  // Catálogo: orden estable para copiar/pegar y costos/precios para facturar.
  const ordenes = new Map<string, typeof productos>();
  for (const producto of productos) {
    const grupo = ordenes.get(String(producto.linea_operacion)) ?? [];
    grupo.push(producto);
    ordenes.set(String(producto.linea_operacion), grupo);
    if (!producto.linea_operacion || !producto.tipo_operativo) agregar(hallazgos, 'alta', 'producto_sin_clasificacion', `${producto.sku} no tiene línea/tipo operativo.`);
    if (producto.orden_operativo >= 999) agregar(hallazgos, 'media', 'producto_sin_orden', `${producto.sku} tiene orden operativo ${producto.orden_operativo}.`);
    if (producto.linea_operacion === 'carne' && producto.tipo_operativo === 'proteina' && producto.costo_promedio == null && producto.ultimo_costo == null) agregar(hallazgos, 'alta', 'proteina_sin_costo', `${producto.sku} no tiene costo promedio ni último costo.`);
  }
  for (const [linea, grupo] of ordenes) {
    const porOrden = new Map<number, string[]>();
    for (const producto of grupo) porOrden.set(producto.orden_operativo, [...(porOrden.get(producto.orden_operativo) ?? []), producto.sku]);
    for (const [orden, skus] of porOrden) if (skus.length > 1 && orden < 999) agregar(hallazgos, 'media', 'orden_catalogo_duplicado', `${linea} orden ${orden}: ${skus.join(', ')}.`);
  }

  // Capturas diarias: la interfaz espera una sola sesión por ubicación y fecha.
  const conteosPorDia = new Map<string, typeof conteos>();
  for (const conteo of conteos) {
    if (!conteo.fecha) continue;
    const k = clave(conteo.ubicacion_id, iso(conteo.fecha));
    const grupo = conteosPorDia.get(k) ?? [];
    grupo.push(conteo);
    conteosPorDia.set(k, grupo);
  }
  for (const [k, grupo] of conteosPorDia) if (grupo.length > 1) agregar(hallazgos, 'alta', 'conteos_duplicados', `${k}: existen ${grupo.length} sesiones (${grupo.map((c) => c.id).join(', ')}).`);

  // Pedidos y entregas: cantidades imposibles rompen facturación o inventario.
  for (const pedido of pedidos) {
    if (pedido.estado !== 'borrador' && pedido.estado !== 'cancelado' && pedido.lineas.length === 0) agregar(hallazgos, 'media', 'pedido_sin_lineas', `${pedido.ubicacion.codigo} ${iso(pedido.fecha_entrega)} está ${pedido.estado} sin líneas.`);
    for (const linea of pedido.lineas) if (n(linea.cantidad) < 0) agregar(hallazgos, 'alta', 'pedido_negativo', `Pedido ${pedido.id} · ${linea.producto.sku} tiene cantidad negativa.`);
  }
  for (const distribucion of distribuciones) {
    for (const linea of distribucion.lineas) {
      if (linea.cantidad_recibida != null && linea.cantidad_cargada != null && n(linea.cantidad_recibida) - n(linea.cantidad_cargada) > 0.001) agregar(hallazgos, 'alta', 'recepcion_excede_carga', `Distribución ${distribucion.id}: recepción ${n(linea.cantidad_recibida)} supera carga ${n(linea.cantidad_cargada)}.`);
      if (linea.cantidad_cargada != null && linea.cantidad_aprobada != null && n(linea.cantidad_cargada) - n(linea.cantidad_aprobada) > 0.001) agregar(hallazgos, 'media', 'carga_excede_aprobado', `Distribución ${distribucion.id}: carga ${n(linea.cantidad_cargada)} supera aprobado ${n(linea.cantidad_aprobada)}.`);
    }
  }

  // Los negativos pueden ser provisionales de lunes a viernes, pero deben quedar visibles.
  for (const existencia of existencias) {
    if (n(existencia.cantidad_disponible) < -0.001 || n(existencia.cantidad_reservada) < -0.001 || n(existencia.cantidad_transito) < -0.001) {
      agregar(hallazgos, 'baja', 'existencia_negativa', `Ubicación ${existencia.ubicacion_id} · producto ${existencia.product_id}: disponible ${n(existencia.cantidad_disponible)}, reservada ${n(existencia.cantidad_reservada)}, tránsito ${n(existencia.cantidad_transito)}.`);
    }
  }

  const resumen = {
    negocio: negocio.nombre,
    revisado_at: new Date().toISOString(),
    registros: { semanas: semanas.length, facturas: facturas.length, compras: compras.length, productos_activos: productos.length, conteos: conteos.length, pedidos: pedidos.length, distribuciones: distribuciones.length, existencias: existencias.length },
    hallazgos,
    totales: {
      alta: hallazgos.filter((h) => h.severidad === 'alta').length,
      media: hallazgos.filter((h) => h.severidad === 'media').length,
      baja: hallazgos.filter((h) => h.severidad === 'baja').length,
    },
  };
  if (json) console.log(JSON.stringify(resumen, null, 2));
  else {
    console.log(`Auditoría operativa · ${resumen.negocio}`);
    console.log(`Registros: ${Object.entries(resumen.registros).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
    if (!hallazgos.length) console.log('✅ Sin hallazgos.');
    else for (const h of hallazgos) console.log(`[${h.severidad.toUpperCase()}] ${h.regla}: ${h.detalle}`);
    console.log(`Resumen: alta=${resumen.totales.alta} · media=${resumen.totales.media} · baja=${resumen.totales.baja}`);
  }
  if (estricto && resumen.totales.alta > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error('No se pudo completar la auditoría:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
