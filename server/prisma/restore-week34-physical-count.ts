import { PrismaClient } from '@prisma/client';
import { guardarInventarioFinal } from '../src/operacion/service.js';

/**
 * Recupera el desglose del conteo físico final de CARN de semana 34 desde el
 * snapshot del pg-dump del 23 de agosto.
 *
 * El snapshot conserva las cantidades por producto. RAW-CHICKEN se corrige a
 * cero porque la auditoría de producción registra explícitamente ese conteo.
 * El script no restaura inventario_semanal ni modifica facturas: crea una nueva
 * captura física trazable y deja que el flujo normal ajuste existencias/FIFO.
 *
 * Uso protegido:
 * DATABASE_URL='...' BPM_RESTORE_WEEK34=1 npx tsx prisma/restore-week34-physical-count.ts
 */
const prisma = new PrismaClient();
const APPLY = process.env.BPM_RESTORE_WEEK34 === '1';
const NEGOCIO = 'Burrito Parrilla Mexicana';
const FECHA = '2026-08-22';
const FUENTE = 'pg-dump-postgres-1787443210.dmp';
const NOTA = `Recuperado desde ${FUENTE}; Chicken corregido a 0 según auditoría de producción.`;

// Snapshot public.inventario_semanal de semana 34 / CARN.
const cantidadesPorSku: Record<string, number> = {
  'MEAT-STEAK': 3,
  'MEAT-CHICKEN': 0,
  'MEAT-PASTOR-BPM': 21,
  'MEAT-PASTOR-TAP': 0,
  'MEAT-ASADA': 2,
  'MEAT-FAJITAS': 0,
  'MEAT-MILANESA': 6,
  'MEAT-TAMAL': 23,
  'MEAT-CHILE': 8,
  'MEAT-DORADO': 30,
  'MEAT-ADOBO': 0,
  'MEAT-CARNITAS': 103,
  'MEAT-CATERING': 0,
  'MEAT-PULPA': 30,
  'MEAT-TAPATIOS-TACO': 13,
  'RAW-INSIDE-SKIRT': 190,
  'RAW-CHICKEN': 0,
  'RAW-PORK-BUTT': 60,
  'RAW-OUTSIDE-SKIRT': 33,
  'RAW-INSIDE-ROUND': 0,
  'RAW-TAPATIOS-TACO': 5,
};

async function main() {
  if (!APPLY) throw new Error('Protegido: define BPM_RESTORE_WEEK34=1 para aplicar la recuperación.');

  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: NEGOCIO }, select: { id: true } });
  const admin = await prisma.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' }, select: { id: true } });
  const carn = await prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'CARN', activo: true }, select: { id: true } });
  const semana = await prisma.semanas_operativas.findUniqueOrThrow({
    where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 34 } },
    select: { id: true, estado: true },
  });
  if (semana.estado !== 'reabierta') throw new Error(`Semana 34 debe estar reabierta; estado actual: ${semana.estado}.`);

  const marca = await prisma.auditoria_operativa.findFirst({
    where: { negocio_id: negocio.id, accion: 'restaurar_conteo_fisico_semana_34_desde_backup', entidad: 'conteo' },
    select: { id: true },
  });
  if (marca) {
    console.log(JSON.stringify({ omitido: true, motivo: 'ya_restaurado', auditoria_id: Number(marca.id) }));
    return;
  }

  const existente = await prisma.conteos.findFirst({
    where: { negocio_id: negocio.id, ubicacion_id: carn.id, fecha: new Date(`${FECHA}T00:00:00.000Z`), notas: { startsWith: 'inventario_final_operativo' } },
    select: { id: true, notas: true },
  });
  if (existente) throw new Error(`Ya existe un conteo final de CARN para ${FECHA}: ${existente.id} (${existente.notas ?? ''}).`);

  const productos = await prisma.products.findMany({
    where: { negocio_id: negocio.id, activo: true, linea_operacion: 'carne', es_cargo_compra: false },
    select: { id: true, sku: true },
  });
  const skus = new Set(productos.map((p) => p.sku));
  const faltantes = Object.keys(cantidadesPorSku).filter((sku) => !skus.has(sku));
  const inesperados = productos.filter((p) => !(p.sku in cantidadesPorSku)).map((p) => p.sku);
  if (faltantes.length || inesperados.length) {
    throw new Error(`Catálogo no coincide. Faltantes: ${faltantes.join(', ') || 'ninguno'}. Inesperados: ${inesperados.join(', ') || 'ninguno'}.`);
  }

  const resultado = await guardarInventarioFinal(negocio.id, admin.id, {
    ubicacion_id: Number(carn.id),
    fecha: FECHA,
    motivo: NOTA,
    lineas: productos.map((p) => ({ product_id: Number(p.id), cantidad: cantidadesPorSku[p.sku]! })),
  });

  const conteo = await prisma.conteos.findUniqueOrThrow({
    where: { id: BigInt(resultado.inventario_id) },
    include: { lineas: { select: { product_id: true, qty: true } } },
  });
  const auditoria = await prisma.auditoria_operativa.create({
    data: {
      negocio_id: negocio.id,
      usuario_id: admin.id,
      accion: 'restaurar_conteo_fisico_semana_34_desde_backup',
      entidad: 'conteo',
      entidad_id: conteo.id,
      datos: {
        semana_id: Number(semana.id),
        conteo_id: Number(conteo.id),
        fuente: FUENTE,
        fecha_conteo: FECHA,
        lineas: conteo.lineas.length,
        cajas: conteo.lineas.reduce((total, linea) => total + Number(linea.qty), 0),
        chicken_cajas: cantidadesPorSku['RAW-CHICKEN'],
        ajustes_ledger: resultado.ajustes,
      },
    },
  });
  console.log(JSON.stringify({ ok: true, conteo_id: Number(conteo.id), lineas: conteo.lineas.length, ajustes: resultado.ajustes, auditoria_id: Number(auditoria.id) }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
