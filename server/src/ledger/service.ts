import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { transaccionSerializable } from '../lib/transaccion.js';
import { prepararSalidaFifo, registrarSalidaFifo } from '../inventario/fifo.js';

type Tx = Prisma.TransactionClient;

export interface DeltaExistencia {
  ubicacionId: bigint;
  productId: bigint;
  disponible?: number; // delta (+/−)
  reservada?: number;
  transito?: number;
  costoUnitario?: number | null; // si entra disponible, recalcula costo promedio ponderado
  costoTransitoUnitario?: number | null; // costo propio de una entrada a hold/tránsito
}

export interface MovimientoParams {
  negocioId: bigint;
  productId: bigint;
  tipo: Prisma.movimientos_inventarioCreateInput['tipo'];
  cantidad: number;
  usuarioId: bigint;
  origenId?: bigint | null;
  destinoId?: bigint | null;
  costoUnitario?: number | null;
  documentoTipo?: string;
  documentoId?: bigint;
  distribucionLineaId?: bigint | null;
  comentario?: string;
  idempotencyKey: string;
  deltas: DeltaExistencia[];
  // Durante una semana abierta puede faltar capturar producción/compras que respaldan una
  // salida real. Solo disponible puede quedar provisionalmente negativo; el cierre lo concilia.
  permitirDisponibleNegativo?: boolean;
}

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Aplica un delta a la fila de existencias (la crea si no existe), con costo promedio
 *  ponderado cuando entra inventario disponible con costo. */
async function ajustarExistencia(tx: Tx, negocioId: bigint, d: DeltaExistencia, permitirDisponibleNegativo = false) {
  const actual = await tx.existencias.findUnique({
    where: { ubicacion_id_product_id: { ubicacion_id: d.ubicacionId, product_id: d.productId } },
  });
  const dispAnt = num0(actual?.cantidad_disponible);
  const transitoAnt = num0(actual?.cantidad_transito);
  const dDisp = d.disponible ?? 0;
  const dTransito = d.transito ?? 0;
  const dispNue = r3(dispAnt + dDisp);
  const reservadaNueva = r3(num0(actual?.cantidad_reservada) + (d.reservada ?? 0));
  const transitoNuevo = r3(transitoAnt + dTransito);
  if (![dispNue, reservadaNueva, transitoNuevo].every(Number.isFinite)) {
    throw new HttpError(400, 'El movimiento contiene una cantidad de inventario no válida');
  }
  // Un saldo disponible negativo previo no debe congelar los otros componentes de la
  // existencia. Por ejemplo, al cerrar una semana se debe poder sacar del tránsito una
  // entrega aunque el disponible de Carnicería ya refleje cajas faltantes. Solo se bloquea
  // cuando este movimiento CREA o EMPEORA el negativo; recuperarlo o dejarlo igual es válido.
  const disponibleEmpeora = dispNue < -0.0001 && dispNue < dispAnt - 0.0001;
  if ((!permitirDisponibleNegativo && disponibleEmpeora) || reservadaNueva < -0.0001 || transitoNuevo < -0.0001) {
    throw new HttpError(409, 'Inventario insuficiente para completar el movimiento');
  }

  // Costo promedio ponderado solo cuando ENTRA disponible con costo conocido.
  let costo = num(actual?.costo_promedio);
  if (dDisp > 0 && d.costoUnitario != null) {
    const base = Math.max(0, dispAnt);
    costo = base + dDisp > 0 ? r4((base * (costo ?? d.costoUnitario) + dDisp * d.costoUnitario) / (base + dDisp)) : d.costoUnitario;
  }
  let costoTransito = num(actual?.costo_transito_promedio);
  if (dTransito > 0) {
    const costoEntrada = d.costoTransitoUnitario ?? d.costoUnitario ?? costo;
    if (costoEntrada != null) {
      costoTransito = transitoAnt + dTransito > 0
        ? r4((transitoAnt * (costoTransito ?? costoEntrada) + dTransito * costoEntrada) / (transitoAnt + dTransito))
        : costoEntrada;
    }
  } else if (transitoNuevo <= 0.0001) {
    costoTransito = null;
  }

  await tx.existencias.upsert({
    where: { ubicacion_id_product_id: { ubicacion_id: d.ubicacionId, product_id: d.productId } },
    create: {
      negocio_id: negocioId,
      ubicacion_id: d.ubicacionId,
      product_id: d.productId,
      cantidad_disponible: dispNue,
      cantidad_reservada: reservadaNueva,
      cantidad_transito: transitoNuevo,
      costo_promedio: costo ?? null,
      costo_transito_promedio: costoTransito,
    },
    update: {
      cantidad_disponible: dispNue,
      cantidad_reservada: reservadaNueva,
      cantidad_transito: transitoNuevo,
      costo_promedio: costo ?? actual?.costo_promedio ?? null,
      costo_transito_promedio: costoTransito,
    },
  });
}

