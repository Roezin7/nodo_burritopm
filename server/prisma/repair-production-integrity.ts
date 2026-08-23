import { PrismaClient } from '@prisma/client';
import { aplicarMovimiento } from '../src/ledger/service.js';
import { restaurarCantidadSalidaFifo } from '../src/inventario/fifo.js';

/**
 * Reparación idempotente de datos comprobables por la auditoría.
 *
 * No borra pedidos ni movimientos: corrige saldos FIFO faltantes, revierte el
 * excedente físico duplicado con un movimiento compensatorio y deja bitácora.
 *
 * Uso:
 *   DATABASE_URL=... BPM_REPAIR_APPLY=1 npm run repair:production -w server
 */
const prisma = new PrismaClient();
const APPLY = process.env.BPM_REPAIR_APPLY === '1';
const BUSINESS_NAME = process.env.BPM_REPAIR_NEGOCIO ?? 'Burrito Parrilla Mexicana';
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const n = (v: unknown) => Number(v ?? 0) || 0;

async function main() {
  if (!APPLY) throw new Error('Reparación protegida: define BPM_REPAIR_APPLY=1 de forma explícita.');
  const result = await prisma.$transaction(async (tx) => {
    const negocio = await tx.negocios.findFirstOrThrow({ where: { nombre: BUSINESS_NAME } });
    const anterior = await tx.auditoria_operativa.findFirst({ where: { negocio_id: negocio.id, accion: 'reparar_integridad_produccion_20260824', entidad: 'operacion' }, select: { id: true } });
    if (anterior) return { omitido: true, negocio_id: Number(negocio.id), acciones: {} };
    const admin = await tx.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' }, select: { id: true } });
    const bodega = await tx.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'BOD' }, select: { id: true } });
    const semana34 = await tx.semanas_operativas.findFirst({ where: { negocio_id: negocio.id, anio: 2026, semana: 34 }, select: { id: true, inicia_at: true } });
    const acciones: Record<string, unknown[]> = { fifo: [], movimientos_compensatorios: [], estados_pedido: [], facturas: [], catalogo: [], faltantes_documentados: [] };

    // Reconstruye una capa FIFO para el saldo físico vivo que carece de lote.
    // La capa representa el saldo ya existente, no una compra inventada.
    const existencias = await tx.existencias.findMany({
      where: { negocio_id: negocio.id, ubicacion_id: bodega.id, products: { linea_operacion: 'desechables' }, cantidad_disponible: { gt: 0 } },
      include: { products: { select: { sku: true, ultimo_costo: true, costo_promedio: true } } },
    });
    const lotesBodega = await tx.lotes_materia_prima.findMany({ where: { negocio_id: negocio.id, ubicacion_id: bodega.id, cajas_disponibles: { gt: 0 } }, select: { product_id: true, cajas_disponibles: true } });
    const fifoPorProducto = new Map<string, number>();
    for (const lote of lotesBodega) fifoPorProducto.set(lote.product_id.toString(), r3((fifoPorProducto.get(lote.product_id.toString()) ?? 0) + n(lote.cajas_disponibles)));
    for (const existencia of existencias) {
      const fifo = r3(fifoPorProducto.get(existencia.product_id.toString()) ?? 0);
      const saldo = r3(n(existencia.cantidad_disponible));
      const faltante = r3(saldo - fifo);
      if (faltante <= 0.001) continue;
      const costo = n(existencia.costo_promedio) || n(existencia.products.costo_promedio) || n(existencia.products.ultimo_costo);
      const lote = await tx.lotes_materia_prima.create({
        data: {
          negocio_id: negocio.id, ubicacion_id: bodega.id, product_id: existencia.product_id,
          fecha: semana34?.inicia_at ?? new Date(), congelado: false,
          cajas_iniciales: faltante, cajas_disponibles: faltante, peso_inicial_lb: 0, peso_disponible_lb: 0,
          costo_inicial: r2(faltante * costo), costo_disponible: r2(faltante * costo),
        },
      });
      acciones.fifo.push({ sku: existencia.products.sku, existencia: saldo, fifo_anterior: fifo, cajas_agregadas: faltante, costo, lote_id: Number(lote.id) });
    }

    // Corrige cualquier distribución cuyo movimiento físico neto exceda lo recibido.
    // La reparación es conservadora: sólo compensa excedentes demostrables; nunca inventa
    // una entrega cuando falta evidencia física.
    const lineas = await tx.distribucion_lineas.findMany({
      where: { distribuciones: { negocio_id: negocio.id, estado: { not: 'cancelada' } }, cantidad_recibida: { not: null } },
      select: { id: true, distribucion_id: true, product_id: true, ubicacion_destino_id: true, cantidad_cargada: true, cantidad_recibida: true },
    });
    const movimientos = lineas.length ? await tx.movimientos_inventario.findMany({ where: { negocio_id: negocio.id, distribucion_linea_id: { in: lineas.map((linea) => linea.id) } }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }] }) : [];
    const movimientosPorLinea = new Map<string, typeof movimientos>();
    for (const movimiento of movimientos) {
      const clave = movimiento.distribucion_linea_id?.toString();
      if (!clave) continue;
      movimientosPorLinea.set(clave, [...(movimientosPorLinea.get(clave) ?? []), movimiento]);
    }
    const productos = await tx.products.findMany({ where: { negocio_id: negocio.id, id: { in: [...new Set(lineas.map((linea) => linea.product_id))] } }, select: { id: true, linea_operacion: true, ultimo_costo: true, costo_promedio: true, nombre: true } });
    const productoPorId = new Map(productos.map((producto) => [producto.id.toString(), producto]));
    for (const linea of lineas) {
        const esperado = r3(n(linea.cantidad_recibida ?? linea.cantidad_cargada));
        if (esperado <= 0) continue;
        const movimientosLinea = movimientosPorLinea.get(linea.id.toString()) ?? [];
        const neto = r3(movimientosLinea.reduce((total, movimiento) => {
          if (movimiento.ubicacion_destino_id === linea.ubicacion_destino_id) return total + n(movimiento.cantidad);
          if (movimiento.ubicacion_origen_id === linea.ubicacion_destino_id) return total - n(movimiento.cantidad);
          return total;
        }, 0));
        const excedente = r3(neto - esperado);
        if (excedente <= 0.001) continue;
        const salidas = movimientosLinea.filter((movimiento) => movimiento.ubicacion_destino_id === linea.ubicacion_destino_id && movimiento.ubicacion_origen_id != null && !movimiento.idempotency_key.startsWith('recepcion:'));
        const salida = salidas[0];
        if (!salida?.ubicacion_origen_id) throw new Error(`No se puede compensar la línea ${linea.id}: falta movimiento de origen.`);
        const clave = `integridad-reversion:${linea.id}:${excedente.toFixed(3)}`;
        const yaExiste = await tx.movimientos_inventario.findUnique({ where: { idempotency_key: clave }, select: { id: true } });
        if (yaExiste) continue;

        const producto = productoPorId.get(linea.product_id.toString());
        if (producto?.linea_operacion === 'desechables') {
          let pendiente = excedente;
          for (const fuente of salidas) {
            if (pendiente <= 0.001) break;
            const disponibleFuente = r3(n(fuente.cantidad));
            const restaurar = Math.min(pendiente, disponibleFuente);
            if (restaurar <= 0) continue;
            await restaurarCantidadSalidaFifo(tx, { movimientoIds: [fuente.id], ubicacionId: fuente.ubicacion_origen_id!, productId: linea.product_id, cantidad: restaurar });
            pendiente = r3(pendiente - restaurar);
          }
        }
        const costo = n(salida.costo_unitario) || n(producto?.costo_promedio) || n(producto?.ultimo_costo);
        await aplicarMovimiento(tx, {
          negocioId: negocio.id, productId: linea.product_id, tipo: 'correccion', cantidad: excedente,
          usuarioId: admin.id, origenId: linea.ubicacion_destino_id, destinoId: salida.ubicacion_origen_id,
          costoUnitario: costo, documentoTipo: 'correccion_integridad', documentoId: linea.distribucion_id,
          distribucionLineaId: linea.id, comentario: `Compensación de excedente físico detectado por auditoría: neto ${neto} vs recibido ${esperado}.`,
          idempotencyKey: clave,
          deltas: [
            { ubicacionId: linea.ubicacion_destino_id, productId: linea.product_id, disponible: -excedente },
            { ubicacionId: salida.ubicacion_origen_id, productId: linea.product_id, disponible: excedente, costoUnitario: costo },
          ],
          permitirDisponibleNegativo: true,
        });
        acciones.movimientos_compensatorios.push({ distribucion_id: Number(linea.distribucion_id), linea_id: Number(linea.id), excedente, movimiento: clave });
      }

    // Un despacho cerrado implica que el pedido ya fue entregado. Se corrigen sólo
    // estados divergentes, conservando los pedidos y su historial.
    const pedidosInconsistentes = await tx.pedidos_operativos.findMany({
      where: { negocio_id: negocio.id, estado: { in: ['en_preparacion', 'despachado'] }, lineas: { some: { distribucion_lineas: { some: { distribuciones: { estado: { in: ['entregada', 'cerrada', 'cerrada_con_incidencias'] } } } } } } },
      select: { id: true, estado: true },
    });
    if (pedidosInconsistentes.length) {
      await tx.pedidos_operativos.updateMany({ where: { id: { in: pedidosInconsistentes.map((p) => p.id) } }, data: { estado: 'entregado' } });
      acciones.estados_pedido.push(...pedidosInconsistentes.map((p) => ({ pedido_id: Number(p.id), anterior: p.estado, nuevo: 'entregado' })));
    }

    // La factura ARRASTRE-OPEN es el duplicado operacional conocido de LOMBA.
    const arrastre = await tx.facturas.findFirst({ where: { negocio_id: negocio.id, numero: '2026-29-BPM-ARRASTRE-OPEN', estado: { not: 'anulada' } }, select: { id: true, total: true } });
    if (arrastre) {
      await tx.facturas.update({ where: { id: arrastre.id }, data: { estado: 'anulada' } });
      acciones.facturas.push({ factura_id: Number(arrastre.id), numero: '2026-29-BPM-ARRASTRE-OPEN', anterior: n(arrastre.total), nuevo_estado: 'anulada' });
    }

    // El orden duplicado era accidental: se conserva el orden de BPM y se mueve
    // la variante Tapatíos a un espacio libre inmediatamente posterior.
    const pastorTap = await tx.products.findFirst({ where: { negocio_id: negocio.id, sku: 'MEAT-PASTOR-TAP' }, select: { id: true, orden_operativo: true } });
    if (pastorTap?.orden_operativo === 3) {
      await tx.products.update({ where: { id: pastorTap.id }, data: { orden_operativo: 14 } });
      acciones.catalogo.push({ sku: 'MEAT-PASTOR-TAP', anterior: 3, nuevo: 14 });
    }

    const negativos = await tx.existencias.findMany({ where: { negocio_id: negocio.id, cantidad_disponible: { lt: -0.001 } }, include: { products: { select: { sku: true, nombre: true } }, ubicaciones: { select: { id: true, codigo: true, nombre: true } } } });
    for (const negativo of negativos) {
      const existe = await tx.incidencias.findFirst({ where: { negocio_id: negocio.id, tipo: 'cajas_perdidas_inventario', estado: 'abierta', ubicacion_id: negativo.ubicacion_id, product_id: negativo.product_id }, select: { id: true } });
      if (existe) continue;
      const incidencia = await tx.incidencias.create({
        data: {
          negocio_id: negocio.id, tipo: 'cajas_perdidas_inventario', prioridad: 'alta', ubicacion_id: negativo.ubicacion_id, product_id: negativo.product_id,
          documento_tipo: 'auditoria_operativa', documento_id: semana34?.id ?? null, responsable_id: admin.id,
          comentarios: `${negativo.products.nombre} (${negativo.products.sku}) conserva saldo ${n(negativo.cantidad_disponible)}: faltante físico documentado; no se ajusta a cero sin un conteo que lo respalde.`,
        },
      });
      acciones.faltantes_documentados.push({ incidencia_id: Number(incidencia.id), sku: negativo.products.sku, ubicacion: negativo.ubicaciones.codigo, saldo: n(negativo.cantidad_disponible) });
    }

    await tx.auditoria_operativa.create({ data: { negocio_id: negocio.id, usuario_id: admin.id, accion: 'reparar_integridad_produccion_20260824', entidad: 'operacion', datos: acciones } });
    return { negocio_id: Number(negocio.id), acciones };
  }, { timeout: 120000, maxWait: 10000 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
