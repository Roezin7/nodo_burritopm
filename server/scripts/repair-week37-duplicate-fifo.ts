/** Retira exclusivamente el exceso FIFO creado por el antiguo respaldo del conteo45.
 * No cambia cantidades físicas, compras, pagos ni facturas. Simulación por defecto.
 * Los lotes se conservan y la regularización queda vinculada como consumo técnico.
 */
import { strict as assert } from 'node:assert';
import { prisma } from '../src/db.js';
import { obtenerConciliacionAlmacen } from '../src/inventario/conciliacion-semanal.js';
import { registrarSalidaFifo } from '../src/inventario/fifo.js';

const apply = process.argv.includes('--apply');
const key = 'auditoria-inventario-20260915:duplicados-conteo45';
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x));
const round = (v: number, digits = 3) => Number(v.toFixed(digits));
try {
  const resultado = await prisma.$transaction(async tx => {
    if (!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const hecho = await tx.auditoria_operativa.findFirst({ where: { negocio_id: 1n, accion: key } });
    if (hecho) return { ya_aplicado: true, auditoria_id: String(hecho.id) };
    const reporte = await obtenerConciliacionAlmacen(1n, '2026-09-06', '2026-09-12', 1n, tx);
    assert.equal(reporte.resumen.diferencias_ledger, 0, 'La existencia debe cuadrar con documentos antes de regularizar FIFO');
    assert.equal(reporte.resumen.diferencias_fifo, 37, 'Cambió el alcance auditado');
    const lotes = await tx.lotes_materia_prima.findMany({ where: { negocio_id: 1n, ubicacion_id: 1n, id: { gte: 455n, lte: 491n } },
      include: { compra_linea: { include: { compra: { include: { pagos: true } } } }, ajustes: true, consumos: true, salidas_inventario: true }, orderBy: { id: 'asc' } });
    assert.equal(lotes.length, 37);
    const adicional = await tx.lotes_materia_prima.findUniqueOrThrow({ where: { id: 494n } });
    assert.equal(adicional.product_id, 46n); assert.equal(adicional.ubicacion_id, 1n);
    assert.equal(Number(adicional.cajas_disponibles), 32); assert.equal(Number(adicional.costo_disponible), 32);
    const planes = [];
    for (const lote of lotes) {
      const compra = lote.compra_linea?.compra;
      assert.equal(compra?.origen, 'conteo_fisico');
      assert.equal(compra?.referencia, 'Ajuste automático por conteo físico #45');
      assert.equal(compra?.pagos.length, 0); assert.equal(lote.ajustes.length + lote.consumos.length, 0);
      const fila = reporte.filas.find(f => f.product_id === Number(lote.product_id))!;
      const exceso = Number(lote.cajas_iniciales);
      assert.equal(fila.diferencia_fifo, exceso, `Exceso inesperado en ${fila.nombre}`);
      const consumibles = [lote];
      if (lote.id === 480n) {
        assert.equal(exceso, 6); assert.equal(Number(lote.cajas_disponibles), 1);
        assert.equal(lote.salidas_inventario.reduce((n, c) => n + Number(c.cajas), 0), 5);
        assert.equal(Number(lote.costo_disponible), 1);
        // Las cinco cajas ya usadas se neutralizan en la siguiente capa, mismo
        // producto y costo $1/caja. No se modifica su consumo ni billing pasado.
        consumibles.push(adicional as typeof lote);
      } else { assert.equal(lote.salidas_inventario.length, 0); assert.equal(Number(lote.cajas_disponibles), exceso); }
      let faltan = exceso;
      const consumos = consumibles.map(l => {
        const cajas = Math.min(faltan, Number(l.cajas_disponibles)); faltan = round(faltan - cajas);
        const proporcion = cajas / Number(l.cajas_disponibles);
        return { lote: l, indice: 0, cajas, peso: round(Number(l.peso_disponible_lb) * proporcion), costo: round(Number(l.costo_disponible) * proporcion, 2) };
      });
      assert.equal(faltan, 0);
      planes.push({ producto: Number(lote.product_id), nombre: fila.nombre, exceso, existencia: fila.actual, consumos });
    }
    if (!apply) return { simulacion: true, productos: planes.length, planes: planes.map(p => ({ ...p, consumos: p.consumos.map(c => ({ lote: String(c.lote.id), cajas: c.cajas, costo: c.costo })) })) };
    const anterior = json({ lotes, adicional, filas: reporte.filas });
    for (const p of planes) {
      const costo = round(p.consumos.reduce((n, c) => n + c.costo, 0), 2);
      const movimiento = await tx.movimientos_inventario.create({ data: {
        negocio_id: 1n, usuario_id: 1n, product_id: BigInt(p.producto), tipo: 'correccion', cantidad: p.exceso,
        costo_unitario: round(costo / p.exceso, 4), costo_total: costo,
        documento_tipo: 'regularizacion_fifo', documento_id: 45n,
        comentario: 'Retiro de capas duplicadas por respaldo automático del conteo45. Sin movimiento físico ni cambio de compras/pagos/facturas.',
        idempotency_key: `${key}:${p.producto}`,
      } });
      await registrarSalidaFifo(tx, { movimientoId: movimiento.id, ubicacionId: 1n, productId: BigInt(p.producto), consumos: p.consumos });
    }
    const despues = await obtenerConciliacionAlmacen(1n, '2026-09-06', '2026-09-12', 1n, tx);
    assert.equal(despues.resumen.diferencias_fifo, 0); assert.equal(despues.resumen.diferencias_ledger, 0);
    for (const f of despues.filas) assert.equal(f.actual, reporte.filas.find(a => a.product_id === f.product_id)?.actual);
    const audit = await tx.auditoria_operativa.create({ data: { negocio_id: 1n, usuario_id: 1n, accion: key, entidad: 'regularizacion_fifo', entidad_id: 45n, datos: { anterior, posterior: json(despues.filas) } } });
    return { aplicado: true, productos: planes.length, auditoria_id: String(audit.id), resumen: despues.resumen };
  }, { isolationLevel: 'Serializable', timeout: 90000 });
  console.log(JSON.stringify(resultado));
} finally { await prisma.$disconnect(); }
