import type { Prisma, products } from '@prisma/client';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { aplicarMovimiento, crearCompraAjusteConteo } from '../ledger/service.js';
import { esAperturaHeredada, obtenerConciliacionAlmacen } from './conciliacion-semanal.js';
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const fecha = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Único escritor del saldo derivado de una evidencia física; conserva FIFO y trazabilidad. */
export async function aplicarSaldoFisicoEnTx(tx: Prisma.TransactionClient, p: {
  negocioId: bigint; usuarioId: bigint; ubicacionId: bigint; producto: products;
  conteoId: bigint; fechaCaptura: string; tipoCaptura: string; objetivo: number; sello: number | string;
}) {
  const { negocioId, usuarioId, ubicacionId, producto, conteoId, fechaCaptura, tipoCaptura, objetivo, sello } = p;
  const productId = producto.id;
  let aplicada = false;
  const existenciaBase = await tx.existencias.findUnique({
    where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } },
    select: { cantidad_disponible: true, costo_promedio: true },
  });
  const deltaConteo = r3(objetivo - num0(existenciaBase?.cantidad_disponible));
  let costoLotes: number | null = null;

  const manejaLote = producto.tipo_operativo === 'materia_prima' || producto.linea_operacion === 'desechables';
  if (manejaLote) {
    const lotes = await tx.lotes_materia_prima.findMany({
      where: { negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: productId, cajas_disponibles: { gt: 0 } },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    });
    const cajasLotes = r3(lotes.reduce((a, lote) => a + num0(lote.cajas_disponibles), 0));
    // Un disponible provisional negativo no representa cajas FIFO negativas.
    // Contar 3 desde -2 aplica +5 al ledger, pero crea solamente 3 cajas en lotes.
    const deltaFifo = r3(Math.max(0, objetivo) - cajasLotes);
    if (Math.abs(deltaFifo) > 0.0001) aplicada = true;
    const costoDisponible = lotes.reduce((a, lote) => a + num0(lote.costo_disponible), 0);
    costoLotes = cajasLotes > 0 ? r4(costoDisponible / cajasLotes) : null;
    if (deltaFifo > 0.0001) {
      // Una diferencia física positiva también es inventario real. Se crea
      // una capa FIFO fechada en el conteo para que la siguiente producción
      // o salida consuma exactamente lo que se contó.
      const costo = costoLotes ?? num(existenciaBase?.costo_promedio) ?? num(producto.ultimo_costo) ?? num(producto.costo_promedio);
      if (costo == null || costo <= 0) throw new HttpError(409, `${producto.nombre}: falta costo para crear la capa FIFO del conteo.`);
      const compraTecnica = producto.linea_operacion === 'desechables'
        ? await crearCompraAjusteConteo(tx, { negocioId, conteoId: conteoId, usuarioId, ubicacionId, productId, fecha: fecha(fechaCaptura), cantidad: deltaFifo, costoUnitario: costo, sello })
        : null;
      const pesoCaja = producto.tipo_operativo === 'materia_prima' ? num0(producto.peso_caja_lb) : 0;
      const lote = await tx.lotes_materia_prima.create({
        data: {
          negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: productId,
          compra_linea_id: compraTecnica?.compraLineaId ?? null,
          fecha: fecha(fechaCaptura), congelado: false,
          cajas_iniciales: deltaFifo, cajas_disponibles: deltaFifo,
          peso_inicial_lb: r3(deltaFifo * pesoCaja), peso_disponible_lb: r3(deltaFifo * pesoCaja),
          costo_inicial: r2(deltaFifo * costo), costo_disponible: r2(deltaFifo * costo),
        },
      });
      await tx.conteo_ajustes_lote.create({ data: { conteo_id: conteoId, lote_id: lote.id, cajas: r3(-deltaFifo), peso_lb: r3(-deltaFifo * pesoCaja), costo: r2(-deltaFifo * costo) } });
      costoLotes = costo;
    } else if (Math.abs(deltaFifo) > cajasLotes + 0.0001) {
      throw new HttpError(409, `${producto.nombre}: no quedan suficientes unidades FIFO para aplicar retroactivamente la diferencia de ${deltaFifo}.`);
    } else {
      let faltanteFisico = r3(Math.abs(Math.min(0, deltaFifo)));
      let costoRetirado = 0;
      // Al corregir el mismo conteo, deshacer primero sus capas positivas
      // aún disponibles. No consumir una compra real para revertir un error
      // de captura mientras su capa de ajuste sigue intacta.
      const propias = await tx.conteo_ajustes_lote.findMany({
        where: { conteo_id: conteoId, cajas: { lt: 0 } }, select: { lote_id: true },
      });
      const idsPropios = new Set(propias.map(a => a.lote_id.toString()));
      lotes.sort((a, b) => Number(idsPropios.has(b.id.toString())) - Number(idsPropios.has(a.id.toString())));
      for (const lote of lotes) {
        if (faltanteFisico <= 0.0001) break;
        const disponibles = num0(lote.cajas_disponibles);
        const cajas = Math.min(faltanteFisico, disponibles);
        const proporcion = disponibles > 0 ? cajas / disponibles : 0;
        const peso = r3(num0(lote.peso_disponible_lb) * proporcion);
        const costo = r2(num0(lote.costo_disponible) * proporcion);
        costoRetirado = r2(costoRetirado + costo);
        await tx.conteo_ajustes_lote.upsert({
          where: { conteo_id_lote_id: { conteo_id: conteoId, lote_id: lote.id } },
          create: { conteo_id: conteoId, lote_id: lote.id, cajas: r3(cajas), peso_lb: peso, costo },
          update: { cajas: { increment: r3(cajas) }, peso_lb: { increment: peso }, costo: { increment: costo } },
        });
        await tx.lotes_materia_prima.update({
          where: { id: lote.id },
          data: {
            cajas_disponibles: r3(disponibles - cajas),
            peso_disponible_lb: r3(num0(lote.peso_disponible_lb) - peso),
            costo_disponible: r2(num0(lote.costo_disponible) - costo),
          },
        });
        faltanteFisico = r3(faltanteFisico - cajas);
      }
      const cajasRestantes = r3(cajasLotes - Math.abs(Math.min(0, deltaFifo)));
      costoLotes = cajasRestantes > 0 ? r4(Math.max(0, costoDisponible - costoRetirado) / cajasRestantes) : null;
    }
  }

  const actual = existenciaBase;
  // El delta se aplica contra el saldo vivo. Las capas FIFO ya fueron
  // consumidas/creadas arriba y el movimiento mantiene existencias alineadas.
  const delta = deltaConteo;
  if (Math.abs(delta) >= 0.0001) {
    const costo = costoLotes ?? num(actual?.costo_promedio) ?? num(producto.ultimo_costo) ?? num(producto.costo_promedio);
    await aplicarMovimiento(tx, {
      negocioId, productId, tipo: delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo', cantidad: Math.abs(delta), usuarioId,
      origenId: delta < 0 ? ubicacionId : null, destinoId: delta > 0 ? ubicacionId : null, costoUnitario: costo,
      documentoTipo: 'conteo', documentoId: conteoId, comentario: `Inventario físico ${tipoCaptura} · ${fechaCaptura} · saldo vigente ${objetivo}`,
      idempotencyKey: `inventario-${tipoCaptura}:${conteoId}:${sello}:${productId}`,
      permitirDisponibleNegativo: true,
      deltas: [{ ubicacionId, productId, disponible: delta, costoUnitario: costo }],
    });
    aplicada = true;
  }
  // En productos con FIFO el costo visible siempre debe coincidir con las
  // capas que quedaron, incluso si el conteo no cambió la cantidad total.
  if (manejaLote) {
    await tx.existencias.updateMany({
      where: { ubicacion_id: ubicacionId, product_id: productId },
      data: { costo_promedio: costoLotes },
    });
  }
  return aplicada;
}

