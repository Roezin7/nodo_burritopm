import { PrismaClient } from '@prisma/client';

/**
 * Reclasifica los conteos capturados el sábado de la semana 36 que en realidad
 * representaban la apertura operativa. No borra movimientos ni capas FIFO: la
 * fotografía original queda como historial y sus cantidades se copian al
 * registro de apertura del domingo.
 *
 * Uso seguro (solo lectura): npx tsx prisma/reclassify-week36-opening.ts
 * Aplicar explícitamente: BPM_RECLASSIFY_WEEK36_APPLY=1 npx tsx ...
 */
const prisma = new PrismaClient();
const negocioNombre = process.env.BPM_RECLASSIFY_NEGOCIO ?? 'Burrito Parrilla Mexicana';
const usuarioId = BigInt(process.env.BPM_RECLASSIFY_USUARIO_ID ?? '1');
const inicio = new Date('2026-08-30T00:00:00.000Z');
const cierre = new Date('2026-09-05T00:00:00.000Z');

async function main() {
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: negocioNombre }, select: { id: true } });
  const ubicaciones = await prisma.ubicaciones.findMany({
    where: { negocio_id: negocio.id, codigo: { in: ['CARN', 'BOD'] }, activo: true },
    select: { id: true, codigo: true },
  });
  const resultado = await prisma.$transaction(async (tx) => {
    const cambios: Array<Record<string, unknown>> = [];
    for (const ubicacion of ubicaciones) {
      const apertura = await tx.conteos.findFirst({
        where: { negocio_id: negocio.id, ubicacion_id: ubicacion.id, fecha: inicio, tipo_captura: 'apertura' },
        include: { lineas: { select: { product_id: true, qty: true, unidad_id: true, factor: true, contado: true } } },
        orderBy: { id: 'desc' },
      });
      const capturado = await tx.conteos.findFirst({
        where: { negocio_id: negocio.id, ubicacion_id: ubicacion.id, fecha: cierre, tipo_captura: 'cierre' },
        include: { lineas: { select: { product_id: true, qty: true, unidad_id: true, factor: true, contado: true } } },
        orderBy: { id: 'desc' },
      });
      if (!apertura || !capturado || !capturado.lineas.length) continue;
      const yaReclasificado = await tx.conteos.findFirst({
        where: { negocio_id: negocio.id, ubicacion_id: ubicacion.id, tipo_captura: 'historico', notas: { startsWith: 'inventario_reclasificado_apertura:2026-08-30' } },
        select: { id: true },
      });
      if (yaReclasificado) continue;

      const antes = apertura.lineas.map((linea) => ({ product_id: Number(linea.product_id), qty: Number(linea.qty) }));
      const despues = capturado.lineas.map((linea) => ({ product_id: Number(linea.product_id), qty: Number(linea.qty) }));
      await tx.conteo_lineas.deleteMany({ where: { conteo_id: apertura.id } });
      await tx.conteo_lineas.createMany({ data: capturado.lineas.map((linea) => ({
        conteo_id: apertura.id,
        product_id: linea.product_id,
        qty: linea.qty,
        unidad_id: linea.unidad_id,
        factor: linea.factor,
        contado: true,
      })) });
      await tx.conteos.update({
        where: { id: apertura.id },
        data: { notas: `inventario_inicial_operativo:2026-08-30:capturado-retroactivo-${ubicacion.codigo}`, tipo_captura: 'apertura', cerrado_at: new Date() },
      });
      await tx.conteos.update({
        where: { id: capturado.id },
        data: { tipo_captura: 'historico', notas: `inventario_reclasificado_apertura:2026-08-30:capturado-${capturado.creado_at.toISOString().slice(0, 10)}-${ubicacion.codigo}` },
      });
      cambios.push({ ubicacion: ubicacion.codigo, apertura_id: Number(apertura.id), captura_original_id: Number(capturado.id), antes, despues });
    }
    if (cambios.length) {
      await tx.auditoria_operativa.create({
        data: {
          negocio_id: negocio.id,
          usuario_id: usuarioId,
          accion: 'reclasificar_conteo_semana_36_como_apertura',
          entidad: 'semana_operativa',
          datos: { semana: 36, periodo: { desde: '2026-08-30', hasta: '2026-09-05' }, cambios, regla: 'la captura representaba existencia inicial; los movimientos de la semana se aplican después' },
        },
      });
    }
    return cambios;
  });
  console.log(JSON.stringify({ aplicar: process.env.BPM_RECLASSIFY_WEEK36_APPLY === '1', cambios: resultado }, null, 2));
}

if (process.env.BPM_RECLASSIFY_WEEK36_APPLY !== '1') {
  console.error('Modo solo lectura. Define BPM_RECLASSIFY_WEEK36_APPLY=1 para aplicar.');
}

// La protección se evalúa antes de abrir la transacción; el modo lectura sólo
// muestra qué registros serían modificados.
if (process.env.BPM_RECLASSIFY_WEEK36_APPLY === '1') {
  void main().finally(() => prisma.$disconnect());
} else {
  // En modo lectura no se escribe: se usa la misma consulta de diagnóstico.
  prisma.$disconnect();
}
