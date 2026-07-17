import type { LineaOperacion, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { precioVentaProducto } from '../operacion/service.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sumarDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86400000);

/** Semana ISO, con lunes como inicio y sábado como cierre operativo. */
export function semanaDeFecha(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dia);
  const anio = x.getUTCFullYear();
  const inicioAnio = new Date(Date.UTC(anio, 0, 1));
  const semana = Math.ceil((((x.getTime() - inicioAnio.getTime()) / 86400000) + 1) / 7);
  const lunes = new Date(d);
  const delta = (d.getUTCDay() || 7) - 1;
  lunes.setUTCDate(d.getUTCDate() - delta);
  const sabado = sumarDias(lunes, 5);
  return { anio, semana, lunes, sabado };
}

export async function asegurarSemana(negocioId: bigint, fechaCierre: string) {
  const s = semanaDeFecha(fecha(fechaCierre));
  return prisma.semanas_operativas.upsert({
    where: { negocio_id_anio_semana: { negocio_id: negocioId, anio: s.anio, semana: s.semana } },
    create: { negocio_id: negocioId, anio: s.anio, semana: s.semana, inicia_at: s.lunes, termina_at: s.sabado },
    update: {},
  });
}

async function precioSemanal(negocioId: bigint, productId: bigint, inicio: Date, fin: Date) {
  const p = await prisma.products.findFirst({ where: { id: productId, negocio_id: negocioId } });
  if (!p) throw new HttpError(404, 'Producto no encontrado');
  if (p.precio_venta_fijo != null) return num0(p.precio_venta_fijo);
  if (p.tipo_operativo !== 'proteina') return precioVentaProducto(p) ?? 0;
  const salidas = await prisma.produccion_salidas.findMany({
    where: { product_id: productId, produccion: { negocio_id: negocioId, fecha: { gte: inicio, lte: fin } } },
    select: { cajas: true, costo_total: true },
  });
  const cajas = salidas.reduce((a, s) => a + num0(s.cajas), 0);
  const costo = salidas.reduce((a, s) => a + num0(s.costo_total), 0);
  return cajas > 0 ? r2(costo / cajas + num0(p.markup_caja)) : precioVentaProducto(p) ?? 0;
}

async function cantidadFacturable(linea: {
  cantidad: Prisma.Decimal;
  distribucion_lineas: { cantidad_recibida: Prisma.Decimal | null; cantidad_cargada: Prisma.Decimal | null; cantidad_aprobada: Prisma.Decimal | null; cantidad_sugerida: Prisma.Decimal }[];
}) {
  if (!linea.distribucion_lineas.length) return num0(linea.cantidad);
  return r3(linea.distribucion_lineas.reduce((a, d) => a + (num(d.cantidad_recibida) ?? num(d.cantidad_cargada) ?? num(d.cantidad_aprobada) ?? num0(d.cantidad_sugerida)), 0));
}

function numeroFactura(anio: number, semana: number, empresa: string, ubicacion: string, linea: LineaOperacion) {
  const limpio = (s: string, n: number) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n) || 'X';
  return `${anio}-${String(semana).padStart(2, '0')}-${limpio(empresa, 4)}-${limpio(ubicacion, 5)}-${linea === 'carne' ? 'M' : 'D'}`;
}

async function valuacionInventario(negocioId: bigint) {
  const [existencias, lotes] = await Promise.all([
    prisma.existencias.findMany({
      where: { negocio_id: negocioId, cantidad_disponible: { gt: 0 } },
      include: { products: { select: { linea_operacion: true, tipo_operativo: true } }, ubicaciones: { select: { nombre: true } } },
    }),
    prisma.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 } } }),
  ]);
  let desechables = 0;
  let terminada = 0;
  for (const e of existencias) {
    const valor = num0(e.cantidad_disponible) * num0(e.costo_promedio);
    if (e.products.linea_operacion === 'desechables') desechables += valor;
    else if (e.products.linea_operacion === 'carne' && e.products.tipo_operativo !== 'materia_prima') terminada += valor;
  }
  let fresca = 0;
  let congelada = 0;
  for (const l of lotes) (l.congelado ? (congelada += num0(l.costo_disponible)) : (fresca += num0(l.costo_disponible)));
  return { valor_carne: r2(terminada + fresca), valor_congelado: r2(congelada), valor_desechables: r2(desechables) };
}

