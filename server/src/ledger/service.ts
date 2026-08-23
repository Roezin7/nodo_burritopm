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

/**
 * Reconcilia las existencias de una ubicación con un conteo cerrado: deja
 * cantidad_disponible = lo contado (la fotografía física es la verdad). Registra un
 * movimiento de ajuste por el delta de cada producto.
 */
export async function reconciliarConteo(negocioId: bigint, conteoId: bigint, usuarioId: bigint, ubicacionId: bigint) {
  const [lineas, ubicacion] = await Promise.all([
    prisma.conteo_lineas.findMany({
    where: { conteo_id: conteoId },
    include: { products: { select: { ultimo_costo: true, costo_promedio: true, linea_operacion: true } } },
    }),
    prisma.ubicaciones.findUnique({ where: { id: ubicacionId }, select: { codigo: true } }),
  ]);
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
      const costo = num(l.products.ultimo_costo) ?? num(l.products.costo_promedio) ?? 0;
      const manejaFifo = ubicacion.codigo === 'BOD' && l.products.linea_operacion === 'desechables';
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
        const lote = await tx.lotes_materia_prima.create({
          data: {
            negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: l.product_id,
            fecha: new Date(), congelado: false, cajas_iniciales: delta, cajas_disponibles: delta,
            peso_inicial_lb: 0, peso_disponible_lb: 0, costo_inicial: r3(delta * costo), costo_disponible: r3(delta * costo),
          },
        });
        // Negativo significa que eliminar/reemplazar el conteo debe retirar esta capa.
        await tx.conteo_ajustes_lote.create({
          data: { conteo_id: conteoId, lote_id: lote.id, cajas: -delta, peso_lb: 0, costo: r3(-delta * costo) },
        });
      }
    }
  });
}
