import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { transaccionSerializable } from '../lib/transaccion.js';

type Tx = Prisma.TransactionClient;

export interface DeltaExistencia {
  ubicacionId: bigint;
  productId: bigint;
  disponible?: number; // delta (+/−)
  reservada?: number;
  transito?: number;
  costoUnitario?: number | null; // si entra disponible, recalcula costo promedio ponderado
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
  const dDisp = d.disponible ?? 0;
  const dispNue = r3(dispAnt + dDisp);
  const reservadaNueva = r3(num0(actual?.cantidad_reservada) + (d.reservada ?? 0));
  const transitoNuevo = r3(num0(actual?.cantidad_transito) + (d.transito ?? 0));
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
    },
    update: {
      cantidad_disponible: dispNue,
      cantidad_reservada: reservadaNueva,
      cantidad_transito: transitoNuevo,
      costo_promedio: costo ?? actual?.costo_promedio ?? null,
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
  const lineas = await prisma.conteo_lineas.findMany({
    where: { conteo_id: conteoId },
    include: { products: { select: { ultimo_costo: true, costo_promedio: true } } },
  });
  const sello = Date.now(); // cada cierre reconcilia (permite re-cierre tras reabrir)

  await transaccionSerializable(async (tx) => {
    for (const l of lineas) {
      const contado = num0(l.qty);
      const ex = await tx.existencias.findUnique({
        where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: l.product_id } },
      });
      const delta = r3(contado - num0(ex?.cantidad_disponible));
      if (delta === 0) continue;
      const costo = num(l.products.ultimo_costo) ?? num(l.products.costo_promedio);
      await aplicarMovimiento(tx, {
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
        idempotencyKey: `conteo:${conteoId}:${sello}:${l.product_id}`,
        deltas: [{ ubicacionId, productId: l.product_id, disponible: delta, costoUnitario: costo }],
      });
    }
  });
}