async function calcularBalance(negocioId: bigint, semanaId: bigint, terminaAt: Date) {
  const inv = await valuacionInventario(negocioId);
  const desde = sumarDias(terminaAt, -20); // semana actual + dos anteriores completas
  const facturas = await prisma.facturas.findMany({
    where: { negocio_id: negocioId, estado: { in: ['emitida', 'pagada'] }, emitida_at: { gte: desde, lte: terminaAt } },
    include: { pagos: true },
  });
  const cobrar = r2(facturas.reduce((a, f) => a + Math.max(0, num0(f.total) - f.pagos.reduce((x, p) => x + num0(p.monto), 0)), 0));
  const compras = await prisma.compras.findMany({ where: { negocio_id: negocioId, estado: 'pendiente' }, select: { total: true } });
  const pagar = r2(compras.reduce((a, c) => a + num0(c.total), 0));
  const balance = r2(inv.valor_carne + inv.valor_congelado + inv.valor_desechables + cobrar - pagar);
  await prisma.semanas_operativas.update({ where: { id: semanaId }, data: { ...inv, cuentas_por_cobrar: cobrar, cuentas_por_pagar: pagar, balance_neto: balance } });
  return { ...inv, cuentas_por_cobrar: cobrar, cuentas_por_pagar: pagar, balance_neto: balance };
}

async function actualizarUltimoBalance(negocioId: bigint) {
  const semana = await prisma.semanas_operativas.findFirst({ where: { negocio_id: negocioId, estado: 'cerrada' }, orderBy: [{ anio: 'desc' }, { semana: 'desc' }] });
  if (semana) await calcularBalance(negocioId, semana.id, semana.termina_at);
}