/** Una operación anterior a un físico cambia su diferencia, no lo contado.
 * Se ejecuta antes de confirmar la operación, dentro de la misma transacción.
 */
export async function recalcularFisicosPosterioresEnTx(tx: Prisma.TransactionClient, negocioId: bigint, usuarioId: bigint, fechaOperacion: string, productIds: bigint[]) {
  const bodegas = await tx.ubicaciones.findMany({ where: { negocio_id: negocioId, codigo: { in: ['CARN', 'BOD'] }, activo: true, tipo: 'bodega' }, select: { id: true } });
  if (!bodegas.length || !productIds.length) return;
  const cerrada = await tx.semanas_operativas.findFirst({ where: { negocio_id: negocioId, estado: 'cerrada', termina_at: { gte: fecha(fechaOperacion) } }, select: { semana: true } });
  if (cerrada) throw new HttpError(409, `La semana ${cerrada.semana} cerrada depende de esta operación. Reábrela antes de modificar su inventario.`);
  const conteos = await tx.conteos.findMany({
    where: { negocio_id: negocioId, ubicacion_id: { in: bodegas.map(b => b.id) }, estado: 'cerrado', tipo_captura: { not: 'historico' }, fecha: { gte: fecha(fechaOperacion) } },
    include: { lineas: { where: { product_id: { in: productIds }, contado: true }, include: { products: true } } },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
  });
  const referencias = new Map<string, { conteo: typeof conteos[number]; producto: products }>();
  for (const c of conteos) {
    const apertura = c.tipo_captura === 'apertura' || c.notas?.startsWith('inventario_inicial_operativo');
    if (apertura && (esAperturaHeredada(c.notas) || iso(c.fecha!) <= fechaOperacion)) continue;
    for (const l of c.lineas) referencias.set(`${c.ubicacion_id}:${l.product_id}`, { conteo: c, producto: l.products });
  }
  if (!referencias.size) return;
  const inicio = fecha(fechaOperacion); inicio.setUTCDate(inicio.getUTCDate() - inicio.getUTCDay());
  const fin = new Date(inicio); fin.setUTCDate(fin.getUTCDate() + 6);
  const sello = `cadena:${crypto.randomUUID()}`;
  for (const b of bodegas) {
    const refs = [...referencias.values()].filter(r => r.conteo.ubicacion_id === b.id);
    if (!refs.length) continue;
    const reporte = await obtenerConciliacionAlmacen(negocioId, iso(inicio), iso(fin), b.id, tx);
    for (const ref of refs) {
      const f = reporte.filas.find(f => f.product_id === Number(ref.producto.id));
      if (!f || Math.abs(f.diferencia_ledger) <= 0.001) continue;
      await aplicarSaldoFisicoEnTx(tx, { negocioId, usuarioId, ubicacionId: b.id, producto: ref.producto, conteoId: ref.conteo.id,
        fechaCaptura: iso(ref.conteo.fecha!), tipoCaptura: 'recalculo', objetivo: f.saldo_actual_esperado, sello });
      await tx.auditoria_operativa.create({ data: { negocio_id: negocioId, usuario_id: usuarioId, accion: 'recalculo_cadena_inventario', entidad: 'conteo', entidad_id: ref.conteo.id,
        datos: { fecha_operacion: fechaOperacion, product_id: f.product_id, saldo_anterior: f.actual, saldo_nuevo: f.saldo_actual_esperado, teorico: f.teoricoFinal, fisico: f.fisico_final } } });
    }
  }
}