/**
 * Registra un movimiento y aplica sus deltas a existencias, de forma atómica e idempotente.
 * Si ya existe un movimiento con la misma idempotency_key, no hace nada (devuelve false).
 */
export async function aplicarMovimiento(tx: Tx, p: MovimientoParams): Promise<boolean> {
  const existe = await tx.movimientos_inventario.findUnique({ where: { idempotency_key: p.idempotencyKey } });
  if (existe) return false;

  await tx.movimientos_inventario.create({
    data: {
      negocio_id: p.negocioId,
      product_id: p.productId,
      ubicacion_origen_id: p.origenId ?? null,
      ubicacion_destino_id: p.destinoId ?? null,
      tipo: p.tipo,
      cantidad: r3(p.cantidad),
      costo_unitario: p.costoUnitario ?? null,
      costo_total: p.costoUnitario != null ? Math.round(p.cantidad * p.costoUnitario * 100) / 100 : null,
      documento_tipo: p.documentoTipo,
      documento_id: p.documentoId,
      distribucion_linea_id: p.distribucionLineaId ?? null,
      usuario_id: p.usuarioId,
      comentario: p.comentario,
      idempotency_key: p.idempotencyKey,
    },
  });
  for (const d of p.deltas) await ajustarExistencia(tx, p.negocioId, d, p.permitirDisponibleNegativo ?? false);
  return true;
}

/** Crea el documento auditable que respalda una existencia física no registrada.
 * Es una entrada técnica: conserva costo/lote, pero se marca fuera de flujo de caja. */
export async function crearCompraAjusteConteo(
  tx: Tx,
  input: { negocioId: bigint; conteoId: bigint; usuarioId: bigint; ubicacionId: bigint; productId: bigint; fecha: Date; cantidad: number; costoUnitario: number; sello: number },
) {
  const costoTotal = r3(input.cantidad * input.costoUnitario);
  const compraKey = `conteo-compra:${input.conteoId}:${input.sello}:${input.productId}`;
  const proveedor = await tx.proveedores.upsert({
    where: { negocio_id_nombre: { negocio_id: input.negocioId, nombre: 'Ajuste de inventario físico' } },
    update: { activo: true },
    create: { negocio_id: input.negocioId, nombre: 'Ajuste de inventario físico', activo: true },
  });
  const compra = await tx.compras.create({
    data: {
      negocio_id: input.negocioId, proveedor_id: proveedor.id, ubicacion_id: input.ubicacionId,
      fecha: input.fecha, referencia: `Ajuste automático por conteo físico #${input.conteoId.toString()}`,
      total: costoTotal, ajuste_contable: 0, estado: 'pagada', origen: 'conteo_fisico', registrado_por: input.usuarioId,
      pagado_at: new Date(), idempotency_key: compraKey,
    },
  });
  const compraLinea = await tx.compra_lineas.create({
    data: { compra_id: compra.id, product_id: input.productId, cajas: input.cantidad, peso_total_lb: 0, costo_total: costoTotal, congelado: false },
  });
  await tx.auditoria_operativa.create({
    data: {
      negocio_id: input.negocioId, usuario_id: input.usuarioId, accion: 'ajuste_automatico_conteo', entidad: 'compra', entidad_id: compra.id,
      datos: { conteo_id: Number(input.conteoId), product_id: Number(input.productId), cantidad: input.cantidad, costo_unitario: r4(input.costoUnitario), costo_total: costoTotal },
    },
  });
  return { compraId: compra.id, compraLineaId: compraLinea.id, costoTotal };
}

/**
 * Reconcilia las existencias de una ubicación con un conteo cerrado: deja
 * cantidad_disponible = lo contado (la fotografía física es la verdad). Registra un
 * movimiento de ajuste por el delta de cada producto.
 */