export async function cerrarSemana(negocioId: bigint, usuarioId: bigint, fechaCierre: string) {
  const semana = await asegurarSemana(negocioId, fechaCierre);
  if (semana.estado === 'cerrada') throw new HttpError(409, 'La semana ya está cerrada');
  const pedidos = await prisma.pedidos_operativos.findMany({
    where: { negocio_id: negocioId, fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at }, estado: { notIn: ['borrador', 'cancelado'] } },
    include: {
      empresa: true, ubicacion: true,
      lineas: { include: { producto: true, distribucion_lineas: { select: { cantidad_recibida: true, cantidad_cargada: true, cantidad_aprobada: true, cantidad_sugerida: true } } } },
    },
  });
  if (!pedidos.length) throw new HttpError(400, 'No hay pedidos confirmados para cerrar esta semana');

  const precios = new Map<string, number>();
  for (const p of [...new Map(pedidos.flatMap((o) => o.lineas).map((l) => [l.product_id.toString(), l.producto])).values()]) {
    precios.set(p.id.toString(), await precioSemanal(negocioId, p.id, semana.inicia_at, semana.termina_at));
  }
  type Grupo = { empresa: (typeof pedidos)[number]['empresa']; ubicacion: (typeof pedidos)[number]['ubicacion']; linea: LineaOperacion; items: Map<string, { productId: bigint; descripcion: string; cantidad: number; precio: number }> };
  const grupos = new Map<string, Grupo>();
  for (const pedido of pedidos) {
    const k = `${pedido.ubicacion_id}:${pedido.linea_operacion}`;
    if (!grupos.has(k)) grupos.set(k, { empresa: pedido.empresa, ubicacion: pedido.ubicacion, linea: pedido.linea_operacion, items: new Map() });
    const g = grupos.get(k)!;
    for (const l of pedido.lineas) {
      const cantidad = await cantidadFacturable(l);
      if (cantidad <= 0) continue;
      const precio = precios.get(l.product_id.toString()) ?? 0;
      const previo = g.items.get(l.product_id.toString());
      g.items.set(l.product_id.toString(), { productId: l.product_id, descripcion: l.producto.nombre, cantidad: r3((previo?.cantidad ?? 0) + cantidad), precio });
    }
  }

  const facturas = await prisma.$transaction(async (tx) => {
    const anteriores = await tx.facturas.findMany({ where: { semana_id: semana.id, estado: { not: 'anulada' } } });
    if (anteriores.length) await tx.facturas.updateMany({ where: { id: { in: anteriores.map((f) => f.id) } }, data: { estado: 'anulada' } });
    const creadas = [];
    for (const g of grupos.values()) {
      const items = [...g.items.values()].filter((i) => i.cantidad > 0);
      if (!items.length) continue;
      const total = r2(items.reduce((a, i) => a + i.cantidad * i.precio, 0));
      const numero = numeroFactura(semana.anio, semana.semana, g.empresa.codigo, g.ubicacion.codigo, g.linea);
      const previa = anteriores.find((f) => f.numero === numero);
      const diasCredito = g.linea === 'carne' ? g.empresa.dias_credito_carne : g.empresa.dias_credito_desechables;
      const f = await tx.facturas.create({
        data: { negocio_id: negocioId, semana_id: semana.id, empresa_cliente_id: g.empresa.id, ubicacion_id: g.ubicacion.id, linea_operacion: g.linea, numero, emitida_at: semana.termina_at, vence_at: sumarDias(semana.termina_at, diasCredito), estado: 'emitida', subtotal: total, total, version: (previa?.version ?? 0) + 1, reemplaza_factura_id: previa?.id ?? null },
      });
      await tx.factura_lineas.createMany({ data: items.map((i) => ({ factura_id: f.id, product_id: i.productId, descripcion: i.descripcion, cantidad: i.cantidad, precio_unitario: i.precio, importe: r2(i.cantidad * i.precio) })) });
      creadas.push(f);
    }
    for (const p of pedidos) {
      for (const l of p.lineas) await tx.pedido_operativo_lineas.update({ where: { id: l.id }, data: { precio_unitario: precios.get(l.product_id.toString()) ?? l.precio_unitario } });
    }
    await tx.pedidos_operativos.updateMany({ where: { id: { in: pedidos.map((p) => p.id) } }, data: { estado: 'cerrado' } });
    await tx.semanas_operativas.update({ where: { id: semana.id }, data: { estado: 'cerrada', cerrado_por: usuarioId, cerrado_at: new Date() } });
    return creadas;
  });
  const balance = await calcularBalance(negocioId, semana.id, semana.termina_at);
  return { semana_id: Number(semana.id), anio: semana.anio, semana: semana.semana, facturas: facturas.length, balance };
}

export async function reabrirSemana(negocioId: bigint, semanaId: bigint) {
  const s = await prisma.semanas_operativas.findFirst({ where: { id: semanaId, negocio_id: negocioId } });
  if (!s) throw new HttpError(404, 'Semana no encontrada');
  if (s.estado !== 'cerrada') throw new HttpError(409, 'La semana no está cerrada');
  const pagadas = await prisma.facturas.count({ where: { semana_id: s.id, estado: 'pagada' } });
  if (pagadas) throw new HttpError(409, 'No se puede reabrir una semana con facturas pagadas');
  await prisma.$transaction([
    prisma.facturas.updateMany({ where: { semana_id: s.id, estado: 'emitida' }, data: { estado: 'anulada' } }),
    prisma.semanas_operativas.update({ where: { id: s.id }, data: { estado: 'reabierta', cerrado_at: null, cerrado_por: null } }),
    prisma.pedidos_operativos.updateMany({ where: { negocio_id: negocioId, fecha_entrega: { gte: s.inicia_at, lte: s.termina_at }, estado: 'cerrado' }, data: { estado: 'en_preparacion' } }),
  ]);
  return { ok: true };
}

