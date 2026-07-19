import type { LineaOperacion, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { coberturaPedidosBpm, preciosVentaSemana } from '../operacion/service.js';
import { asegurarInventarioInicialSemanal, validarConciliacionParaCierre } from '../operacion/conciliacion.js';
import { eliminarConteoEnTx } from '../conteos/service.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sumarDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86400000);
const hoyChicago = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

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

async function cantidadFacturable(linea: {
  cantidad: Prisma.Decimal;
  distribucion_lineas: { cantidad_recibida: Prisma.Decimal | null; cantidad_cargada: Prisma.Decimal | null; cantidad_aprobada: Prisma.Decimal | null; cantidad_sugerida: Prisma.Decimal }[];
}) {
  if (!linea.distribucion_lineas.length) return num0(linea.cantidad);
  return r3(linea.distribucion_lineas.reduce((a, d) => a + (num(d.cantidad_recibida) ?? num(d.cantidad_cargada) ?? num(d.cantidad_aprobada) ?? num0(d.cantidad_sugerida)), 0));
}

export function numeroFactura(anio: number, semana: number, empresa: string, ubicacion: string, linea: LineaOperacion) {
  const limpio = (s: string, n: number) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, n) || 'X';
  // El código completo distingue, por ejemplo, NAPER de NAPER2. Recortarlo a cinco
  // caracteres hacía que dos sucursales intentaran crear el mismo folio.
  return `${anio}-${String(semana).padStart(2, '0')}-${limpio(empresa, 8)}-${limpio(ubicacion, 12)}-${linea === 'carne' ? 'M' : 'D'}`;
}

type Db = Prisma.TransactionClient | typeof prisma;

async function valuacionInventario(negocioId: bigint, db: Db = prisma) {
  const [existencias, lotes] = await Promise.all([
    db.existencias.findMany({
      where: { negocio_id: negocioId, OR: [{ cantidad_disponible: { gt: 0 } }, { cantidad_transito: { gt: 0 } }] },
      include: { products: { select: { linea_operacion: true, tipo_operativo: true } }, ubicaciones: { select: { nombre: true } } },
    }),
    db.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 } } }),
  ]);
  let desechables = 0;
  let terminada = 0;
  for (const e of existencias) {
    const valor = (Math.max(0, num0(e.cantidad_disponible)) + Math.max(0, num0(e.cantidad_transito))) * num0(e.costo_promedio);
    if (e.products.linea_operacion === 'desechables') desechables += valor;
    else if (e.products.linea_operacion === 'carne' && e.products.tipo_operativo !== 'materia_prima') terminada += valor;
  }
  let fresca = 0;
  let congelada = 0;
  for (const l of lotes) (l.congelado ? (congelada += num0(l.costo_disponible)) : (fresca += num0(l.costo_disponible)));
  return { valor_carne: r2(terminada + fresca), valor_congelado: r2(congelada), valor_desechables: r2(desechables) };
}

async function calcularBalance(negocioId: bigint, semanaId: bigint, terminaAt: Date, db: Db = prisma) {
  const inv = await valuacionInventario(negocioId, db);
  const facturas = await db.facturas.findMany({
    // Cuentas por cobrar es el saldo completo, no solo las últimas tres semanas.
    where: { negocio_id: negocioId, estado: { in: ['emitida', 'pagada'] }, emitida_at: { lte: terminaAt } },
    include: { pagos: true },
  });
  const cobrar = r2(facturas.reduce((a, f) => a + Math.max(0, num0(f.total) - f.pagos.reduce((x, p) => x + num0(p.monto), 0)), 0));
  const compras = await db.compras.findMany({ where: { negocio_id: negocioId, estado: 'pendiente', fecha: { lte: terminaAt } }, select: { total: true } });
  const pagar = r2(compras.reduce((a, c) => a + num0(c.total), 0));
  const balance = r2(inv.valor_carne + inv.valor_congelado + inv.valor_desechables + cobrar - pagar);
  await db.semanas_operativas.update({ where: { id: semanaId }, data: { ...inv, cuentas_por_cobrar: cobrar, cuentas_por_pagar: pagar, balance_neto: balance } });
  return { ...inv, cuentas_por_cobrar: cobrar, cuentas_por_pagar: pagar, balance_neto: balance };
}

