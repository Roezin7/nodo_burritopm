import type { Prisma } from '@prisma/client';
import { num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

export interface LoteFifoCalculable {
  cajas: number;
  peso_lb: number;
  costo: number;
}

export function calcularConsumoFifo(lotes: LoteFifoCalculable[], cajasSolicitadas: number) {
  let faltan = r3(cajasSolicitadas);
  const consumos: { indice: number; cajas: number; peso: number; costo: number }[] = [];
  for (const [indice, lote] of lotes.entries()) {
    if (faltan <= 0.0001) break;
    const disponibles = Math.max(0, lote.cajas);
    const cajas = Math.min(faltan, disponibles);
    if (cajas <= 0) continue;
    const proporcion = cajas / disponibles;
    consumos.push({ indice, cajas: r3(cajas), peso: r3(lote.peso_lb * proporcion), costo: r2(lote.costo * proporcion) });
    faltan = r3(faltan - cajas);
  }
  return {
    consumos,
    cajas_faltantes: Math.max(0, faltan),
    peso_total: r3(consumos.reduce((a, c) => a + c.peso, 0)),
    costo_total: r2(consumos.reduce((a, c) => a + c.costo, 0)),
  };
}

export async function prepararSalidaFifo(
  tx: Prisma.TransactionClient,
  input: { negocioId: bigint; ubicacionId: bigint; productId: bigint; cantidad: number; producto: string },
) {
  const lotes = await tx.lotes_materia_prima.findMany({
    where: {
      negocio_id: input.negocioId,
      ubicacion_id: input.ubicacionId,
      product_id: input.productId,
      cajas_disponibles: { gt: 0 },
    },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
  });
  const calculo = calcularConsumoFifo(
    lotes.map((lote) => ({ cajas: num0(lote.cajas_disponibles), peso_lb: num0(lote.peso_disponible_lb), costo: num0(lote.costo_disponible) })),
    input.cantidad,
  );
  if (calculo.cajas_faltantes > 0.0001) {
    throw new HttpError(409, `${input.producto}: faltan ${calculo.cajas_faltantes} unidades respaldadas por compras FIFO. Registra la compra antes de despachar.`);
  }
  return {
    consumos: calculo.consumos.map((consumo) => ({ ...consumo, lote: lotes[consumo.indice]! })),
    costo_total: calculo.costo_total,
    costo_unitario: input.cantidad > 0 ? r4(calculo.costo_total / input.cantidad) : null,
  };
}

export async function registrarSalidaFifo(
  tx: Prisma.TransactionClient,
  input: {
    movimientoId: bigint;
    ubicacionId: bigint;
    productId: bigint;
    consumos: Awaited<ReturnType<typeof prepararSalidaFifo>>['consumos'];
  },
) {
  for (const consumo of input.consumos) {
    await tx.consumos_lote_inventario.create({
      data: {
        movimiento_id: input.movimientoId,
        lote_id: consumo.lote.id,
        cajas: consumo.cajas,
        peso_lb: consumo.peso,
        costo: consumo.costo,
      },
    });
    await tx.lotes_materia_prima.update({
      where: { id: consumo.lote.id },
      data: {
        cajas_disponibles: r3(num0(consumo.lote.cajas_disponibles) - consumo.cajas),
        peso_disponible_lb: r3(num0(consumo.lote.peso_disponible_lb) - consumo.peso),
        costo_disponible: r2(num0(consumo.lote.costo_disponible) - consumo.costo),
      },
    });
  }
  const restantes = await tx.lotes_materia_prima.findMany({
    where: { ubicacion_id: input.ubicacionId, product_id: input.productId, cajas_disponibles: { gt: 0 } },
    select: { cajas_disponibles: true, costo_disponible: true },
  });
  const cajas = restantes.reduce((total, lote) => total + num0(lote.cajas_disponibles), 0);
  const costo = restantes.reduce((total, lote) => total + num0(lote.costo_disponible), 0);
  await tx.existencias.updateMany({
    where: { ubicacion_id: input.ubicacionId, product_id: input.productId },
    data: { costo_promedio: cajas > 0 ? r4(costo / cajas) : null },
  });
}

export async function restaurarSalidaFifo(
  tx: Prisma.TransactionClient,
  input: { movimientoId: bigint; ubicacionId: bigint; productId: bigint },
) {
  const consumos = await tx.consumos_lote_inventario.findMany({ where: { movimiento_id: input.movimientoId } });
  for (const consumo of consumos) {
    await tx.lotes_materia_prima.update({
      where: { id: consumo.lote_id },
      data: {
        cajas_disponibles: { increment: consumo.cajas },
        peso_disponible_lb: { increment: consumo.peso_lb },
        costo_disponible: { increment: consumo.costo },
      },
    });
  }
  await tx.consumos_lote_inventario.deleteMany({ where: { movimiento_id: input.movimientoId } });
  const restantes = await tx.lotes_materia_prima.findMany({
    where: { ubicacion_id: input.ubicacionId, product_id: input.productId, cajas_disponibles: { gt: 0 } },
    select: { cajas_disponibles: true, costo_disponible: true },
  });
  const cajas = restantes.reduce((total, lote) => total + num0(lote.cajas_disponibles), 0);
  const costo = restantes.reduce((total, lote) => total + num0(lote.costo_disponible), 0);
  await tx.existencias.updateMany({
    where: { ubicacion_id: input.ubicacionId, product_id: input.productId },
    data: { costo_promedio: cajas > 0 ? r4(costo / cajas) : null },
  });
  return consumos;
}