export async function listarCierres(negocioId: bigint) {
  const semanas = await prisma.semanas_operativas.findMany({
    where: { negocio_id: negocioId },
    include: { facturas: { where: { estado: { not: 'anulada' } }, include: { empresa: true, ubicacion: true, pagos: true, lineas: true }, orderBy: { numero: 'asc' } } },
    orderBy: [{ anio: 'desc' }, { semana: 'desc' }],
  });
  return semanas.map((s) => ({
    id: Number(s.id), anio: s.anio, semana: s.semana, inicia_at: iso(s.inicia_at), termina_at: iso(s.termina_at), estado: s.estado,
    valor_carne: num0(s.valor_carne), valor_congelado: num0(s.valor_congelado), valor_desechables: num0(s.valor_desechables), cuentas_por_cobrar: num0(s.cuentas_por_cobrar), cuentas_por_pagar: num0(s.cuentas_por_pagar), balance_neto: num0(s.balance_neto),
    facturas: s.facturas.map((f) => ({ id: Number(f.id), numero: f.numero, version: f.version, empresa: f.empresa.nombre, ubicacion: f.ubicacion.nombre, linea: f.linea_operacion, emitida_at: iso(f.emitida_at), vence_at: iso(f.vence_at), estado: f.estado, total: num0(f.total), pagado: r2(f.pagos.reduce((a, p) => a + num0(p.monto), 0)), lineas: f.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: num0(l.cantidad), precio: num0(l.precio_unitario), importe: num0(l.importe) })) })),
  }));
}

export async function pagarFactura(negocioId: bigint, facturaId: bigint, usuarioId: bigint, fechaPago: string) {
  const f = await prisma.facturas.findFirst({ where: { id: facturaId, negocio_id: negocioId, estado: 'emitida' }, include: { pagos: true } });
  if (!f) throw new HttpError(404, 'Factura pendiente no encontrada');
  const saldo = r2(num0(f.total) - f.pagos.reduce((a, p) => a + num0(p.monto), 0));
  await prisma.$transaction([
    prisma.pagos_cliente.create({ data: { factura_id: f.id, monto: saldo, pagado_at: fecha(fechaPago), registrado_por: usuarioId } }),
    prisma.facturas.update({ where: { id: f.id }, data: { estado: 'pagada' } }),
  ]);
  await actualizarUltimoBalance(negocioId);
  return { ok: true, monto: saldo };
}

export async function pagarCompra(negocioId: bigint, compraId: bigint, fechaPago: string) {
  const c = await prisma.compras.findFirst({ where: { id: compraId, negocio_id: negocioId, estado: 'pendiente' } });
  if (!c) throw new HttpError(404, 'Compra pendiente no encontrada');
  await prisma.compras.update({ where: { id: c.id }, data: { estado: 'pagada', pagado_at: fecha(fechaPago) } });
  await actualizarUltimoBalance(negocioId);
  return { ok: true, monto: num0(c.total) };
}

export async function detalleFactura(negocioId: bigint, facturaId: bigint) {
  const f = await prisma.facturas.findFirst({
    where: { id: facturaId, negocio_id: negocioId },
    include: { empresa: true, ubicacion: true, lineas: { orderBy: { descripcion: 'asc' } }, pagos: true },
  });
  if (!f) throw new HttpError(404, 'Factura no encontrada');
  return { id: Number(f.id), numero: f.numero, version: f.version, empresa: f.empresa.nombre, ubicacion: f.ubicacion.nombre, linea: f.linea_operacion, emitida_at: iso(f.emitida_at), vence_at: iso(f.vence_at), estado: f.estado, total: num0(f.total), pagado: r2(f.pagos.reduce((a, p) => a + num0(p.monto), 0)), lineas: f.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: num0(l.cantidad), precio: num0(l.precio_unitario), importe: num0(l.importe) })) };
}
