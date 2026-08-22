import { PrismaClient } from '@prisma/client';
import { aplicarMovimiento } from '../src/ledger/service.js';
import { prepararSalidaFifo, registrarSalidaFifo } from '../src/inventario/fifo.js';
import { num, num0 } from '../src/lib/num.js';

/**
 * Sincroniza una captura final existente contra el ledger vivo.
 *
 * Es deliberadamente acotado: solo trabaja sobre el conteo final indicado y
 * usa una llave propia por producto, por lo que se puede reintentar sin duplicar
 * movimientos ni capas FIFO.
 */
const prisma = new PrismaClient();
const negocioId = BigInt(process.env.BPM_SYNC_NEGOCIO_ID ?? '1');
const ubicacionId = BigInt(process.env.BPM_SYNC_UBICACION_ID ?? '29');
const conteoId = BigInt(process.env.BPM_SYNC_CONTEO_ID ?? '36');
const usuarioId = BigInt(process.env.BPM_SYNC_USUARIO_ID ?? '1');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

async function main() {
  if (process.env.BPM_SYNC_APPLY !== '1') {
    throw new Error('Sincronización protegida: define BPM_SYNC_APPLY=1 de forma explícita.');
  }
  const resumen = await prisma.$transaction(async (tx) => {
    const conteo = await tx.conteos.findFirst({
      where: { id: conteoId, negocio_id: negocioId, ubicacion_id: ubicacionId, estado: 'cerrado', notas: { startsWith: 'inventario_final_operativo' } },
      include: { lineas: { include: { products: true } } },
    });
    if (!conteo) throw new Error(`No existe el conteo final ${conteoId} para la ubicación ${ubicacionId}.`);
    if (!conteo.lineas.length) throw new Error('El conteo final no tiene líneas; se cancela para no interpretar ausencia como cero.');

    const cambios: { product_id: number; nombre: string; fisico: number; anterior: number; delta: number; fifo: boolean }[] = [];
    for (const linea of conteo.lineas) {
      const productId = linea.product_id;
      const producto = linea.products;
      const existencia = await tx.existencias.findUnique({
        where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } },
        select: { cantidad_disponible: true, costo_promedio: true },
      });
      const anterior = num0(existencia?.cantidad_disponible);
      const fisico = num0(linea.qty);
      const delta = r3(fisico - anterior);
      if (Math.abs(delta) <= 0.0001) continue;

      const idempotencyKey = `inventario-final:${conteoId}:sync:${productId}`;
      const yaAplicado = await tx.movimientos_inventario.findUnique({ where: { idempotency_key: idempotencyKey }, select: { id: true } });
      if (yaAplicado) continue;

      const manejaFifo = producto.tipo_operativo === 'materia_prima' || producto.linea_operacion === 'desechables';
      let costo = num(existencia?.costo_promedio) ?? num(producto.ultimo_costo) ?? num(producto.costo_promedio);
      let salidaFifo: Awaited<ReturnType<typeof prepararSalidaFifo>> | null = null;
      if (manejaFifo && delta < 0) {
        salidaFifo = await prepararSalidaFifo(tx, {
          negocioId, ubicacionId, productId, cantidad: Math.abs(delta), producto: producto.nombre,
          permitirFaltante: false, costoFaltante: costo,
        });
        costo = salidaFifo.costo_unitario ?? costo;
      }
      if (manejaFifo && delta > 0) {
        if (costo == null) throw new Error(`${producto.nombre}: falta costo para crear el lote del conteo.`);
        const pesoCaja = producto.tipo_operativo === 'materia_prima' ? num0(producto.peso_caja_lb) : 0;
        const lote = await tx.lotes_materia_prima.create({
          data: {
            negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: productId,
            fecha: conteo.fecha ?? new Date(), congelado: false,
            cajas_iniciales: delta, cajas_disponibles: delta,
            peso_inicial_lb: r3(delta * pesoCaja), peso_disponible_lb: r3(delta * pesoCaja),
            costo_inicial: r2(delta * costo), costo_disponible: r2(delta * costo),
          },
        });
        // Firmado: negativo significa que esta capa se retira al revertir el conteo.
        await tx.conteo_ajustes_lote.create({
          data: { conteo_id: conteo.id, lote_id: lote.id, cajas: r3(-delta), peso_lb: r3(-delta * pesoCaja), costo: r2(-delta * costo) },
        });
      }

      await aplicarMovimiento(tx, {
        negocioId, productId, tipo: delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo', cantidad: Math.abs(delta), usuarioId,
        origenId: delta < 0 ? ubicacionId : null, destinoId: delta > 0 ? ubicacionId : null,
        costoUnitario: costo, documentoTipo: 'conteo', documentoId: conteo.id,
        comentario: 'Sincronización idempotente con el último conteo físico', idempotencyKey,
        deltas: [{ ubicacionId, productId, disponible: delta, costoUnitario: costo }],
      });
      if (salidaFifo) await registrarSalidaFifo(tx, { movimientoId: (await tx.movimientos_inventario.findUniqueOrThrow({ where: { idempotency_key: idempotencyKey }, select: { id: true } })).id, ubicacionId, productId, consumos: salidaFifo.consumos });
      cambios.push({ product_id: Number(productId), nombre: producto.nombre, fisico, anterior, delta, fifo: manejaFifo });
    }
    return { conteo_id: Number(conteo.id), cambios };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });

  const verificacion = await prisma.$queryRaw<Array<{ nombre: string; fisico: number; actual: number }>>`
    SELECT p.nombre, cl.qty::float8 AS fisico, COALESCE(e.cantidad_disponible, 0)::float8 AS actual
    FROM conteo_lineas cl
    JOIN products p ON p.id = cl.product_id
    LEFT JOIN existencias e ON e.product_id = cl.product_id AND e.ubicacion_id = ${ubicacionId}
    WHERE cl.conteo_id = ${conteoId}
    ORDER BY p.orden_operativo, p.nombre
  `;
  const diferencias = verificacion.filter((fila) => Math.abs(fila.fisico - fila.actual) > 0.001);
  if (diferencias.length) throw new Error(`La sincronización no cerró ${diferencias.length} producto(s): ${JSON.stringify(diferencias)}`);
  console.log(JSON.stringify({ ...resumen, diferencias: 0 }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
