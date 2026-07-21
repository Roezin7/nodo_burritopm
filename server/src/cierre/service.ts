import type { LineaOperacion, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { coberturaPedidosBpm, preciosVentaSemana, sincronizarDespachosConfirmados } from '../operacion/service.js';
import { asegurarInventarioInicialSemanal, validarConciliacionParaCierre } from '../operacion/conciliacion.js';
import { eliminarConteoEnTx } from '../conteos/service.js';
import { transaccionSerializable } from '../lib/transaccion.js';
import { confirmarRecepcionesSinFaltantesEnRango } from '../distribuciones/service.js';
import { aplicarMovimiento } from '../ledger/service.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sumarDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86400000);
const hoyChicago = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

/**
 * Separa la pérdida histórica del saldo que abrirá la semana siguiente.
 * El faltante se informa en el cierre, pero nunca se convierte en una deuda de
 * inventario para la siguiente semana.
 */
export function saldoParaCierreSemanal(cantidad: number) {
  const saldo = r3(cantidad);
  const faltante = r3(Math.max(0, -saldo));
  return { disponible: r3(Math.max(0, saldo)), faltante, ajuste_apertura: faltante };
}

export interface DocumentoCarteraCliente {
  id: string;
  ubicacion_id: string;
  semana_id: string;
  emitida_at: Date;
  total: number;
  pagado: number;
}

/**
 * Los créditos pertenecen a la cuenta de una ubicación, no a una factura aislada.
 * Primero reducen documentos de la misma semana y después los más antiguos de Lisle.
 * Nunca pueden compensar la deuda de otro restaurante.
 */
export function distribuirCreditosCliente(documentos: DocumentoCarteraCliente[]) {
  const saldos = new Map<string, number>();
  const creditoAplicado = new Map<string, number>();
  const creditoDisponiblePorUbicacion = new Map<string, number>();
  const positivos = documentos.filter((d) => r2(d.total - d.pagado) > 0);
  for (const documento of positivos) saldos.set(documento.id, r2(documento.total - documento.pagado));

  const creditos = documentos
    .filter((d) => r2(d.total - d.pagado) < 0)
    .sort((a, b) => a.emitida_at.getTime() - b.emitida_at.getTime() || a.id.localeCompare(b.id));
  for (const credito of creditos) {
    let disponible = r2(-(credito.total - credito.pagado));
    const candidatos = positivos
      .filter((d) => d.ubicacion_id === credito.ubicacion_id && (saldos.get(d.id) ?? 0) > 0)
      .sort((a, b) => Number(b.semana_id === credito.semana_id) - Number(a.semana_id === credito.semana_id)
        || a.emitida_at.getTime() - b.emitida_at.getTime() || a.id.localeCompare(b.id));
    for (const factura of candidatos) {
      if (disponible <= 0) break;
      const saldo = saldos.get(factura.id) ?? 0;
      const aplicado = r2(Math.min(saldo, disponible));
      saldos.set(factura.id, r2(saldo - aplicado));
      creditoAplicado.set(factura.id, r2((creditoAplicado.get(factura.id) ?? 0) + aplicado));
      disponible = r2(disponible - aplicado);
    }
    if (disponible > 0) creditoDisponiblePorUbicacion.set(
      credito.ubicacion_id,
      r2((creditoDisponiblePorUbicacion.get(credito.ubicacion_id) ?? 0) + disponible),
    );
  }
  return {
    saldos,
    creditoAplicado,
    creditoDisponiblePorUbicacion,
    creditoDisponible: r2([...creditoDisponiblePorUbicacion.values()].reduce((total, monto) => total + monto, 0)),
  };
}

function saldosFacturas(facturas: {
  id: bigint;
  ubicacion_id: bigint;
  semana_id: bigint;
  emitida_at: Date;
  total: Prisma.Decimal;
  pagos: { monto: Prisma.Decimal; pagado_at: Date }[];
}[], pagosHasta?: Date, ignorarPagos = false) {
  return distribuirCreditosCliente(facturas.map((factura) => ({
    id: factura.id.toString(),
    ubicacion_id: factura.ubicacion_id.toString(),
    semana_id: factura.semana_id.toString(),
    emitida_at: factura.emitida_at,
    total: num0(factura.total),
    pagado: ignorarPagos ? 0 : r2(factura.pagos
      .filter((pago) => !pagosHasta || pago.pagado_at <= pagosHasta)
      .reduce((total, pago) => total + num0(pago.monto), 0)),
  })));
}

/** Semana operativa domingo-sábado, numerada con la semana ISO del lunes siguiente. */
export function semanaDeFecha(d: Date) {
  const domingo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  domingo.setUTCDate(domingo.getUTCDate() - domingo.getUTCDay());
  const x = sumarDias(domingo, 1);
  const dia = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dia);
  const anio = x.getUTCFullYear();
  const inicioAnio = new Date(Date.UTC(anio, 0, 1));
  const semana = Math.ceil((((x.getTime() - inicioAnio.getTime()) / 86400000) + 1) / 7);
  const sabado = sumarDias(domingo, 6);
  return { anio, semana, domingo, sabado };
}

/** El cierre lleva la semana actual y las dos anteriores (ventana móvil de 21 días). */
export function inicioVentanaCuentasPorCobrar(iniciaAt: Date) {
  return sumarDias(iniciaAt, -14);
}