async function actualizarUltimoBalance(negocioId: bigint) {
  const semana = await prisma.semanas_operativas.findFirst({ where: { negocio_id: negocioId, estado: 'cerrada' }, orderBy: [{ anio: 'desc' }, { semana: 'desc' }] });
  if (semana) await calcularBalance(negocioId, semana.id, semana.termina_at);
}

export async function cerrarSemana(negocioId: bigint, usuarioId: bigint, fechaCierre: string) {
  const periodoSolicitado = semanaDeFecha(fecha(fechaCierre));
  if (iso(periodoSolicitado.sabado) > hoyChicago()) throw new HttpError(409, 'No se puede cerrar una semana que todavía no termina');
  const semana = await asegurarSemana(negocioId, fechaCierre);
  if (semana.estado === 'cerrada') throw new HttpError(409, 'La semana ya está cerrada');

  // La valuación de cierre parte del ledger vivo; por eso los cierres operativos se hacen
  // en orden. Si ya se capturó una semana posterior, cerrar ésta con el saldo actual
  // produciría una fotografía históricamente falsa.
  const [comprasPosteriores, produccionesPosteriores, pedidosPosteriores] = await Promise.all([
    prisma.compras.count({ where: { negocio_id: negocioId, fecha: { gt: semana.termina_at }, estado: { not: 'cancelada' } } }),
    prisma.producciones.count({ where: { negocio_id: negocioId, fecha: { gt: semana.termina_at } } }),
    prisma.pedidos_operativos.count({ where: { negocio_id: negocioId, fecha_entrega: { gt: semana.termina_at }, estado: { not: 'cancelado' }, lineas: { some: {} } } }),
  ]);
  if (comprasPosteriores || produccionesPosteriores || pedidosPosteriores) {
    throw new HttpError(409, 'Hay operación capturada en una semana posterior. Cierra las semanas en orden para que la fotografía de inventario sea correcta.');
  }

  // El cierre factura lo que realmente salió. No debe convertir silenciosamente una venta
  // confirmada pero nunca preparada/entregada en una factura ni congelar una ruta activa.
  const [pedidosSinPreparar, borradoresConVenta, distribucionesActivas, coberturaCarne, coberturaDesechables] = await Promise.all([
    prisma.pedidos_operativos.count({
      where: {
        negocio_id: negocioId,
        fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at },
        estado: 'confirmado',
        lineas: { some: {} },
      },
    }),
    prisma.pedidos_operativos.count({
      where: {
        negocio_id: negocioId, fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at },
        estado: 'borrador', lineas: { some: {} },
      },
    }),
    prisma.distribuciones.count({
      where: {
        negocio_id: negocioId,
        fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at },
        estado: { notIn: ['cerrada', 'cerrada_con_incidencias', 'cancelada'] },
      },
    }),
    coberturaPedidosBpm(negocioId, 'carne', iso(semana.inicia_at), iso(semana.termina_at)),
    coberturaPedidosBpm(negocioId, 'desechables', iso(semana.inicia_at), iso(semana.termina_at)),
  ]);
  if (borradoresConVenta) {
    throw new HttpError(409, `Hay ${borradoresConVenta} venta(s) con cantidades todavía en borrador. Confírmalas o elimínalas antes del cierre.`);
  }
  const coberturaPendiente = [...coberturaCarne, ...coberturaDesechables].flatMap((dia) => dia.pendientes.map((nombre) => `${dia.fecha}: ${nombre}`));
  if (coberturaPendiente.length) {
    throw new HttpError(409, `Faltan pedidos BPM para cerrar: ${coberturaPendiente.slice(0, 6).join(', ')}${coberturaPendiente.length > 6 ? ` y ${coberturaPendiente.length - 6} más` : ''}.`);
  }
  if (pedidosSinPreparar) {
    throw new HttpError(409, `Faltan ${pedidosSinPreparar} venta(s) por preparar y entregar antes del cierre.`);
  }
  if (distribucionesActivas) {
    throw new HttpError(409, `Faltan ${distribucionesActivas} despacho(s) por completar antes del cierre.`);
  }
  const alertaInventario = await validarConciliacionParaCierre(negocioId, iso(semana.inicia_at), iso(semana.termina_at));
  const pedidos = await prisma.pedidos_operativos.findMany({
    where: { negocio_id: negocioId, fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at }, estado: { notIn: ['borrador', 'cancelado'] } },
    include: {
      empresa: true, ubicacion: true,
      lineas: { include: { producto: true, distribucion_lineas: { select: { cantidad_recibida: true, cantidad_cargada: true, cantidad_aprobada: true, cantidad_sugerida: true } } } },
    },
  });
  if (!pedidos.length) throw new HttpError(400, 'No hay pedidos confirmados para cerrar esta semana');

  const productosVendidos = [...new Map(pedidos.flatMap((o) => o.lineas).map((l) => [l.product_id.toString(), l.producto])).values()];
  const preciosCalculados = await preciosVentaSemana(negocioId, productosVendidos, iso(semana.inicia_at), iso(semana.termina_at));
  const proteinasSinProduccion = productosVendidos.filter((p) => p.tipo_operativo === 'proteina' && preciosCalculados.get(p.id.toString()) == null);
  if (proteinasSinProduccion.length) {
    throw new HttpError(409, `Falta registrar producción semanal para calcular costo + $15 de: ${proteinasSinProduccion.map((p) => p.nombre).join(', ')}.`);
  }
  const precios = new Map([...preciosCalculados].map(([id, precio]) => [id, precio ?? 0]));
  type Grupo = { empresa: (typeof pedidos)[number]['empresa']; ubicacion: (typeof pedidos)[number]['ubicacion']; linea: LineaOperacion; items: Map<string, { productId: bigint; descripcion: string; cantidad: number; precio: number }> };
  const grupos = new Map<string, Grupo>();
  for (const pedido of pedidos) {
    for (const l of pedido.lineas) {
      // La ruta puede ser de carne y llevar consumibles solicitados en la misma hoja.
      // La factura se separa por la línea real del producto, como en los libros actuales.
      const linea = l.producto.linea_operacion ?? pedido.linea_operacion;
      const k = `${pedido.ubicacion_id}:${linea}`;
      if (!grupos.has(k)) grupos.set(k, { empresa: pedido.empresa, ubicacion: pedido.ubicacion, linea, items: new Map() });
      const g = grupos.get(k)!;
      const cantidad = await cantidadFacturable(l);
      if (cantidad <= 0) continue;
      const precio = precios.get(l.product_id.toString()) ?? 0;
      const previo = g.items.get(l.product_id.toString());
      g.items.set(l.product_id.toString(), { productId: l.product_id, descripcion: l.producto.nombre, cantidad: r3((previo?.cantidad ?? 0) + cantidad), precio });
    }
  }

  const cierre = await prisma.$transaction(async (tx) => {
    const vigente = await tx.semanas_operativas.findUnique({ where: { id: semana.id }, select: { estado: true } });
    if (vigente?.estado === 'cerrada') throw new HttpError(409, 'La semana ya está cerrada');
    // Conserva todo el historial para que un recierre genere v2, v3, etc. Consultar solo las
    // facturas vigentes hacía que una semana reabierta intentara crear otra v1 y chocara con
    // la llave única.
    const anteriores = await tx.facturas.findMany({ where: { semana_id: semana.id }, orderBy: { version: 'desc' } });
    const vigentes = anteriores.filter((f) => f.estado !== 'anulada');
    if (vigentes.length) await tx.facturas.updateMany({ where: { id: { in: vigentes.map((f) => f.id) } }, data: { estado: 'anulada' } });
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
    // Un saldo negativo representa cajas que salieron sin respaldo registrado. No tiene valor
    // contable ni bloquea el cierre: se conserva en el ledger y se abre una incidencia visible.
    for (const saldo of alertaInventario.saldos) {
      const existente = await tx.incidencias.findFirst({
        where: {
          negocio_id: negocioId, tipo: 'cajas_perdidas_inventario', estado: 'abierta',
          documento_tipo: 'cierre', documento_id: semana.id,
          ubicacion_id: BigInt(saldo.ubicacion_id), product_id: BigInt(saldo.product_id),
        },
        select: { id: true },
      });
      if (!existente) await tx.incidencias.create({
        data: {
          negocio_id: negocioId, tipo: 'cajas_perdidas_inventario', prioridad: 'alta',
          ubicacion_id: BigInt(saldo.ubicacion_id), product_id: BigInt(saldo.product_id),
          documento_tipo: 'cierre', documento_id: semana.id, responsable_id: usuarioId,
          comentarios: `${saldo.cantidad} cajas faltantes al cerrar la semana ${semana.semana}. El saldo negativo se valuó como 0 y no bloqueó el cierre.`,
        },
      });
    }
    const [existencias, lotesCierre] = await Promise.all([
      tx.existencias.findMany({ where: { negocio_id: negocioId } }),
      tx.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 } } }),
    ]);
    const totalesLote = new Map<string, { peso: number; costo: number }>();
    for (const lote of lotesCierre) {
      const key = `${lote.ubicacion_id}:${lote.product_id}`;
      const previo = totalesLote.get(key) ?? { peso: 0, costo: 0 };
      totalesLote.set(key, { peso: previo.peso + num0(lote.peso_disponible_lb), costo: previo.costo + num0(lote.costo_disponible) });
    }
    await tx.inventario_semanal.deleteMany({ where: { semana_id: semana.id } });
    if (existencias.length) {
      await tx.inventario_semanal.createMany({
        data: existencias.map((e) => {
          const lote = totalesLote.get(`${e.ubicacion_id}:${e.product_id}`);
          const disponible = Math.max(0, num0(e.cantidad_disponible));
          const reservada = Math.max(0, num0(e.cantidad_reservada));
          const transito = Math.max(0, num0(e.cantidad_transito));
          return {
          semana_id: semana.id, negocio_id: negocioId, ubicacion_id: e.ubicacion_id, product_id: e.product_id,
          cantidad_disponible: disponible, cantidad_reservada: reservada,
          cantidad_transito: transito, costo_promedio: e.costo_promedio,
          peso_total_lb: lote?.peso ?? null,
          costo_total: lote?.costo ?? r2((disponible + transito) * num0(e.costo_promedio)),
        }; }),
      });
    }
    await tx.semanas_operativas.update({ where: { id: semana.id }, data: { estado: 'cerrada', cerrado_por: usuarioId, cerrado_at: new Date() } });
    const balance = await calcularBalance(negocioId, semana.id, semana.termina_at, tx);
    return {
      facturas: creadas.length,
      balance,
      cajas_perdidas: alertaInventario.cajas_perdidas,
      productos_con_faltante: alertaInventario.saldos.length,
    };
  }, { isolationLevel: 'Serializable' });
  return { semana_id: Number(semana.id), anio: semana.anio, semana: semana.semana, ...cierre };
}

