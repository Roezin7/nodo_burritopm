/** Corrección puntual autorizada: las capturas 10/5 pertenecen al terminado.
 * DATABASE_URL externo; solo lectura por defecto. --apply exige todas las precondiciones.
 * Conserva documentos y respaldo anterior en auditoria_operativa; nunca borra compras.
 */
import { strict as assert } from 'node:assert';
import { prisma } from '../src/db.js';
import { aplicarMovimiento } from '../src/ledger/service.js';
import { obtenerConciliacionAlmacen } from '../src/inventario/conciliacion-semanal.js';

const apply = process.argv.includes('--apply');
const key = 'auditoria-inventario-20260915:taco-terminado';
const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x));
try {
  const resultado = await prisma.$transaction(async tx => {
    if (!apply) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const hecho = await tx.auditoria_operativa.findFirst({ where: { negocio_id: 1n, accion: key } });
    if (hecho) return { ya_aplicado: true, auditoria_id: String(hecho.id) };
    assert.equal(await tx.semanas_operativas.count({ where: { negocio_id: 1n, estado: 'cerrada', termina_at: { gte: new Date('2026-09-06') } } }), 0, 'Hay un cierre posterior: no cambiar historia cerrada');
    const conteos = await tx.conteos.findMany({ where: { negocio_id: 1n, id: { in: [46n, 52n] }, ubicacion_id: 29n }, include: { lineas: { where: { product_id: { in: [70n, 75n] } } } } });
    assert.equal(conteos.length, 2);
    const qty = (c: bigint, p: bigint) => Number(conteos.find(x => x.id === c)?.lineas.find(x => x.product_id === p)?.qty);
    assert.deepEqual([qty(46n, 70n), qty(46n, 75n), qty(52n, 70n), qty(52n, 75n)], [10, 0, 5, 0]);
    assert.equal(conteos.find(c => c.id === 46n)?.fecha?.toISOString().slice(0, 10), '2026-09-06');
    assert.equal(conteos.find(c => c.id === 52n)?.fecha?.toISOString().slice(0, 10), '2026-09-12');
    const productos = await tx.products.findMany({ where: { negocio_id: 1n, id: { in: [70n, 75n] } } });
    assert.equal(productos.find(p => p.id === 70n)?.sku, 'RAW-TAPATIOS-TACO');
    assert.equal(productos.find(p => p.id === 75n)?.sku, 'MEAT-TAPATIOS-TACO');
    const existencias = await tx.existencias.findMany({ where: { negocio_id: 1n, ubicacion_id: 29n, product_id: { in: [70n, 75n] } } });
    assert.deepEqual([70n, 75n].map(p => Number(existencias.find(e => e.product_id === p)?.cantidad_disponible)), [5, 0]);
    const lote = await tx.lotes_materia_prima.findUniqueOrThrow({ where: { id: 503n }, include: { ajustes: true, consumos: true, salidas_inventario: true } });
    assert.equal(lote.product_id, 70n); assert.equal(lote.ubicacion_id, 29n);
    assert.equal(Number(lote.cajas_disponibles), 3); assert.equal(lote.compra_linea_id, null);
    assert.equal(lote.consumos.length + lote.salidas_inventario.length, 0);
    assert.equal(lote.ajustes.length, 1); assert.equal(lote.ajustes[0]!.conteo_id, 52n);
    assert.equal(Number(lote.ajustes[0]!.cajas), -3);
    const original = await tx.lotes_materia_prima.findUniqueOrThrow({ where: { id: 500n } });
    assert.equal(Number(original.cajas_disponibles), 2);
    const anterior = json({ conteos, existencias, lote, original });
    const plan = { terminado: { apertura: 10, final: 5 }, raw: { apertura: 2, final: 2 }, lote_revertido: 503, lote_compra_conservado: 500 };
    if (!apply) return { simulacion: true, plan };
    for (const [conteo_id, product_id, cantidad] of [[46n, 70n, 2], [46n, 75n, 10], [52n, 70n, 2], [52n, 75n, 5]] as const) {
      await tx.conteo_lineas.update({ where: { conteo_id_product_id: { conteo_id, product_id } }, data: { qty: cantidad, contado: true } });
    }
    await tx.lotes_materia_prima.update({ where: { id: 503n }, data: { cajas_disponibles: 0, peso_disponible_lb: 0, costo_disponible: 0 } });
    await tx.conteo_ajustes_lote.update({ where: { conteo_id_lote_id: { conteo_id: 52n, lote_id: 503n } }, data: { cajas: 0, peso_lb: 0, costo: 0 } });
    for (const [productId, delta] of [[70n, -3], [75n, 5]] as const) {
      const costo = Number(existencias.find(e => e.product_id === productId)?.costo_promedio ?? productos.find(p => p.id === productId)?.ultimo_costo ?? 0);
      await aplicarMovimiento(tx, { negocioId: 1n, usuarioId: 1n, productId, tipo: delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo', cantidad: Math.abs(delta),
        origenId: delta < 0 ? 29n : null, destinoId: delta > 0 ? 29n : null, costoUnitario: costo,
        documentoTipo: 'conteo', documentoId: 52n, comentario: 'Corrección autorizada: apertura 10 y final 5 pertenecen a Taco Meat terminado; Raw conserva 2.',
        idempotencyKey: `${key}:${productId}`, deltas: [{ ubicacionId: 29n, productId, disponible: delta, costoUnitario: costo }] });
    }
    await tx.existencias.update({ where: { ubicacion_id_product_id: { ubicacion_id: 29n, product_id: 70n } }, data: { costo_promedio: Number(original.costo_disponible) / 2 } });
    const reporte = await obtenerConciliacionAlmacen(1n, '2026-09-06', '2026-09-12', 29n, tx);
    const filas = reporte.filas.filter(f => [70, 75].includes(f.product_id));
    for (const f of filas) { assert.equal(f.diferencia_ledger, 0); assert.equal(f.diferencia_fifo ?? 0, 0); }
    assert.equal(filas.find(f => f.product_id === 75)?.diferenciaFinal, 3);
    const sinCambios = await tx.lotes_materia_prima.findUniqueOrThrow({ where: { id: 500n } });
    assert.deepEqual(json(sinCambios), json(original));
    const audit = await tx.auditoria_operativa.create({ data: { negocio_id: 1n, usuario_id: 1n, accion: key, entidad: 'conteo', entidad_id: 52n, datos: { anterior, plan, posterior: json(filas) } } });
    return { aplicado: true, auditoria_id: String(audit.id), filas };
  }, { isolationLevel: 'Serializable', timeout: 90000 });
  console.log(JSON.stringify(resultado));
} finally { await prisma.$disconnect(); }
