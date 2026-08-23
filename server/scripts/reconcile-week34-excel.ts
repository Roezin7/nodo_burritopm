import { prisma } from '../src/db.js';
import { aplicarMovimiento } from '../src/ledger/service.js';

const NEGOCIO_ID = 1n;
const SEMANA_ID = 81n;
const CONTEO_ID = 38n;
const USUARIO_FALLBACK = 1n;
const CARN_ID = 29n;
const BOD_ID = 1n;
const FECHA_CONTEO = new Date('2026-08-22T00:00:00.000Z');
const AUDIT_ACTION = 'reconciliacion_excel_semana_34_20260823';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const n = (value: unknown) => (value == null ? 0 : Number(value));
const closeEnough = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

const targetQuantities: Record<string, number> = {
  'MEAT-STEAK': 20,
  'MEAT-CHICKEN': 0,
  'MEAT-PASTOR-BPM': 19,
  'MEAT-PASTOR-TAP': 0,
  'MEAT-TAPATIOS-TACO': 0,
  'MEAT-ASADA': 1,
  'MEAT-FAJITAS': 0,
  'MEAT-MILANESA': 6,
  'MEAT-TAMAL': 23,
  'MEAT-CHILE': 8,
  'MEAT-DORADO': 30,
  'MEAT-ADOBO': 0,
  'MEAT-CARNITAS': 107,
  'MEAT-PULPA': 0,
  'MEAT-CATERING': 0,
  'RAW-INSIDE-SKIRT': 190,
  'RAW-CHICKEN': 1,
  'RAW-PORK-BUTT': 60,
  'RAW-OUTSIDE-SKIRT': 33,
  'RAW-INSIDE-ROUND': 30,
  'RAW-TAPATIOS-TACO': 5,
};

// Valores que deben quedar en la fotografía de Production (34). Los productos
// sin costo real (Tamal, Chile, Dorado y Carnitas) se valúan al precio fijo
// operativo, como en el libro del cliente.
const targetValues: Record<string, number> = {
  'RAW-INSIDE-SKIRT': 83085.37,
  'RAW-CHICKEN': 56.40,
  'RAW-PORK-BUTT': 6920.18,
  'RAW-OUTSIDE-SKIRT': 22189.45,
  'RAW-INSIDE-ROUND': 10654.00,
  'RAW-TAPATIOS-TACO': 1430.42,
  'MEAT-STEAK': 3469.93,
  'MEAT-PASTOR-BPM': 971.56,
  'MEAT-ASADA': 213.55,
  'MEAT-MILANESA': 852.78,
  'MEAT-TAMAL': 2093.00,
  'MEAT-CHILE': 728.00,
  'MEAT-DORADO': 2730.00,
  'MEAT-CARNITAS': 2140.00,
};

const source = '/Users/arturohernandez/Downloads/Inventarios -2.xlsx';
const expectedAp = 129108.65;
const expectedPaperware = 228851.36;

type Lot = {
  id: bigint;
  costo_disponible: any;
  cajas_disponibles: any;
};