export async function reabrirSemana(negocioId: bigint, semanaId: bigint, usuarioId: bigint) {
  const s = await prisma.semanas_operativas.findFirst({ where: { id: semanaId, negocio_id: negocioId } });
  if (!s) throw new HttpError(404, 'Semana no encontrada');
  if (s.estado !== 'cerrada') throw new HttpError(409, 'La semana no está cerrada');
  // Una reapertura modifica el ledger vivo. Permitirla detrás de semanas posteriores
  // haría que sus fotografías dejaran de corresponder al saldo actual. Las correcciones
  // históricas deben empezar siempre por la última semana con operación.
  const [semanaPosterior, comprasPosteriores, produccionesPosteriores, pedidosPosteriores] = await Promise.all([
    prisma.semanas_operativas.findFirst({
      where: { negocio_id: negocioId, inicia_at: { gt: s.inicia_at }, estado: 'cerrada' },
      orderBy: { inicia_at: 'asc' }, select: { anio: true, semana: true },
    }),
    prisma.compras.count({ where: { negocio_id: negocioId, fecha: { gt: s.termina_at }, estado: { not: 'cancelada' } } }),
    prisma.producciones.count({ where: { negocio_id: negocioId, fecha: { gt: s.termina_at } } }),
    prisma.pedidos_operativos.count({ where: { negocio_id: negocioId, fecha_entrega: { gt: s.termina_at }, estado: { not: 'cancelado' }, lineas: { some: {} } } }),
  ]);
  if (semanaPosterior || comprasPosteriores || produccionesPosteriores || pedidosPosteriores) {
    const detalle = semanaPosterior ? ` La semana ${semanaPosterior.semana} de ${semanaPosterior.anio} ya está cerrada.` : '';
    throw new HttpError(409, `Solo se puede reabrir la última semana con operación.${detalle} Corrige primero desde la semana más reciente para conservar la trazabilidad.`);
  }
  const pagadas = await prisma.facturas.count({ where: { semana_id: s.id, estado: 'pagada' } });
  if (pagadas) throw new HttpError(409, 'No se puede reabrir una semana con facturas pagadas');
  const carniceria = await prisma.ubicaciones.findFirst({ where: { negocio_id: negocioId, codigo: 'CARN', activo: true }, select: { id: true } });
  const pedidos = await prisma.pedidos_operativos.findMany({
    where: { negocio_id: negocioId, fecha_entrega: { gte: s.inicia_at, lte: s.termina_at }, estado: 'cerrado' },
    select: { id: true },
  });
  const vinculados = pedidos.length ? await prisma.pedido_operativo_lineas.findMany({
    where: { pedido_id: { in: pedidos.map((p) => p.id) }, distribucion_lineas: { some: {} } },
    select: { pedido_id: true },
    distinct: ['pedido_id'],
  }) : [];
  const conPreparacion = vinculados.map((p) => p.pedido_id);
  const sinPreparacion = pedidos.filter((p) => !conPreparacion.some((id) => id === p.id)).map((p) => p.id);
  const inventariosFinales = await prisma.conteos.findMany({
    where: {
      negocio_id: negocioId, fecha: { gte: s.inicia_at, lte: s.termina_at },
      notas: { startsWith: 'inventario_final_operativo' },
    },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
  await prisma.$transaction(async (tx) => {
    const vigente = await tx.semanas_operativas.findUnique({ where: { id: s.id }, select: { estado: true } });
    if (vigente?.estado !== 'cerrada') throw new HttpError(409, 'La semana ya fue reabierta');
    await tx.facturas.updateMany({ where: { semana_id: s.id, estado: 'emitida' }, data: { estado: 'anulada' } });
    await tx.semanas_operativas.update({ where: { id: s.id }, data: { estado: 'reabierta', cerrado_at: null, cerrado_por: null } });
    await tx.pedidos_operativos.updateMany({ where: { id: { in: conPreparacion } }, data: { estado: 'en_preparacion' } });
    await tx.pedidos_operativos.updateMany({ where: { id: { in: sinPreparacion } }, data: { estado: 'confirmado' } });
    // El ajuste físico y la semana se revierten juntos; nunca queda una reapertura parcial.
    for (const inventario of inventariosFinales) await eliminarConteoEnTx(tx, negocioId, inventario.id, usuarioId, 'reabrir_semana');
    await tx.inventario_semanal.deleteMany({ where: { semana_id: s.id } });
  }, { isolationLevel: 'Serializable' });
  // La apertura se fija después de quitar el ajuste final. Esto también repara semanas antiguas
  // que fueron cerradas antes de que existiera la fotografía de inventario inicial.
  if (carniceria) await asegurarInventarioInicialSemanal(negocioId, usuarioId, iso(s.inicia_at), carniceria.id);
  return { ok: true, inventarios_finales_revertidos: inventariosFinales.length };
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

/** Cartera completa para Control: facturas emitidas y facturas recibidas de proveedores. */
export async function listarCartera(negocioId: bigint) {
  const [facturas, compras] = await Promise.all([
    prisma.facturas.findMany({
      where: { negocio_id: negocioId, estado: { in: ['emitida', 'pagada'] } },
      include: {
        semana: { select: { anio: true, semana: true } },
        empresa: { select: { nombre: true } },
        ubicacion: { select: { nombre: true } },
        pagos: { orderBy: { pagado_at: 'desc' } },
        lineas: { orderBy: { descripcion: 'asc' } },
      },
      orderBy: [{ vence_at: 'asc' }, { id: 'desc' }],
    }),
    prisma.compras.findMany({
      where: { negocio_id: negocioId, estado: { in: ['pendiente', 'pagada'] } },
      include: {
        proveedor: { select: { nombre: true } },
        ubicacion: { select: { nombre: true } },
        lineas: { include: { producto: { select: { nombre: true, unidad_distribucion: { select: { nombre: true } } } } } },
      },
      orderBy: [{ vence_at: 'asc' }, { id: 'desc' }],
    }),
  ]);

  const emitidas = facturas.map((f) => {
    const pagado = r2(f.pagos.reduce((total, pago) => total + num0(pago.monto), 0));
    return {
      id: Number(f.id),
      numero: f.numero,
      version: f.version,
      empresa: f.empresa.nombre,
      ubicacion: f.ubicacion.nombre,
      linea: f.linea_operacion,
      anio: f.semana.anio,
      semana: f.semana.semana,
      emitida_at: iso(f.emitida_at),
      vence_at: iso(f.vence_at),
      estado: f.estado,
      total: num0(f.total),
      pagado,
      saldo: r2(Math.max(0, num0(f.total) - pagado)),
      pagado_at: f.pagos[0] ? iso(f.pagos[0].pagado_at) : null,
      lineas: f.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: num0(l.cantidad), precio: num0(l.precio_unitario), importe: num0(l.importe) })),
    };
  });
  const recibidas = compras.map((c) => ({
    id: Number(c.id),
    referencia: c.referencia,
    proveedor: c.proveedor.nombre,
    ubicacion: c.ubicacion.nombre,
    recibida_at: iso(c.fecha),
    vence_at: iso(c.vence_at),
    estado: c.estado,
    total: num0(c.total),
    saldo: c.estado === 'pendiente' ? num0(c.total) : 0,
    pagado_at: c.pagado_at ? iso(c.pagado_at) : null,
    lineas: c.lineas.map((l) => ({ producto: l.producto.nombre, cantidad: num0(l.cajas), unidad: l.producto.unidad_distribucion.nombre, peso_lb: num0(l.peso_total_lb), importe: num0(l.costo_total) })),
  }));
  const pendientesEmitidas = emitidas.filter((f) => f.estado === 'emitida');
  const pendientesRecibidas = recibidas.filter((f) => f.estado === 'pendiente');
  const hoy = hoyChicago();

  return {
    resumen: {
      por_cobrar: r2(pendientesEmitidas.reduce((total, f) => total + f.saldo, 0)),
      vencido_cobrar: r2(pendientesEmitidas.filter((f) => f.vence_at < hoy).reduce((total, f) => total + f.saldo, 0)),
      facturas_por_cobrar: pendientesEmitidas.length,
      por_pagar: r2(pendientesRecibidas.reduce((total, f) => total + f.saldo, 0)),
      vencido_pagar: r2(pendientesRecibidas.filter((f) => f.vence_at < hoy).reduce((total, f) => total + f.saldo, 0)),
      facturas_por_pagar: pendientesRecibidas.length,
    },
    emitidas,
    recibidas,
  };
}

export async function pagarFactura(negocioId: bigint, facturaId: bigint, usuarioId: bigint, fechaPago: string) {
  const f = await prisma.facturas.findFirst({ where: { id: facturaId, negocio_id: negocioId, estado: 'emitida' }, include: { pagos: true } });
  if (!f) throw new HttpError(404, 'Factura pendiente no encontrada');
  if (fechaPago < iso(f.emitida_at)) throw new HttpError(400, 'La fecha de cobro no puede ser anterior a la emisión');
  if (fechaPago > hoyChicago()) throw new HttpError(400, 'La fecha de cobro no puede estar en el futuro');
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
  if (fechaPago < iso(c.fecha)) throw new HttpError(400, 'La fecha de pago no puede ser anterior a la compra');
  if (fechaPago > hoyChicago()) throw new HttpError(400, 'La fecha de pago no puede estar en el futuro');
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