export async function asegurarSemana(negocioId: bigint, fechaCierre: string) {
  const s = semanaDeFecha(fecha(fechaCierre));
  return prisma.semanas_operativas.upsert({
    where: { negocio_id_anio_semana: { negocio_id: negocioId, anio: s.anio, semana: s.semana } },
    create: { negocio_id: negocioId, anio: s.anio, semana: s.semana, inicia_at: s.domingo, termina_at: s.sabado },
    update: { inicia_at: s.domingo, termina_at: s.sabado },
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

async function prepararFacturacion(negocioId: bigint, desde: Date, hasta: Date) {
  const [pedidos, ajustes] = await Promise.all([
    prisma.pedidos_operativos.findMany({
      where: { negocio_id: negocioId, fecha_entrega: { gte: desde, lte: hasta }, estado: { notIn: ['borrador', 'cancelado'] } },
      include: {
        empresa: true, ubicacion: true,
        lineas: { include: { producto: true, distribucion_lineas: { select: { cantidad_recibida: true, cantidad_cargada: true, cantidad_aprobada: true, cantidad_sugerida: true } } } },
      },
    }),
    prisma.ajustes_facturacion.findMany({
      where: { negocio_id: negocioId, estado: 'abierto', semana: { inicia_at: desde, termina_at: hasta } },
      include: { empresa: true, ubicacion: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  if (!pedidos.length) throw new HttpError(400, 'No hay pedidos confirmados para cerrar esta semana');

  const productosVendidos = [...new Map(pedidos.flatMap((o) => o.lineas).map((l) => [l.product_id.toString(), l.producto])).values()];
  const preciosCalculados = await preciosVentaSemana(negocioId, productosVendidos, iso(desde), iso(hasta));
  const proteinasSinProduccion = productosVendidos.filter((p) => p.tipo_operativo === 'proteina' && preciosCalculados.get(p.id.toString()) == null);
  if (proteinasSinProduccion.length) {
    throw new HttpError(409, `Falta registrar producción semanal para calcular costo + $15 de: ${proteinasSinProduccion.map((p) => p.nombre).join(', ')}.`);
  }
  const precios = new Map([...preciosCalculados].map(([id, precio]) => [id, precio ?? 0]));
  type Grupo = {
    empresa: (typeof pedidos)[number]['empresa'];
    ubicacion: (typeof pedidos)[number]['ubicacion'];
    linea: LineaOperacion;
    items: Map<string, { productId: bigint | null; ajusteId?: bigint; descripcion: string; cantidad: number; precio: number }>;
  };
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
  for (const ajuste of ajustes) {
    const k = `${ajuste.ubicacion_id}:${ajuste.linea_operacion}`;
    if (!grupos.has(k)) grupos.set(k, { empresa: ajuste.empresa, ubicacion: ajuste.ubicacion, linea: ajuste.linea_operacion, items: new Map() });
    grupos.get(k)!.items.set(`ajuste:${ajuste.id}`, {
      productId: null,
      ajusteId: ajuste.id,
      descripcion: ajuste.descripcion,
      cantidad: 1,
      precio: r2(num0(ajuste.monto) * (ajuste.tipo === 'credito' ? -1 : 1)),
    });
  }
  return { pedidos, precios, grupos, ajustes };
}

type Db = Prisma.TransactionClient | typeof prisma;

async function valuacionInventario(negocioId: bigint, db: Db = prisma) {
  const [existencias, lotes] = await Promise.all([
    db.existencias.findMany({
      // Billing valúa únicamente lo que pertenece al centro de operación. Lo ya entregado
      // a restaurantes no vuelve a contarse como inventario de Carnicería/Bodega Adison.
      where: {
        negocio_id: negocioId,
        ubicaciones: { tipo: 'bodega' },
        OR: [{ cantidad_disponible: { gt: 0 } }, { cantidad_transito: { gt: 0 } }],
      },
      include: { products: { select: { linea_operacion: true, tipo_operativo: true } }, ubicaciones: { select: { nombre: true } } },
    }),
    db.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 }, producto: { tipo_operativo: 'materia_prima' } } }),
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

async function calcularBalance(negocioId: bigint, semanaId: bigint, terminaAt: Date, db: Db = prisma, usarInventarioVivo = false) {
  const semana = await db.semanas_operativas.findUnique({
    where: { id: semanaId },
    select: { estado: true, inicia_at: true, valor_carne: true, valor_congelado: true, valor_desechables: true },
  });
  // Después del cierre el inventario guardado es la fotografía contable. Cobrar o pagar
  // días después solo actualiza cartera; nunca sustituye esa foto con el inventario vivo.
  const inv = semana?.estado === 'cerrada' && !usarInventarioVivo
    ? { valor_carne: num0(semana.valor_carne), valor_congelado: num0(semana.valor_congelado), valor_desechables: num0(semana.valor_desechables) }
    : await valuacionInventario(negocioId, db);
  const facturas = await db.facturas.findMany({
    // Billing trabaja con una ventana móvil: semana del cierre + dos anteriores.
    where: {
      negocio_id: negocioId,
      estado: { in: ['emitida', 'pagada'] },
      emitida_at: { lte: terminaAt },
      semana: { inicia_at: { gte: inicioVentanaCuentasPorCobrar(semana!.inicia_at) }, termina_at: { lte: terminaAt } },
    },
    include: { pagos: true },
  });
  // El balance de una semana es una fotografía al sábado. Un cobro o pago registrado
  // después no debe reescribir retroactivamente lo que seguía abierto en ese cierre.
  // El cobro BPM es automático por antigüedad. Mientras una semana esté en la
  // ventana de tres semanas se considera por cobrar; después sale del ciclo.
  // Los pagos_cliente históricos no alteran este libro móvil.
  const cartera = saldosFacturas(facturas, terminaAt, true);
  const cobrar = r2([...cartera.saldos.values()].reduce((total, saldo) => total + saldo, 0));
  const compras = await db.compras.findMany({
    where: {
      negocio_id: negocioId,
      fecha: { lte: terminaAt },
      estado: { not: 'cancelada' },
      OR: [{ estado: 'pendiente' }, { estado: 'pagada', pagado_at: { gt: terminaAt } }],
    },
    select: { total: true },
  });
  const pagar = r2(compras.reduce((a, c) => a + num0(c.total), 0));
  const balance = r2(inv.valor_carne + inv.valor_congelado + inv.valor_desechables + cobrar - pagar);
  await db.semanas_operativas.update({ where: { id: semanaId }, data: { ...inv, cuentas_por_cobrar: cobrar, cuentas_por_pagar: pagar, balance_neto: balance } });
  return { ...inv, cuentas_por_cobrar: cobrar, cuentas_por_pagar: pagar, balance_neto: balance };
}

async function actualizarUltimoBalance(negocioId: bigint) {
  const semana = await prisma.semanas_operativas.findFirst({ where: { negocio_id: negocioId, estado: 'cerrada' }, orderBy: [{ anio: 'desc' }, { semana: 'desc' }] });
  if (semana) await calcularBalance(negocioId, semana.id, semana.termina_at);
}

type SemanaCierre = Awaited<ReturnType<typeof asegurarSemana>>;

async function validarSemanaCerrable(negocioId: bigint, semana: SemanaCierre) {
  // La valuación parte del ledger vivo; una operación posterior haría que la fotografía
  // histórica de esta semana fuera incorrecta.
  const [comprasPosteriores, produccionesPosteriores, produccionesExtraordinariasPosteriores, pedidosPosteriores] = await Promise.all([
    prisma.compras.count({ where: { negocio_id: negocioId, fecha: { gt: semana.termina_at }, estado: { not: 'cancelada' } } }),
    prisma.producciones.count({ where: { negocio_id: negocioId, fecha: { gt: semana.termina_at } } }),
    prisma.producciones_extraordinarias.count({ where: { negocio_id: negocioId, fecha: { gt: semana.termina_at } } }),
    prisma.pedidos_operativos.count({ where: { negocio_id: negocioId, fecha_entrega: { gt: semana.termina_at }, estado: { not: 'cancelado' }, lineas: { some: {} } } }),
  ]);
  if (comprasPosteriores || produccionesPosteriores || produccionesExtraordinariasPosteriores || pedidosPosteriores) {
    throw new HttpError(409, 'Hay operación capturada en una semana posterior. Cierra las semanas en orden para que la fotografía de inventario sea correcta.');
  }

  const negocio = await prisma.negocios.findUnique({ where: { id: negocioId }, select: { reparto_habilitado: true } });
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
    negocio?.reparto_habilitado ? prisma.distribuciones.count({
      where: {
        negocio_id: negocioId,
        fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at },
        estado: { notIn: ['entregada', 'cerrada', 'cerrada_con_incidencias', 'cancelada'] },
      },
    }) : Promise.resolve(0),
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
    throw new HttpError(409, negocio?.reparto_habilitado
      ? `Faltan ${pedidosSinPreparar} venta(s) por integrar a un despacho antes del cierre.`
      : `No se pudieron integrar ${pedidosSinPreparar} venta(s) al despacho automático. Vuelve a intentar el cierre; no requieren preparación manual.`);
  }
  if (distribucionesActivas) {
    throw new HttpError(409, `Faltan ${distribucionesActivas} despacho(s) por completar antes del cierre.`);
  }
  return validarConciliacionParaCierre(negocioId, iso(semana.inicia_at), iso(semana.termina_at));
}

/**
 * Completa despachos automáticos pendientes cuando Reparto está desactivado. Esto permite
 * cerrar capturas tardías sin revivir el paso eliminado de Preparación y conserva el ledger.
 */
async function sincronizarVentasParaCierre(negocioId: bigint, usuarioId: bigint, semana: SemanaCierre) {
  const negocio = await prisma.negocios.findUnique({ where: { id: negocioId }, select: { reparto_habilitado: true } });
  if (!negocio?.reparto_habilitado) {
    const desde = iso(semana.inicia_at);
    const hasta = iso(semana.termina_at);
    await sincronizarDespachosConfirmados(negocioId, usuarioId, desde, hasta);
    // Si Reparto se apagó después de cargar el camión, pueden quedar despachos antiguos
    // detenidos en tránsito. El cierre los recibe completos de forma automática; Auditoría
    // sigue disponible únicamente cuando exista un faltante real.
    await confirmarRecepcionesSinFaltantesEnRango(negocioId, usuarioId, desde, hasta);
  }
}

/** Calcula el resultado del cierre sin crear facturas, incidencias ni fotografías de cierre. */
export async function vistaPreviaCierre(negocioId: bigint, usuarioId: bigint, fechaCierre: string) {
  const periodo = semanaDeFecha(fecha(fechaCierre));
  if (iso(periodo.sabado) > hoyChicago()) throw new HttpError(409, 'No se puede cerrar una semana que todavía no termina');
  const semana = await asegurarSemana(negocioId, fechaCierre);
  if (semana.estado === 'cerrada') throw new HttpError(409, 'La semana ya está cerrada');

  await sincronizarVentasParaCierre(negocioId, usuarioId, semana);
  const alertaInventario = await validarSemanaCerrable(negocioId, semana);
  const { grupos, ajustes } = await prepararFacturacion(negocioId, semana.inicia_at, semana.termina_at);
  const facturas = [...grupos.values()].flatMap((g) => {
    const lineas = [...g.items.values()].filter((item) => item.cantidad > 0);
    if (!lineas.length) return [];
    const total = r2(lineas.reduce((suma, item) => suma + item.cantidad * item.precio, 0));
    const diasCredito = g.linea === 'carne' ? g.empresa.dias_credito_carne : g.empresa.dias_credito_desechables;
    return [{
      numero: numeroFactura(semana.anio, semana.semana, g.empresa.codigo, g.ubicacion.codigo, g.linea),
      ubicacion_id: g.ubicacion.id.toString(),
      empresa: g.empresa.nombre,
      ubicacion: g.ubicacion.nombre,
      linea: g.linea,
      vence_at: iso(sumarDias(semana.termina_at, diasCredito)),
      productos: lineas.length,
      unidades: r3(lineas.reduce((suma, item) => suma + item.cantidad, 0)),
      total,
    }];
  }).sort((a, b) => a.ubicacion.localeCompare(b.ubicacion, 'es') || a.linea.localeCompare(b.linea));

  const [inventario, facturasAnteriores, comprasPendientes] = await Promise.all([
    valuacionInventario(negocioId),
    prisma.facturas.findMany({
      where: {
        negocio_id: negocioId,
        estado: { in: ['emitida', 'pagada'] },
        emitida_at: { lte: semana.termina_at },
        NOT: { semana_id: semana.id },
        semana: {
          inicia_at: { gte: inicioVentanaCuentasPorCobrar(semana.inicia_at) },
          termina_at: { lte: semana.termina_at },
        },
      },
      include: { pagos: true },
    }),
    prisma.compras.findMany({
      where: { negocio_id: negocioId, estado: 'pendiente', fecha: { lte: semana.termina_at } },
      select: { total: true },
    }),
  ]);
  const documentosAnteriores: DocumentoCarteraCliente[] = facturasAnteriores.map((factura) => ({
    id: factura.id.toString(), ubicacion_id: factura.ubicacion_id.toString(), semana_id: factura.semana_id.toString(),
    emitida_at: factura.emitida_at, total: num0(factura.total),
    pagado: 0,
  }));
  const porCobrarActual = r2([...distribuirCreditosCliente(documentosAnteriores).saldos.values()].reduce((total, saldo) => total + saldo, 0));
  const ventaCarne = r2(facturas.filter((f) => f.linea === 'carne').reduce((total, f) => total + f.total, 0));
  const ventaDesechables = r2(facturas.filter((f) => f.linea === 'desechables').reduce((total, f) => total + f.total, 0));
  const ventaTotal = r2(ventaCarne + ventaDesechables);
  const documentosProyectados: DocumentoCarteraCliente[] = facturas.map((factura, indice) => ({
    id: `previa:${indice}`, ubicacion_id: factura.ubicacion_id, semana_id: semana.id.toString(),
    emitida_at: semana.termina_at, total: factura.total, pagado: 0,
  }));
  const porCobrar = r2([...distribuirCreditosCliente([...documentosAnteriores, ...documentosProyectados]).saldos.values()]
    .reduce((total, saldo) => total + saldo, 0));
  const porPagar = r2(comprasPendientes.reduce((total, compra) => total + num0(compra.total), 0));
  const inventarioTotal = r2(inventario.valor_carne + inventario.valor_congelado + inventario.valor_desechables);

  return {
    semana: { anio: semana.anio, numero: semana.semana, inicia_at: iso(semana.inicia_at), termina_at: iso(semana.termina_at) },
    generado_at: new Date().toISOString(),
    ventas: { carne: ventaCarne, desechables: ventaDesechables, total: ventaTotal },
    inventario: { ...inventario, total: inventarioTotal },
    cartera: { por_cobrar_actual: porCobrarActual, por_cobrar_al_cierre: porCobrar, por_pagar: porPagar },
    balance_estimado: r2(inventarioTotal + porCobrar - porPagar),
    ajustes: ajustes.map((ajuste) => ({
      id: Number(ajuste.id),
      tipo: ajuste.tipo,
      descripcion: ajuste.descripcion,
      ubicacion: ajuste.ubicacion.nombre,
      linea: ajuste.linea_operacion,
      monto: r2(num0(ajuste.monto) * (ajuste.tipo === 'credito' ? -1 : 1)),
    })),
    facturas,
    cajas_perdidas: alertaInventario.cajas_perdidas,
    productos_con_faltante: alertaInventario.saldos.length,
  };
}

export async function cerrarSemana(negocioId: bigint, usuarioId: bigint, fechaCierre: string) {
  const periodoSolicitado = semanaDeFecha(fecha(fechaCierre));
  if (iso(periodoSolicitado.sabado) > hoyChicago()) throw new HttpError(409, 'No se puede cerrar una semana que todavía no termina');
  const semana = await asegurarSemana(negocioId, fechaCierre);
  if (semana.estado === 'cerrada') throw new HttpError(409, 'La semana ya está cerrada');

  await sincronizarVentasParaCierre(negocioId, usuarioId, semana);
  await validarSemanaCerrable(negocioId, semana);
  const { pedidos, precios, grupos } = await prepararFacturacion(negocioId, semana.inicia_at, semana.termina_at);

  const cierre = await transaccionSerializable(async (tx) => {
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
      const ajustesIds = items.flatMap((item) => item.ajusteId ? [item.ajusteId] : []);
      if (ajustesIds.length) await tx.ajustes_facturacion.updateMany({
        where: { id: { in: ajustesIds }, negocio_id: negocioId, estado: 'abierto' },
        data: { estado: 'aplicado', factura_id: f.id, aplicado_at: new Date() },
      });
      creadas.push(f);
    }
    for (const p of pedidos) {
      for (const l of p.lineas) await tx.pedido_operativo_lineas.update({ where: { id: l.id }, data: { precio_unitario: precios.get(l.product_id.toString()) ?? l.precio_unitario } });
    }
    await tx.pedidos_operativos.updateMany({ where: { id: { in: pedidos.map((p) => p.id) } }, data: { estado: 'cerrado' } });
    const [existencias, lotesCierre] = await Promise.all([
      tx.existencias.findMany({
        where: { negocio_id: negocioId },
        include: { ubicaciones: { select: { tipo: true } } },
      }),
      tx.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 } } }),
    ]);
    // Solo los saldos de bodega forman parte de la conciliación y alerta semanal.
    const saldosCierre = existencias.flatMap((existencia) => {
      const saldo = saldoParaCierreSemanal(num0(existencia.cantidad_disponible));
      return existencia.ubicaciones.tipo === 'bodega' && saldo.faltante > 0
        ? [{ existencia, cantidad: saldo.faltante }]
        : [];
    });
    // Un saldo negativo representa cajas que salieron sin respaldo registrado. No tiene valor
    // contable ni bloquea el cierre: se conserva en la fotografía y se abre una incidencia visible.
    for (const saldo of saldosCierre) {
      const existente = await tx.incidencias.findFirst({
        where: {
          negocio_id: negocioId, tipo: 'cajas_perdidas_inventario', estado: 'abierta',
          documento_tipo: 'cierre', documento_id: semana.id,
          ubicacion_id: saldo.existencia.ubicacion_id, product_id: saldo.existencia.product_id,
        },
        select: { id: true },
      });
      if (!existente) await tx.incidencias.create({
        data: {
          negocio_id: negocioId, tipo: 'cajas_perdidas_inventario', prioridad: 'alta',
          ubicacion_id: saldo.existencia.ubicacion_id, product_id: saldo.existencia.product_id,
          documento_tipo: 'cierre', documento_id: semana.id, responsable_id: usuarioId,
          comentarios: `${saldo.cantidad} cajas faltantes al cerrar la semana ${semana.semana}. El saldo negativo se valuó como 0 y no se arrastrará a la semana siguiente.`,
        },
      });
    }
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
          const saldo = saldoParaCierreSemanal(num0(e.cantidad_disponible));
          const disponible = saldo.disponible;
          const reservada = Math.max(0, num0(e.cantidad_reservada));
          const transito = Math.max(0, num0(e.cantidad_transito));
          return {
          semana_id: semana.id, negocio_id: negocioId, ubicacion_id: e.ubicacion_id, product_id: e.product_id,
          cantidad_disponible: disponible, cantidad_faltante: saldo.faltante, cantidad_reservada: reservada,
          cantidad_transito: transito, costo_promedio: e.costo_promedio,
          peso_total_lb: lote?.peso ?? null,
          costo_total: lote?.costo ?? r2((disponible + transito) * num0(e.costo_promedio)),
        }; }),
      });
    }
    // La incidencia y la fotografía se crean antes de este ajuste. El movimiento
    // deja la nueva semana en cero y permite revertir exactamente el cierre.
    for (const saldo of saldosCierre) {
      await aplicarMovimiento(tx, {
        negocioId,
        productId: saldo.existencia.product_id,
        tipo: 'ajuste_positivo',
        cantidad: saldo.cantidad,
        usuarioId,
        destinoId: saldo.existencia.ubicacion_id,
        documentoTipo: 'cierre_arrastre',
        documentoId: semana.id,
        comentario: `Inicio sin faltantes heredados después del cierre de semana ${semana.semana}`,
        idempotencyKey: `cierre-arrastre:${semana.id}:${saldo.existencia.ubicacion_id}:${saldo.existencia.product_id}`,
        deltas: [{
          ubicacionId: saldo.existencia.ubicacion_id,
          productId: saldo.existencia.product_id,
          disponible: saldo.cantidad,
        }],
      });
    }
    await tx.semanas_operativas.update({ where: { id: semana.id }, data: { estado: 'cerrada', cerrado_por: usuarioId, cerrado_at: new Date() } });
    const balance = await calcularBalance(negocioId, semana.id, semana.termina_at, tx, true);
    return {
      facturas: creadas.length,
      balance,
      cajas_perdidas: r3(saldosCierre.reduce((total, saldo) => total + saldo.cantidad, 0)),
      productos_con_faltante: saldosCierre.length,
    };
  });
  return { semana_id: Number(semana.id), anio: semana.anio, semana: semana.semana, ...cierre };
}