export async function reconciliarConteo(negocioId: bigint, conteoId: bigint, usuarioId: bigint, ubicacionId: bigint) {
  const [conteo, lineas, ubicacion] = await Promise.all([
    prisma.conteos.findFirst({ where: { id: conteoId, negocio_id: negocioId, ubicacion_id: ubicacionId }, select: { fecha: true } }),
    prisma.conteo_lineas.findMany({
    where: { conteo_id: conteoId },
    include: { products: { select: { ultimo_costo: true, costo_promedio: true, linea_operacion: true } } },
    }),
    prisma.ubicaciones.findUnique({ where: { id: ubicacionId }, select: { codigo: true } }),
  ]);
  if (!conteo || !conteo.fecha) throw new HttpError(404, 'Conteo de inventario no encontrado');
  const fechaConteo = conteo.fecha;
  if (!ubicacion) throw new HttpError(404, 'Ubicación de conteo no encontrada');
  const sello = Date.now(); // cada cierre reconcilia (permite re-cierre tras reabrir)

  await transaccionSerializable(async (tx) => {
    for (const l of lineas) {
      const contado = num0(l.qty);
      const ex = await tx.existencias.findUnique({
        where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: l.product_id } },
      });
      const delta = r3(contado - num0(ex?.cantidad_disponible));
      if (delta === 0) continue;
      const manejaFifo = ubicacion.codigo === 'BOD' && l.products.linea_operacion === 'desechables';
      // Para una entrada detectada por conteo, el costo operativo es el del lote más
      // reciente de ese producto. Así una presentación física agregada no hereda un
      // costo obsoleto del catálogo y la nueva capa queda valuada exactamente igual
      // que una compra normal. Si todavía no existe un lote, usamos el último costo
      // del producto como respaldo explícito.
      const costoUltimoProducto = num(l.products.ultimo_costo);
      const costoPromedioProducto = num(l.products.costo_promedio);
      let costo = costoUltimoProducto != null && costoUltimoProducto > 0
        ? costoUltimoProducto
        : costoPromedioProducto ?? 0;
      if (delta > 0 && manejaFifo) {
        const ultimoLote = await tx.lotes_materia_prima.findFirst({
          where: { negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: l.product_id, fecha: { lte: fechaConteo }, cajas_iniciales: { gt: 0 } },
          orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
          select: { cajas_iniciales: true, costo_inicial: true },
        });
        const cajasLote = num0(ultimoLote?.cajas_iniciales);
        const costoLote = cajasLote > 0 ? num(ultimoLote?.costo_inicial) : null;
        if (costoLote != null && costoLote > 0) costo = costoLote / cajasLote;
      }
      if (delta > 0 && manejaFifo && !(costo > 0)) {
        throw new HttpError(409, `No hay un costo conocido para ${l.products.linea_operacion} (producto ${l.product_id.toString()}); registra una compra o configura su costo antes de reconciliar.`);
      }
      const salidaFifo = delta < 0 && manejaFifo
        ? await prepararSalidaFifo(tx, {
            negocioId, ubicacionId, productId: l.product_id, cantidad: Math.abs(delta), producto: `Producto ${l.product_id.toString()}`,
            permitirFaltante: false, costoFaltante: costo,
          })
        : null;
      const idempotencyKey = `conteo:${conteoId}:${sello}:${l.product_id}`;
      const aplicada = await aplicarMovimiento(tx, {
        negocioId,
        productId: l.product_id,
        tipo: delta >= 0 ? (ex ? 'ajuste_positivo' : 'conteo_inicial') : 'ajuste_negativo',
        cantidad: Math.abs(delta),
        usuarioId,
        destinoId: delta >= 0 ? ubicacionId : null,
        origenId: delta < 0 ? ubicacionId : null,
        costoUnitario: costo,
        documentoTipo: 'conteo',
        documentoId: conteoId,
        comentario: 'Reconciliación por conteo cerrado',
        idempotencyKey,
        deltas: [{ ubicacionId, productId: l.product_id, disponible: delta, costoUnitario: costo }],
      });
      if (aplicada && salidaFifo) {
        const movimiento = await tx.movimientos_inventario.findUnique({ where: { idempotency_key: idempotencyKey }, select: { id: true } });
        if (!movimiento) throw new HttpError(500, 'No se pudo vincular el ajuste de conteo con FIFO');
        await registrarSalidaFifo(tx, { movimientoId: movimiento.id, ubicacionId, productId: l.product_id, consumos: salidaFifo.consumos });
        for (const consumo of salidaFifo.consumos) {
          await tx.conteo_ajustes_lote.create({
            data: { conteo_id: conteoId, lote_id: consumo.lote.id, cajas: consumo.cajas, peso_lb: consumo.peso, costo: consumo.costo },
          });
        }
      } else if (aplicada && delta > 0 && manejaFifo) {
        const compra = await crearCompraAjusteConteo(tx, { negocioId, conteoId, usuarioId, ubicacionId, productId: l.product_id, fecha: fechaConteo, cantidad: delta, costoUnitario: costo, sello });
        const lote = await tx.lotes_materia_prima.create({
          data: {
            negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: l.product_id,
            compra_linea_id: compra.compraLineaId, fecha: fechaConteo, congelado: false, cajas_iniciales: delta, cajas_disponibles: delta,
            peso_inicial_lb: 0, peso_disponible_lb: 0, costo_inicial: r3(delta * costo), costo_disponible: r3(delta * costo),
          },
        });
        // Negativo significa que eliminar/reemplazar el conteo debe retirar esta capa.
        await tx.conteo_ajustes_lote.create({
          data: { conteo_id: conteoId, lote_id: lote.id, cajas: -delta, peso_lb: 0, costo: r3(-delta * costo) },
        });
        await tx.products.update({ where: { id: l.product_id }, data: { ultimo_costo: r4(costo) } });
      }
    }
  });
}