async function chooseUser(tx: any) {
  const admin = await tx.usuarios.findFirst({
    where: { negocio_id: NEGOCIO_ID, activo: true, rol: 'admin' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return admin?.id ?? USUARIO_FALLBACK;
}

async function setQuantity(
  tx: any,
  product: { id: bigint; sku: string },
  target: number,
  costUnit?: number,
  usuarioId = USUARIO_FALLBACK,
) {
  const current = await tx.existencias.findUnique({
    where: { ubicacion_id_product_id: { ubicacion_id: CARN_ID, product_id: product.id } },
  });
  const before = n(current?.cantidad_disponible);
  const delta = round3(target - before);
  if (Math.abs(delta) > 0.0001) {
    await aplicarMovimiento(tx, {
      negocioId: NEGOCIO_ID,
      productId: product.id,
      tipo: delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo',
      cantidad: Math.abs(delta),
      usuarioId,
      origenId: delta < 0 ? CARN_ID : null,
      destinoId: delta > 0 ? CARN_ID : null,
      costoUnitario: costUnit ?? n(current?.costo_promedio),
      documentoTipo: 'reconciliacion_excel_semana_34',
      documentoId: CONTEO_ID,
      comentario: `Ajuste de cantidad contra ${source}`,
      idempotencyKey: `reconciliacion-excel:34:${product.sku}:cantidad`,
      deltas: [{ ubicacionId: CARN_ID, productId: product.id, disponible: delta, costoUnitario: costUnit ?? n(current?.costo_promedio) }],
    });
  }
  if (costUnit != null) {
    await tx.existencias.update({
      where: { ubicacion_id_product_id: { ubicacion_id: CARN_ID, product_id: product.id } },
      data: { costo_promedio: round4(costUnit) },
    });
  }
  return { before, target, delta };
}

async function createOpeningLayer(
  tx: any,
  productId: bigint,
  cajas: number,
  peso: number,
  valor: number,
) {
  return tx.lotes_materia_prima.create({
    data: {
      negocio_id: NEGOCIO_ID,
      ubicacion_id: CARN_ID,
      product_id: productId,
      fecha: FECHA_CONTEO,
      congelado: false,
      cajas_iniciales: cajas,
      cajas_disponibles: cajas,
      peso_inicial_lb: peso,
      peso_disponible_lb: peso,
      costo_inicial: round2(valor),
      costo_disponible: round2(valor),
    },
  });
}

async function revalueRawLots(tx: any, productId: bigint, targetValue: number) {
  const lots: Lot[] = await tx.lotes_materia_prima.findMany({
    where: { negocio_id: NEGOCIO_ID, ubicacion_id: CARN_ID, product_id: productId, cajas_disponibles: { gt: 0 } },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    select: { id: true, costo_disponible: true, cajas_disponibles: true },
  });
  const currentValue = lots.reduce((sum, lot) => sum + n(lot.costo_disponible), 0);
  if (!lots.length || currentValue <= 0) throw new Error(`No hay capas FIFO activas para ${productId.toString()}`);
  let remaining = round2(targetValue);
  for (let index = 0; index < lots.length; index += 1) {
    const lot = lots[index];
    const value = index === lots.length - 1
      ? remaining
      : round2((n(lot.costo_disponible) / currentValue) * targetValue);
    await tx.lotes_materia_prima.update({ where: { id: lot.id }, data: { costo_disponible: value } });
    remaining = round2(remaining - value);
  }
  return { currentValue: round2(currentValue), targetValue: round2(targetValue), lots: lots.length };
}

async function revaluePaperware(tx: any) {
  const existencias = await tx.existencias.findMany({
    where: { negocio_id: NEGOCIO_ID, ubicacion_id: BOD_ID },
    include: { products: { select: { linea_operacion: true } } },
    orderBy: { product_id: 'asc' },
  });
  const valued = existencias.filter((e: any) => e.products.linea_operacion === 'desechables' && n(e.costo_promedio) !== 0 && n(e.cantidad_disponible) !== 0);
  const currentValue = valued.reduce((sum: number, e: any) => sum + n(e.cantidad_disponible) * n(e.costo_promedio), 0);
  if (currentValue <= 0) throw new Error('No se pudo determinar el valor actual de desechables en BOD');
  let remaining = expectedPaperware;
  for (let index = 0; index < valued.length; index += 1) {
    const e = valued[index];
    const currentLine = n(e.cantidad_disponible) * n(e.costo_promedio);
    const targetLine = index === valued.length - 1
      ? remaining
      : round2((currentLine / currentValue) * expectedPaperware);
    const targetCost = round4(targetLine / n(e.cantidad_disponible));
    await tx.existencias.update({
      where: { ubicacion_id_product_id: { ubicacion_id: BOD_ID, product_id: e.product_id } },
      data: { costo_promedio: targetCost },
    });
    remaining = round2(remaining - targetLine);
  }
  const lots: Lot[] = await tx.lotes_materia_prima.findMany({
    where: { negocio_id: NEGOCIO_ID, ubicacion_id: BOD_ID, cajas_disponibles: { gt: 0 } },
    include: { producto: { select: { linea_operacion: true } } },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
  });
  const paperLots = lots.filter((lot: any) => lot.producto.linea_operacion === 'desechables');
  const currentLotValue = paperLots.reduce((sum, lot) => sum + n(lot.costo_disponible), 0);
  if (paperLots.length && currentLotValue > 0) {
    let lotRemaining = expectedPaperware;
    for (let index = 0; index < paperLots.length; index += 1) {
      const lot = paperLots[index];
      const target = index === paperLots.length - 1
        ? lotRemaining
        : round2((n(lot.costo_disponible) / currentLotValue) * expectedPaperware);
      await tx.lotes_materia_prima.update({ where: { id: lot.id }, data: { costo_disponible: target } });
      lotRemaining = round2(lotRemaining - target);
    }
  }
  return { currentValue: round2(currentValue), targetValue: expectedPaperware, lotValue: round2(currentLotValue) };
}

async function main() {
  const apply = process.env.APPLY === '1';
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.auditoria_operativa.findFirst({ where: { negocio_id: NEGOCIO_ID, accion: AUDIT_ACTION }, select: { id: true, datos: true } });
    if (previous) return { alreadyApplied: true, auditId: previous.id.toString(), datos: previous.datos };
    if (!apply) return { dryRun: true, message: 'Simulación: usa APPLY=1 para aplicar en producción.' };

    const [week, count, location, purchase, products] = await Promise.all([
      tx.semanas_operativas.findUnique({ where: { id: SEMANA_ID } }),
      tx.conteos.findUnique({ where: { id: CONTEO_ID }, include: { lineas: true } }),
      tx.ubicaciones.findUnique({ where: { id: CARN_ID }, select: { codigo: true } }),
      tx.compras.findUnique({ where: { id: 45n }, include: { proveedor: { select: { nombre: true } }, pagos: true } }),
      tx.products.findMany({ where: { negocio_id: NEGOCIO_ID, sku: { in: Object.keys(targetQuantities) } }, select: { id: true, sku: true, nombre: true, costo_promedio: true, ultimo_costo: true } }),
    ]);
    if (!week || week.anio !== 2026 || week.semana !== 34 || !['abierta', 'reabierta'].includes(week.estado)) throw new Error('La semana 34 no está disponible para conciliación');
    if (!count || count.estado !== 'cerrado' || count.ubicacion_id !== CARN_ID || count.fecha?.toISOString().slice(0, 10) !== '2026-08-22') throw new Error('El conteo físico activo de semana 34 no coincide con el conteo recuperado');
    if (!location || location.codigo !== 'CARN') throw new Error('No se encontró la ubicación de Carnicería');
    if (!purchase || purchase.proveedor.nombre !== 'Super Clean' || !closeEnough(n(purchase.total), 3378.80) || purchase.pagos.length) throw new Error('La compra de Super Clean no coincide con el ajuste contable esperado');
    if (products.length !== Object.keys(targetQuantities).length) throw new Error('Faltan productos del catálogo para reconciliar semana 34');
    const holds = await tx.existencias.findMany({ where: { negocio_id: NEGOCIO_ID, ubicacion_id: CARN_ID }, select: { product_id: true, cantidad_reservada: true, cantidad_transito: true } });
    if (holds.some((e) => n(e.cantidad_reservada) !== 0 || n(e.cantidad_transito) !== 0)) throw new Error('La conciliación requiere Carnicería sin reserva ni tránsito');

    const usuarioId = await chooseUser(tx);
    const bySku = new Map(products.map((p) => [p.sku, p]));
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const productCosts: Record<string, number> = {};
    for (const [sku, value] of Object.entries(targetValues)) {
      const qty = targetQuantities[sku];
      if (qty > 0) productCosts[sku] = round4(value / qty);
    }

    const rawOpening = await Promise.all([
      tx.lotes_materia_prima.findMany({ where: { negocio_id: NEGOCIO_ID, ubicacion_id: CARN_ID, product_id: bySku.get('RAW-CHICKEN')!.id, cajas_disponibles: { gt: 0 } } }),
      tx.lotes_materia_prima.findMany({ where: { negocio_id: NEGOCIO_ID, ubicacion_id: CARN_ID, product_id: bySku.get('RAW-INSIDE-ROUND')!.id, cajas_disponibles: { gt: 0 } } }),
    ]);
    if (rawOpening.some((lots) => lots.length)) throw new Error('Ya existen capas de apertura para Chicken o Inside Round; no se aplica dos veces');

    for (const [sku, target] of Object.entries(targetQuantities)) {
      const product = bySku.get(sku)!;
      const current = await tx.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: CARN_ID, product_id: product.id } } });
      before[sku] = { cantidad: n(current?.cantidad_disponible), costo: current?.costo_promedio == null ? null : n(current.costo_promedio) };
    }

    await createOpeningLayer(tx, bySku.get('RAW-CHICKEN')!.id, 1, 40, targetValues['RAW-CHICKEN']);
    await createOpeningLayer(tx, bySku.get('RAW-INSIDE-ROUND')!.id, 30, 2326.2, targetValues['RAW-INSIDE-ROUND']);

    for (const [sku, target] of Object.entries(targetQuantities)) {
      const product = bySku.get(sku)!;
      const cost = productCosts[sku];
      const change = await setQuantity(tx, product, target, cost, usuarioId);
      after[sku] = { cantidad: target, costo: cost ?? ((before[sku] as any)?.costo ?? null), delta: change.delta };
    }

    const rawRevaluations = {
      'RAW-INSIDE-SKIRT': await revalueRawLots(tx, bySku.get('RAW-INSIDE-SKIRT')!.id, targetValues['RAW-INSIDE-SKIRT']),
      'RAW-OUTSIDE-SKIRT': await revalueRawLots(tx, bySku.get('RAW-OUTSIDE-SKIRT')!.id, targetValues['RAW-OUTSIDE-SKIRT']),
    };
    const paperware = await revaluePaperware(tx);

    for (const [sku, target] of Object.entries(targetQuantities)) {
      const product = bySku.get(sku)!;
      await tx.conteo_lineas.update({ where: { conteo_id_product_id: { conteo_id: CONTEO_ID, product_id: product.id } }, data: { qty: target, contado: true } });
      if (productCosts[sku] != null) {
        await tx.products.update({ where: { id: product.id }, data: { costo_promedio: productCosts[sku], ultimo_costo: productCosts[sku] } });
      }
    }
    await tx.products.update({ where: { id: bySku.get('RAW-INSIDE-ROUND')!.id }, data: { peso_caja_lb: 77.54 } });
    await tx.compras.update({ where: { id: 45n }, data: { total: 3733.57, ajuste_contable: 354.77 } });
    await tx.conteos.update({ where: { id: CONTEO_ID }, data: { notas: `${count.notas ?? ''}\nReconciliación auditada contra ${source}; conteo físico activo preservado para herencia de semana 35.`.trim() } });

    const audit = await tx.auditoria_operativa.create({
      data: {
        negocio_id: NEGOCIO_ID,
        usuario_id: usuarioId,
        accion: AUDIT_ACTION,
        entidad: 'semanas_operativas',
        entidad_id: SEMANA_ID,
        datos: {
          source,
          week: 34,
          count_id: CONTEO_ID.toString(),
          fifo: rawRevaluations,
          paperware,
          ap: { compra_id: '45', proveedor: 'Super Clean', before_total: 3378.80, after_total: 3733.57, ajuste_contable: 354.77, expected_open_ap: expectedAp },
          target_inventory: { meat: 137534.64, paperware: expectedPaperware, total: 366386.00 },
          quantities: targetQuantities,
          before,
          after,
          inheritance: 'El conteo cerrado del 2026-08-22 queda como fotografía física de semana 34; el cierre de semana 34 lo usará para crear el snapshot heredable de semana 35.',
        },
      },
    });
    await tx.semanas_operativas.update({ where: { id: SEMANA_ID }, data: { valor_carne: 137534.64, valor_desechables: expectedPaperware, cuentas_por_pagar: expectedAp } });
    return { auditId: audit.id.toString(), source, target_inventory: 366386.00, expectedAp, paperware, rawRevaluations };
  }, { isolationLevel: 'Serializable', maxWait: 15000, timeout: 60000 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