export async function reabrirSemana(negocioId: bigint, semanaId: bigint, usuarioId: bigint) {
  const s = await prisma.semanas_operativas.findFirst({ where: { id: semanaId, negocio_id: negocioId } });
  if (!s) throw new HttpError(404, 'Semana no encontrada');
  if (s.estado !== 'cerrada') throw new HttpError(409, 'La semana no está cerrada');
  // Una reapertura modifica el ledger vivo. Permitirla detrás de semanas posteriores
  // haría que sus fotografías dejaran de corresponder al saldo actual. Las correcciones
  // históricas deben empezar siempre por la última semana con operación.
  const [semanaPosterior, comprasPosteriores, produccionesPosteriores, produccionesExtraordinariasPosteriores, pedidosPosteriores] = await Promise.all([
    prisma.semanas_operativas.findFirst({
      where: { negocio_id: negocioId, inicia_at: { gt: s.inicia_at }, estado: 'cerrada' },
      orderBy: { inicia_at: 'asc' }, select: { anio: true, semana: true },
    }),
    prisma.compras.count({ where: { negocio_id: negocioId, fecha: { gt: s.termina_at }, estado: { not: 'cancelada' } } }),
    prisma.producciones.count({ where: { negocio_id: negocioId, fecha: { gt: s.termina_at } } }),
    prisma.producciones_extraordinarias.count({ where: { negocio_id: negocioId, fecha: { gt: s.termina_at } } }),
    prisma.pedidos_operativos.count({ where: { negocio_id: negocioId, fecha_entrega: { gt: s.termina_at }, estado: { not: 'cancelado' }, lineas: { some: {} } } }),
  ]);
  if (semanaPosterior || comprasPosteriores || produccionesPosteriores || produccionesExtraordinariasPosteriores || pedidosPosteriores) {
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
  await transaccionSerializable(async (tx) => {
    const vigente = await tx.semanas_operativas.findUnique({ where: { id: s.id }, select: { estado: true } });
    if (vigente?.estado !== 'cerrada') throw new HttpError(409, 'La semana ya fue reabierta');
    await tx.facturas.updateMany({ where: { semana_id: s.id, estado: 'emitida' }, data: { estado: 'anulada' } });
    await tx.ajustes_facturacion.updateMany({
      where: { semana_id: s.id, estado: 'aplicado' },
      data: { estado: 'abierto', factura_id: null, aplicado_at: null },
    });
    await tx.semanas_operativas.update({ where: { id: s.id }, data: { estado: 'reabierta', cerrado_at: null, cerrado_por: null } });
    await tx.pedidos_operativos.updateMany({ where: { id: { in: conPreparacion } }, data: { estado: 'en_preparacion' } });
    await tx.pedidos_operativos.updateMany({ where: { id: { in: sinPreparacion } }, data: { estado: 'confirmado' } });
    const ajustesArrastre = await tx.movimientos_inventario.findMany({
      where: { negocio_id: negocioId, documento_tipo: 'cierre_arrastre', documento_id: s.id },
      select: { product_id: true, ubicacion_destino_id: true, cantidad: true },
    });
    for (const ajuste of ajustesArrastre) {
      if (!ajuste.ubicacion_destino_id) continue;
      await tx.existencias.updateMany({
        where: { ubicacion_id: ajuste.ubicacion_destino_id, product_id: ajuste.product_id },
        data: { cantidad_disponible: { decrement: ajuste.cantidad } },
      });
    }
    await tx.movimientos_inventario.deleteMany({
      where: { negocio_id: negocioId, documento_tipo: 'cierre_arrastre', documento_id: s.id },
    });
    // El ajuste físico y la semana se revierten juntos; nunca queda una reapertura parcial.
    for (const inventario of inventariosFinales) await eliminarConteoEnTx(tx, negocioId, inventario.id, usuarioId, 'reabrir_semana');
    await tx.inventario_semanal.deleteMany({ where: { semana_id: s.id } });
  });
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
  const periodoActual = semanaDeFecha(fecha(hoyChicago()));
  const inicioCiclo = inicioVentanaCuentasPorCobrar(periodoActual.domingo);
  const [facturas, compras, ajustes] = await Promise.all([
    prisma.facturas.findMany({
      where: { negocio_id: negocioId, estado: { in: ['emitida', 'pagada'] } },
      include: {
        semana: { select: { anio: true, semana: true, inicia_at: true, termina_at: true } },
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
        lineas: { include: { producto: { select: { nombre: true, es_cargo_compra: true, unidad_distribucion: { select: { nombre: true } } } } } },
      },
      orderBy: [{ vence_at: 'asc' }, { id: 'desc' }],
    }),
    prisma.ajustes_facturacion.findMany({
      where: { negocio_id: negocioId, tipo: 'credito' },
      include: {
        semana: { select: { anio: true, semana: true, estado: true } },
        ubicacion: { select: { nombre: true } },
        factura: { select: { numero: true } },
      },
      orderBy: [{ semana: { inicia_at: 'desc' } }, { id: 'desc' }],
    }),
  ]);

  const facturasCiclo = facturas.filter((factura) => factura.semana.inicia_at >= inicioCiclo && factura.semana.termina_at <= periodoActual.sabado);
  const cartera = saldosFacturas(facturasCiclo, undefined, true);
  const emitidas = facturas.filter((f) => num0(f.total) >= 0).map((f) => {
    const pagado = r2(f.pagos.reduce((total, pago) => total + num0(pago.monto), 0));
    const enCiclo = f.semana.inicia_at >= inicioCiclo && f.semana.termina_at <= periodoActual.sabado;
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
      en_ciclo: enCiclo,
      estado_cartera: enCiclo ? 'en_ciclo' : 'cobrada_automatica',
      sale_ciclo_at: iso(sumarDias(f.semana.termina_at, 15)),
      credito_aplicado: enCiclo ? cartera.creditoAplicado.get(f.id.toString()) ?? 0 : 0,
      saldo: enCiclo ? cartera.saldos.get(f.id.toString()) ?? 0 : 0,
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
    lineas: c.lineas.map((l) => ({
      producto: l.producto.nombre,
      cantidad: l.producto.es_cargo_compra ? 1 : num0(l.cajas),
      unidad: l.producto.es_cargo_compra ? 'Cargo contable' : l.producto.unidad_distribucion.nombre,
      peso_lb: l.producto.es_cargo_compra ? 0 : num0(l.peso_total_lb),
      importe: num0(l.costo_total),
    })),
  }));
  const pendientesEmitidas = emitidas.filter((f) => f.en_ciclo && f.saldo > 0);
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
      credito_lisle_disponible: cartera.creditoDisponible,
    },
    emitidas,
    recibidas,
    creditos: ajustes.map((ajuste) => ({
      id: Number(ajuste.id),
      anio: ajuste.semana.anio,
      semana: ajuste.semana.semana,
      semana_estado: ajuste.semana.estado,
      ubicacion: ajuste.ubicacion.nombre,
      descripcion: ajuste.descripcion,
      monto: num0(ajuste.monto),
      estado: ajuste.estado,
      factura: ajuste.factura?.numero ?? null,
      creado_at: ajuste.creado_at.toISOString(),
    })),
  };
}

