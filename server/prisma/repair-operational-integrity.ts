import { PrismaClient } from '@prisma/client';

/**
 * Correcciones de datos comprobables de la auditoría operativa.
 *
 * El script está protegido para que una ejecución accidental sea de solo
 * lectura. Se puede reintentar: las capas FIFO y la bitácora son idempotentes.
 *
 * Uso:
 *   DATABASE_URL=... BPM_REPAIR_APPLY=1 npx tsx prisma/repair-operational-integrity.ts
 */
const prisma = new PrismaClient();
const negocioNombre = process.env.BPM_REPAIR_NEGOCIO ?? 'Burrito Parrilla Mexicana';
const usuarioId = BigInt(process.env.BPM_REPAIR_USUARIO_ID ?? '1');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const num = (v: unknown) => {
  const value = Number(v ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const costosComprobados: Record<string, { costo: number; motivo: string }> = {
  // Se registran como producción extraordinaria sin costo en el dominio.
  'MEAT-TAMAL': { costo: 0, motivo: 'produccion_extraordinaria_sin_costo' },
  'MEAT-ADOBO': { costo: 0, motivo: 'produccion_extraordinaria_sin_costo' },
  'MEAT-DORADO': { costo: 0, motivo: 'produccion_extraordinaria_sin_costo' },
  // La receta de Carnitas está marcada sin_costo; el 20 era el precio de la hoja.
  'MEAT-CARNITAS': { costo: 0, motivo: 'receta_sin_costo' },
  // Compra/costo real vigente; 91 es el precio fijo de venta.
  'MEAT-CHILE': { costo: 90.65, motivo: 'costo_de_compra_vigente_no_precio_venta' },
};

const fifoInicial = [
  { productId: 36n, sku: 'BPM-0024', cajas: 3, costo: 27.99 },
  { productId: 37n, sku: 'BPM-0025', cajas: 58, costo: 32.99 },
  { productId: 38n, sku: 'BPM-0026', cajas: 103, costo: 23.05 },
  { productId: 41n, sku: 'BPM-0029', cajas: 9, costo: 81.95 },
] as const;

async function main() {
  if (process.env.BPM_REPAIR_APPLY !== '1') {
    throw new Error('Reparación protegida: define BPM_REPAIR_APPLY=1 de forma explícita.');
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const negocio = await tx.negocios.findFirstOrThrow({ where: { nombre: negocioNombre } });
    const conteo = await tx.conteos.findFirstOrThrow({
      where: { id: 30n, negocio_id: negocio.id, ubicacion_id: 1n, estado: 'cerrado', notas: { startsWith: 'inventario_inicial_operativo' } },
      select: { id: true, fecha: true },
    });

    const costos: Array<Record<string, unknown>> = [];
    for (const [sku, ajuste] of Object.entries(costosComprobados)) {
      const producto = await tx.products.findFirstOrThrow({ where: { negocio_id: negocio.id, sku }, select: { id: true, precio_venta_fijo: true, ultimo_costo: true, costo_promedio: true } });
      await tx.products.update({ where: { id: producto.id }, data: { ultimo_costo: ajuste.costo, costo_promedio: ajuste.costo } });
      const existencias = await tx.existencias.findMany({ where: { negocio_id: negocio.id, product_id: producto.id }, select: { ubicacion_id: true, cantidad_transito: true } });
      for (const existencia of existencias) {
        await tx.existencias.update({
          where: { ubicacion_id_product_id: { ubicacion_id: existencia.ubicacion_id, product_id: producto.id } },
          data: { costo_promedio: ajuste.costo, ...(num(existencia.cantidad_transito) > 0 ? { costo_transito_promedio: ajuste.costo } : {}) },
        });
      }
      costos.push({ sku, anterior_ultimo_costo: num(producto.ultimo_costo), anterior_costo_promedio: num(producto.costo_promedio), precio_venta_fijo: num(producto.precio_venta_fijo), costo_nuevo: ajuste.costo, motivo: ajuste.motivo });
    }

    const facturaRolli = await tx.facturas.findFirst({ where: { negocio_id: negocio.id, numero: '2026-34-BPM-ROLLI-M', estado: { not: 'anulada' } }, include: { lineas: { select: { importe: true } } } });
    const facturaAjustada: Record<string, unknown> | null = facturaRolli
      ? { id: Number(facturaRolli.id), anterior: num(facturaRolli.total), renglones: r2(facturaRolli.lineas.reduce((suma, linea) => suma + num(linea.importe), 0)) }
      : null;
    if (facturaRolli && facturaAjustada && Math.abs(num(facturaRolli.total) - num(facturaAjustada.renglones)) <= 0.02 && Math.abs(num(facturaRolli.total) - num(facturaAjustada.renglones)) > 0.001) {
      await tx.facturas.update({ where: { id: facturaRolli.id }, data: { total: Number(facturaAjustada.renglones) } });
      facturaAjustada.nuevo = num(facturaAjustada.renglones);
    }

    const fifo: Array<Record<string, unknown>> = [];
    for (const item of fifoInicial) {
      const existencia = await tx.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: 1n, product_id: item.productId } }, select: { cantidad_disponible: true } });
      if (!existencia) throw new Error(`${item.sku}: no existe la existencia BOD.`);
      const capas = await tx.lotes_materia_prima.aggregate({ _sum: { cajas_disponibles: true }, where: { negocio_id: negocio.id, ubicacion_id: 1n, product_id: item.productId, cajas_disponibles: { gt: 0 } } });
      const respaldado = num(capas._sum.cajas_disponibles);
      const residual = r3(num(existencia.cantidad_disponible) - respaldado);
      if (residual < -0.001) throw new Error(`${item.sku}: las capas FIFO (${respaldado}) exceden existencia (${num(existencia.cantidad_disponible)}).`);
      if (residual <= 0.001) {
        fifo.push({ sku: item.sku, existencia: num(existencia.cantidad_disponible), capas_antes: respaldado, cajas_agregadas: 0 });
        continue;
      }
      const lote = await tx.lotes_materia_prima.create({
        data: {
          negocio_id: negocio.id, ubicacion_id: 1n, product_id: item.productId, fecha: conteo.fecha ?? new Date(), congelado: false,
          cajas_iniciales: residual, cajas_disponibles: residual, peso_inicial_lb: 0, peso_disponible_lb: 0,
          costo_inicial: r2(residual * item.costo), costo_disponible: r2(residual * item.costo),
        },
      });
      await tx.conteo_ajustes_lote.create({ data: { conteo_id: conteo.id, lote_id: lote.id, cajas: r3(-residual), peso_lb: 0, costo: r2(-residual * item.costo) } });
      fifo.push({ sku: item.sku, existencia: num(existencia.cantidad_disponible), capas_antes: respaldado, cajas_agregadas: residual, lote_id: Number(lote.id), costo: item.costo });
    }

    // Vincula correcciones históricas sólo cuando el documento, producto,
    // destino y cantidad dejan un único renglón posible. Las ambiguas se
    // quedan sin tocar para que la conciliación las muestre, nunca se adivinan.
    const lineas = await tx.distribucion_lineas.findMany({
      where: { distribuciones: { negocio_id: negocio.id } },
      select: { id: true, distribucion_id: true, product_id: true, ubicacion_destino_id: true, cantidad_cargada: true, pedido_linea: { select: { pedido_id: true } } },
    });
    const correcciones = await tx.movimientos_inventario.findMany({
      where: { negocio_id: negocio.id, documento_tipo: { in: ['correccion_distribucion', 'correccion_venta'] }, distribucion_linea_id: null },
      select: { id: true, documento_tipo: true, documento_id: true, product_id: true, cantidad: true, ubicacion_origen_id: true, ubicacion_destino_id: true },
    });
    const vinculos: Array<Record<string, unknown>> = [];
    for (const correccion of correcciones) {
      const candidatos = lineas.filter((linea) =>
        ((correccion.documento_tipo === 'correccion_distribucion' && correccion.documento_id === linea.distribucion_id)
          || (correccion.documento_tipo === 'correccion_venta' && correccion.documento_id === linea.pedido_linea?.pedido_id))
        && correccion.product_id === linea.product_id
        && num(linea.cantidad_cargada) > 0
        && Math.abs(num(correccion.cantidad) - num(linea.cantidad_cargada)) <= 0.0001
        && (correccion.ubicacion_destino_id === linea.ubicacion_destino_id || correccion.ubicacion_origen_id === linea.ubicacion_destino_id));
      if (candidatos.length !== 1) continue;
      await tx.movimientos_inventario.update({ where: { id: correccion.id }, data: { distribucion_linea_id: candidatos[0]!.id } });
      vinculos.push({ movimiento_id: Number(correccion.id), distribucion_linea_id: Number(candidatos[0]!.id) });
    }

    const marca = await tx.auditoria_operativa.findFirst({ where: { negocio_id: negocio.id, accion: 'reparacion_integridad_operativa_20260822', entidad: 'inventario' }, select: { id: true } });
    if (!marca) {
      await tx.auditoria_operativa.create({
        data: {
          negocio_id: negocio.id, usuario_id: usuarioId, accion: 'reparacion_integridad_operativa_20260822', entidad: 'inventario',
          datos: { fuente: 'auditoria_operativa', conteo_id: 30, costos, fifo, vinculos_correcciones: vinculos, negativo_trapos: { producto_id: 46, saldo: -6, causa: '2_inicial_menos_8_despachadas', se_conserva_como_faltante: true } },
        },
      });
    }
    const marcaFactura = await tx.auditoria_operativa.findFirst({ where: { negocio_id: negocio.id, accion: 'reparacion_factura_total_20260822', entidad: 'factura', entidad_id: facturaRolli?.id ?? -1n }, select: { id: true } });
    if (facturaAjustada?.nuevo != null && !marcaFactura && facturaRolli) {
      await tx.auditoria_operativa.create({ data: { negocio_id: negocio.id, usuario_id: usuarioId, accion: 'reparacion_factura_total_20260822', entidad: 'factura', entidad_id: facturaRolli.id, datos: facturaAjustada } });
    }
    return { negocio_id: Number(negocio.id), conteo_id: Number(conteo.id), costos, fifo, vinculos_correcciones: vinculos, factura_ajustada: facturaAjustada, bitacora: !marca };
  }, { isolationLevel: 'Serializable', maxWait: 10000, timeout: 30000 });
  console.log(JSON.stringify(resultado, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