export async function registrarCreditoLisle(
  negocioId: bigint,
  usuarioId: bigint,
  entrada: { fecha_semana: string; monto: number; descripcion: string; idempotency_key: string },
) {
  const semana = await asegurarSemana(negocioId, entrada.fecha_semana);
  if (semana.estado === 'cerrada') throw new HttpError(409, 'La semana está cerrada. Reábrela antes de agregar el crédito de Lisle.');
  const lisle = await prisma.ubicaciones.findFirst({
    where: { negocio_id: negocioId, activo: true, empresa_cliente_id: { not: null }, OR: [{ codigo: 'LISLE' }, { nombre: { equals: 'Lisle', mode: 'insensitive' } }] },
    select: { id: true, empresa_cliente_id: true },
  });
  if (!lisle?.empresa_cliente_id) throw new HttpError(409, 'No se encontró la ubicación activa de Lisle con empresa asignada.');

  return transaccionSerializable(async (tx) => {
    const existente = await tx.ajustes_facturacion.findFirst({
      where: { negocio_id: negocioId, idempotency_key: entrada.idempotency_key },
    });
    if (existente) return { ok: true, id: Number(existente.id), semana: semana.semana };
    const ajuste = await tx.ajustes_facturacion.create({
      data: {
        negocio_id: negocioId,
        semana_id: semana.id,
        empresa_cliente_id: lisle.empresa_cliente_id!,
        ubicacion_id: lisle.id,
        linea_operacion: 'carne',
        tipo: 'credito',
        descripcion: entrada.descripcion,
        monto: entrada.monto,
        creado_por: usuarioId,
        idempotency_key: entrada.idempotency_key,
      },
    });
    await tx.auditoria_operativa.create({
      data: {
        negocio_id: negocioId, usuario_id: usuarioId, accion: 'crear_credito_lisle',
        entidad: 'ajuste_facturacion', entidad_id: ajuste.id,
        datos: { semana: semana.semana, anio: semana.anio, monto: entrada.monto, descripcion: entrada.descripcion },
      },
    });
    return { ok: true, id: Number(ajuste.id), semana: semana.semana };
  }, { reintentarUnico: true });
}

export async function eliminarCreditoLisle(negocioId: bigint, ajusteId: bigint, usuarioId: bigint) {
  return transaccionSerializable(async (tx) => {
    const ajuste = await tx.ajustes_facturacion.findFirst({
      where: { id: ajusteId, negocio_id: negocioId, tipo: 'credito' },
      include: { ubicacion: { select: { codigo: true } } },
    });
    if (!ajuste || ajuste.ubicacion.codigo !== 'LISLE') throw new HttpError(404, 'Crédito de Lisle no encontrado');
    if (ajuste.estado !== 'abierto') throw new HttpError(409, 'El crédito ya fue aplicado. Reabre la semana para corregirlo.');
    await tx.ajustes_facturacion.delete({ where: { id: ajuste.id } });
    await tx.auditoria_operativa.create({
      data: {
        negocio_id: negocioId, usuario_id: usuarioId, accion: 'eliminar_credito_lisle',
        entidad: 'ajuste_facturacion', entidad_id: ajuste.id,
        datos: { monto: num0(ajuste.monto), descripcion: ajuste.descripcion },
      },
    });
    return { ok: true };
  });
}

export async function pagarFactura(negocioId: bigint, facturaId: bigint, usuarioId: bigint, fechaPago: string) {
  if (fechaPago > hoyChicago()) throw new HttpError(400, 'La fecha de cobro no puede estar en el futuro');
  const saldo = await transaccionSerializable(async (tx) => {
    const f = await tx.facturas.findFirst({ where: { id: facturaId, negocio_id: negocioId, estado: 'emitida', total: { gte: 0 } } });
    if (!f) throw new HttpError(404, 'Factura pendiente no encontrada');
    if (fechaPago < iso(f.emitida_at)) throw new HttpError(400, 'La fecha de cobro no puede ser anterior a la emisión');
    const documentos = await tx.facturas.findMany({
      where: { negocio_id: negocioId, estado: { in: ['emitida', 'pagada'] } },
      include: { pagos: true },
    });
    const monto = saldosFacturas(documentos).saldos.get(f.id.toString()) ?? 0;
    if (monto <= 0) throw new HttpError(409, 'La factura ya quedó cubierta por un crédito de Lisle. Recarga la cartera.');
    await tx.pagos_cliente.create({ data: { factura_id: f.id, monto, pagado_at: fecha(fechaPago), registrado_por: usuarioId } });
    await tx.facturas.update({ where: { id: f.id }, data: { estado: 'pagada' } });
    return monto;
  });
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

export async function pagarFacturasLote(negocioId: bigint, facturaIds: bigint[], usuarioId: bigint, fechaPago: string) {
  if (fechaPago > hoyChicago()) throw new HttpError(400, 'La fecha de cobro no puede estar en el futuro');
  const resultado = await transaccionSerializable(async (tx) => {
    const facturas = await tx.facturas.findMany({
      where: { id: { in: facturaIds }, negocio_id: negocioId, estado: 'emitida', total: { gte: 0 } },
    });
    if (facturas.length !== new Set(facturaIds.map(String)).size) throw new HttpError(409, 'Una o más facturas ya no están pendientes. Recarga la cartera.');
    for (const factura of facturas) if (fechaPago < iso(factura.emitida_at)) throw new HttpError(400, `${factura.numero}: la fecha es anterior a la emisión`);
    const documentos = await tx.facturas.findMany({
      where: { negocio_id: negocioId, estado: { in: ['emitida', 'pagada'] } },
      include: { pagos: true },
    });
    const cartera = saldosFacturas(documentos);
    const saldos = new Map(facturas.map((factura) => [factura.id.toString(), cartera.saldos.get(factura.id.toString()) ?? 0]));
    if ([...saldos.values()].some((saldo) => saldo <= 0)) throw new HttpError(409, 'Una o más facturas ya quedaron cubiertas por créditos. Recarga la cartera.');
    const total = r2([...saldos.values()].reduce((suma, saldo) => suma + saldo, 0));
    for (const factura of facturas) {
      const saldo = saldos.get(factura.id.toString())!;
      await tx.pagos_cliente.create({ data: { factura_id: factura.id, monto: saldo, pagado_at: fecha(fechaPago), registrado_por: usuarioId } });
      await tx.facturas.update({ where: { id: factura.id }, data: { estado: 'pagada' } });
    }
    await tx.auditoria_operativa.create({ data: { negocio_id: negocioId, usuario_id: usuarioId, accion: 'pagar_masivo', entidad: 'facturas', datos: { ids: facturaIds.map(Number), fecha_pago: fechaPago, total } } });
    return { facturas: facturas.length, total };
  });
  await actualizarUltimoBalance(negocioId);
  return { ok: true, ...resultado };
}

export async function pagarComprasLote(negocioId: bigint, compraIds: bigint[], usuarioId: bigint, fechaPago: string) {
  if (fechaPago > hoyChicago()) throw new HttpError(400, 'La fecha de pago no puede estar en el futuro');
  const resultado = await transaccionSerializable(async (tx) => {
    const compras = await tx.compras.findMany({ where: { id: { in: compraIds }, negocio_id: negocioId, estado: 'pendiente' } });
    if (compras.length !== new Set(compraIds.map(String)).size) throw new HttpError(409, 'Una o más compras ya no están pendientes. Recarga la cartera.');
    for (const compra of compras) if (fechaPago < iso(compra.fecha)) throw new HttpError(400, `Compra #${compra.id}: la fecha es anterior a la compra`);
    const total = r2(compras.reduce((suma, compra) => suma + num0(compra.total), 0));
    await tx.compras.updateMany({ where: { id: { in: compraIds } }, data: { estado: 'pagada', pagado_at: fecha(fechaPago) } });
    await tx.auditoria_operativa.create({ data: { negocio_id: negocioId, usuario_id: usuarioId, accion: 'pagar_masivo', entidad: 'compras', datos: { ids: compraIds.map(Number), fecha_pago: fechaPago, total } } });
    return { compras: compras.length, total };
  });
  await actualizarUltimoBalance(negocioId);
  return { ok: true, ...resultado };
}

export async function revertirPagoFactura(negocioId: bigint, facturaId: bigint, usuarioId: bigint) {
  const factura = await prisma.facturas.findFirst({ where: { id: facturaId, negocio_id: negocioId, estado: 'pagada' }, include: { pagos: true } });
  if (!factura) throw new HttpError(404, 'Factura pagada no encontrada');
  const monto = r2(factura.pagos.reduce((suma, pago) => suma + num0(pago.monto), 0));
  await prisma.$transaction(async (tx) => {
    await tx.pagos_cliente.deleteMany({ where: { factura_id: factura.id } });
    await tx.facturas.update({ where: { id: factura.id }, data: { estado: 'emitida' } });
    await tx.auditoria_operativa.create({ data: { negocio_id: negocioId, usuario_id: usuarioId, accion: 'revertir_pago', entidad: 'factura', entidad_id: factura.id, datos: { monto } } });
  });
  await actualizarUltimoBalance(negocioId);
  return { ok: true, monto };
}

export async function revertirPagoCompra(negocioId: bigint, compraId: bigint, usuarioId: bigint) {
  const compra = await prisma.compras.findFirst({ where: { id: compraId, negocio_id: negocioId, estado: 'pagada' } });
  if (!compra) throw new HttpError(404, 'Compra pagada no encontrada');
  await prisma.$transaction(async (tx) => {
    await tx.compras.update({ where: { id: compra.id }, data: { estado: 'pendiente', pagado_at: null } });
    await tx.auditoria_operativa.create({ data: { negocio_id: negocioId, usuario_id: usuarioId, accion: 'revertir_pago', entidad: 'compra', entidad_id: compra.id, datos: { monto: num0(compra.total) } } });
  });
  await actualizarUltimoBalance(negocioId);
  return { ok: true, monto: num0(compra.total) };
}

export async function detalleFactura(negocioId: bigint, facturaId: bigint) {
  const f = await prisma.facturas.findFirst({
    where: { id: facturaId, negocio_id: negocioId },
    include: { empresa: true, ubicacion: true, lineas: { orderBy: { descripcion: 'asc' } }, pagos: true },
  });
  if (!f) throw new HttpError(404, 'Factura no encontrada');
  return { id: Number(f.id), numero: f.numero, version: f.version, empresa: f.empresa.nombre, ubicacion: f.ubicacion.nombre, linea: f.linea_operacion, emitida_at: iso(f.emitida_at), vence_at: iso(f.vence_at), estado: f.estado, total: num0(f.total), pagado: r2(f.pagos.reduce((a, p) => a + num0(p.monto), 0)), lineas: f.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: num0(l.cantidad), precio: num0(l.precio_unitario), importe: num0(l.importe) })) };
}
