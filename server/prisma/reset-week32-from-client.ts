import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY_WEEK32_CLIENT_RESET === '1';
const SIMULATE = process.env.SIMULATE_WEEK32_CLIENT_RESET === '1';
const KEY = 'client-reset-week30-31-open-week32-v1';
const startDelete = new Date('2026-07-19T00:00:00.000Z');
const endDelete = new Date('2026-08-01T00:00:00.000Z');
const week32Start = new Date('2026-08-02T00:00:00.000Z');
const week32End = new Date('2026-08-08T00:00:00.000Z');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Stock = { sku?: string; nombre: string; cantidad: number; costo: number; peso?: number };

const raw: Stock[] = [
  { sku: 'RAW-INSIDE-SKIRT', nombre: 'Inside Skirt Steak', cantidad: 58, peso: 3779.3766666667, costo: 26417.84 },
  { sku: 'RAW-CHICKEN', nombre: 'Chicken Breast', cantidad: 0, peso: 0, costo: 0 },
  { sku: 'RAW-PORK-BUTT', nombre: 'Pork Butt', cantidad: 60, peso: 5105.9, costo: 7403.555 },
  { sku: 'RAW-OUTSIDE-SKIRT', nombre: 'Outside Skirt', cantidad: 2, peso: 111.0666666667, costo: 1462.748 },
  { sku: 'RAW-INSIDE-ROUND', nombre: 'Inside Round', cantidad: 0, peso: 0, costo: 0 },
  { sku: 'RAW-TAPATIOS-TACO', nombre: 'Tapatíos Taco Meat Raw', cantidad: 10, peso: 586.5, costo: 3208.16 },
];

const terminados: Stock[] = [
  { sku: 'MEAT-STEAK', nombre: 'Steak Taco', cantidad: 0, costo: 200.157479338843 },
  { sku: 'MEAT-CHICKEN', nombre: 'Chicken', cantidad: 0, costo: 36.555555555556 },
  { sku: 'MEAT-PASTOR-BPM', nombre: 'Al Pastor BPM', cantidad: 0, costo: 53.262985611511 },
  { sku: 'MEAT-PASTOR-TAP', nombre: 'Al Pastor Tapatíos', cantidad: 0, costo: 53.262985611511 },
  { sku: 'MEAT-ASADA', nombre: 'Carne Asada', cantidad: 5, costo: 215.61466 },
  { sku: 'MEAT-FAJITAS', nombre: 'Fajitas', cantidad: 1, costo: 215.61466 },
  { sku: 'MEAT-MILANESA', nombre: 'Milanesa', cantidad: 39, costo: 142.13 },
  { sku: 'MEAT-TAMAL', nombre: 'Tamal Rojo', cantidad: 48, costo: 91 },
  { sku: 'MEAT-CHILE', nombre: 'Chile Relleno', cantidad: 9, costo: 91 },
  { sku: 'MEAT-DORADO', nombre: 'Taco Dorado', cantidad: 77, costo: 91 },
  { sku: 'MEAT-ADOBO', nombre: 'Adobo Picadillo', cantidad: 0, costo: 1 },
  { sku: 'MEAT-CARNITAS', nombre: 'Carnitas', cantidad: 113, costo: 20 },
  { sku: 'MEAT-PULPA', nombre: 'Pulpa', cantidad: 0, costo: 80 },
  { sku: 'MEAT-TAPATIOS-TACO', nombre: 'Tapatíos Taco Meat', cantidad: 0, costo: 80 },
];

const disposableRows: Array<[string, number, number]> = [
  ['SABERT BASE THREE COMP',177,54],['SABERT LIDS THREE COMP',178,36.93],['DINNER NAPKIN',707,29.95],['TORTA - 8X6 32oz',616,23],
  ['CLEAR CUP 24oz',185,38.95],['CLEAR CUP 12oz',52,44.95],['LIDS 16oz 24oz',85,18.25],['CUP HOLDER',32,29.95],
  ['STRAWS WRAPPED BLACK',92,22.95],['PORTION CUP 1.5oz',314,21.99],['PORTION LID 2oz',447,18.745],['KIT FORK & KNIFE HVY',277,27.5],
  ['FORK HD PLASTIC',92,11.07],['SPOON PLASTIC',38,13.03],['T-SHIRT BAG',36,18.95],['2oz PORTION CUP',78,22.95],
  ['XL NITRILE GLOVES',311,33.95],['MD VINYL GLOVES',35,15.85],['FOIL STD 12X1000',1683,21.95],['THERMAL PAPER ROLL 3 1/8"',51,33.5],
  ['DELI CONTAINER 32OZ CLEAR',11,35.71],['WAX PAPER 10X10',149,77.2],['BAGS #8 CRAFT PAPER',536,13.8],['SOAP 4-1',48,27.99],
  ['OVEN & GRILL 4-1',82,32.99],['BAGS TRASH',125,23.05],['EVAPORATED MILK',207,26.11],['CONDENSED MILK',63,42.24],
  ['COCO LOPEZ',27,81.95],['GARLIC SALT',7,5],['BLUE TAPE',2,30],['MARKERS',14,5],['CLEAR TAPE',4,5],['TRAPOS AMARILLOS',20,5],
  ['ARBOL BLEND',14,25],['RED SAUCE BLEND',30,25],['GREEN SAUCE BLEND',66,25],['HABANERO BLEND',49,25],['MOLE BLEND',61,25],
  ['RANCHERO BLEND',44,25],['POBLANO BLEND',8,25],['CARNITAS BLEND',46,25],['RICE BLEND',60,35],['MANGO',122,21.5],
  ['CUCUMBER LEMON',74,21.5],['JAMAICA',115,21.5],['TAPATIOS THREE COMPARTMENT',452,29.07],['TAPATIOS ONE COMPARTMENT',31,29.07],
  ['TAPATIOS SUIZO',146,23.55],['CLASIC COKE',2,137.54],['CO2 CYLINDER 20 LBS',0,70.54],['FRIED ICE CREAM',130,27.55],
  ['CUPS 12 BLACK',0,20.46],['RICE FLOUR',18,20],
];
const desechables: Stock[] = disposableRows.map(([nombre, cantidad, costo], i) => ({ nombre: nombre.trim(), cantidad, costo, sku: i < 50 ? undefined : undefined }));

const cuentas = [
  { proveedor: 'Christ Panos', total: 3976 },
  { proveedor: 'Gordon', total: 42163.61 },
  { proveedor: 'South Star Foods', total: 27328.8 },
];

function totals() {
  const rounded = (value: Prisma.Decimal) => Number(value.toDecimalPlaces(2));
  const rawValue = rounded(raw.reduce((sum, item) => sum.plus(item.costo), new Prisma.Decimal(0)));
  const finishedValue = rounded(terminados.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.cantidad).times(item.costo)), new Prisma.Decimal(0)));
  const disposableValue = rounded(desechables.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.cantidad).times(item.costo)), new Prisma.Decimal(0)));
  const payable = rounded(cuentas.reduce((sum, item) => sum.plus(item.total), new Prisma.Decimal(0)));
  return { rawValue, finishedValue, meatValue: r2(rawValue + finishedValue), disposableValue, payable };
}

async function main() {
  const expected = { rawValue: 38492.3, finishedValue: 21290.76, meatValue: 59783.06, disposableValue: 217507.29, payable: 73468.41 };
  const calculated = totals();
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (Math.abs(calculated[key] - expected[key]) > 0.01) throw new Error(`Excel no reconcilia ${key}: ${calculated[key]} vs ${expected[key]}`);
  }
  console.log('Vista previa reinicio semana 32:', calculated);
  console.log(`Inventario: ${raw.filter(x=>x.cantidad>0).length} materias primas, ${terminados.filter(x=>x.cantidad>0).length} terminados, ${desechables.filter(x=>x.cantidad>0).length} desechables.`);
  console.log(`CxP: ${cuentas.map(x=>`${x.proveedor} $${x.total.toFixed(2)}`).join(' · ')}`);
  if (!APPLY && !SIMULATE) return console.log('Sin cambios. Usa SIMULATE_WEEK32_CLIENT_RESET=1 para probar con rollback o APPLY_WEEK32_CLIENT_RESET=1 para aplicar.');

  const result = await prisma.$transaction(async (tx) => {
    const negocio = await tx.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
    if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: KEY } } })) throw new Error(`${KEY} ya fue aplicado.`);
    const [admin, bodega, carniceria, unidadCaja] = await Promise.all([
      tx.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' } }),
      tx.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'BOD' } }),
      tx.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'CARN' } }),
      tx.unidades.findFirstOrThrow({ where: { negocio_id: negocio.id, nombre: { equals: 'Caja', mode: 'insensitive' } } }),
    ]);

    // Asegura que todo renglón con saldo del Excel tenga un producto rastreable.
    for (const [nombre, , costo] of disposableRows.filter(([n]) => ['CLASIC COKE','CO2 CYLINDER 20 LBS'].includes(n))) {
      const suffix = nombre === 'CLASIC COKE' ? '0053' : '0054';
      await tx.products.upsert({
        where: { negocio_id_sku: { negocio_id: negocio.id, sku: `BPM-${suffix}` } },
        update: { nombre, activo: true, ultimo_costo: costo, costo_promedio: costo },
        create: { negocio_id: negocio.id, nombre, sku: `BPM-${suffix}`, unidad_distribucion_id: unidadCaja.id, unidad_compra_id: unidadCaja.id, unidad_almacen_id: unidadCaja.id, linea_operacion: 'desechables', tipo_operativo: 'desechable', ultimo_costo: costo, costo_promedio: costo, orden_operativo: Number(suffix) },
      });
    }

    const weeks = await tx.semanas_operativas.findMany({ where: { negocio_id: negocio.id, anio: 2026, semana: { in: [30,31] } } });
    const weekIds = weeks.map(x=>x.id);
    const invoices = await tx.facturas.findMany({ where: { negocio_id: negocio.id, OR: [{ semana_id: { in: weekIds } }, { emitida_at: { gte: startDelete, lte: endDelete } }] }, select: { id: true } });
    if (invoices.length) {
      await tx.facturas.updateMany({ where: { reemplaza_factura_id: { in: invoices.map(x=>x.id) } }, data: { reemplaza_factura_id: null } });
      await tx.facturas.deleteMany({ where: { id: { in: invoices.map(x=>x.id) } } });
    }

    const distributions = await tx.distribuciones.findMany({ where: { negocio_id: negocio.id, fecha_entrega: { gte: startDelete, lte: endDelete } }, include: { lineas: { select: { id: true } } } });
    const distributionIds = distributions.map(x=>x.id);
    const distributionLineIds = distributions.flatMap(x=>x.lineas.map(l=>l.id));
    if (distributionIds.length) {
      await tx.incidencias.deleteMany({ where: { negocio_id: negocio.id, OR: [{ documento_tipo: 'distribucion', documento_id: { in: distributionIds } }, { distribucion_linea_id: { in: distributionLineIds } }] } });
      await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, documento_tipo: 'distribucion', documento_id: { in: distributionIds } } });
      await tx.distribuciones.deleteMany({ where: { id: { in: distributionIds } } });
    }
    const orders = await tx.pedidos_operativos.deleteMany({ where: { negocio_id: negocio.id, fecha_entrega: { gte: startDelete, lte: endDelete } } });

    const counts = await tx.conteos.findMany({ where: { negocio_id: negocio.id, fecha: { gte: startDelete, lte: endDelete } }, select: { id: true } });
    if (counts.length) {
      await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, documento_tipo: 'conteo', documento_id: { in: counts.map(x=>x.id) } } });
      await tx.conteos.deleteMany({ where: { id: { in: counts.map(x=>x.id) } } });
    }
    const productions = await tx.producciones.findMany({ where: { negocio_id: negocio.id, fecha: { gte: startDelete, lte: endDelete } }, select: { id: true } });
    if (productions.length) {
      await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, documento_tipo: 'produccion', documento_id: { in: productions.map(x=>x.id) } } });
      await tx.producciones.deleteMany({ where: { id: { in: productions.map(x=>x.id) } } });
    }
    const purchases = await tx.compras.findMany({ where: { negocio_id: negocio.id, fecha: { gte: startDelete, lte: endDelete } }, include: { lineas: { select: { id: true } } } });
    if (purchases.length) {
      await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, documento_tipo: 'compra', documento_id: { in: purchases.map(x=>x.id) } } });
      await tx.lotes_materia_prima.deleteMany({ where: { compra_linea_id: { in: purchases.flatMap(x=>x.lineas.map(l=>l.id)) } } });
      await tx.compras.deleteMany({ where: { id: { in: purchases.map(x=>x.id) } } });
    }
    await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, fecha: { gte: startDelete, lt: week32Start } } });
    await tx.ajustes_facturacion.deleteMany({ where: { negocio_id: negocio.id, semana_id: { in: weekIds } } });
    if (weekIds.length) await tx.semanas_operativas.deleteMany({ where: { id: { in: weekIds } } });

    // Cierra saldos anteriores que el cliente excluyó expresamente de la apertura.
    const priorOpen = await tx.compras.findMany({ where: { negocio_id: negocio.id, estado: { not: 'cancelada' } }, include: { pagos: true } });
    for (const purchase of priorOpen) {
      const paid = purchase.pagos.reduce((sum,p)=>sum+Number(p.monto),0);
      const balance = r2(Number(purchase.total)-paid);
      if (balance <= 0) continue;
      await tx.pagos_compra.create({ data: { compra_id: purchase.id, monto: balance, pagado_at: endDelete, registrado_por: admin.id } });
      await tx.compras.update({ where: { id: purchase.id }, data: { estado: 'pagada', pagado_at: endDelete } });
      await tx.auditoria_operativa.create({ data: { negocio_id: negocio.id, usuario_id: admin.id, accion: 'regularizar_cxp_apertura_semana_32', entidad: 'compra', entidad_id: purchase.id, datos: { saldo_regularizado: balance, motivo: 'No incluido en CxP del cierre del cliente' } } });
    }

    // El saldo físico sustituye todo saldo derivado anterior, también en sucursales.
    await tx.existencias.updateMany({ where: { negocio_id: negocio.id }, data: { cantidad_disponible: 0, cantidad_reservada: 0, cantidad_transito: 0, costo_transito_promedio: null } });
    await tx.lotes_materia_prima.updateMany({ where: { negocio_id: negocio.id }, data: { cajas_disponibles: 0, peso_disponible_lb: 0, costo_disponible: 0 } });

    const products = await tx.products.findMany({ where: { negocio_id: negocio.id, activo: true } });
    const bySku = new Map(products.map(p=>[p.sku,p]));
    const byName = new Map(products.map(p=>[p.nombre.trim().toUpperCase(),p]));
    const stocks = [
      ...raw.map(item=>({ ...item, location: carniceria })),
      ...terminados.map(item=>({ ...item, location: carniceria })),
      ...desechables.map(item=>({ ...item, location: bodega })),
    ];
    for (const item of stocks) {
      const product = item.sku ? bySku.get(item.sku) : byName.get(item.nombre.trim().toUpperCase());
      if (!product) throw new Error(`Producto del Excel sin mapear: ${item.nombre}`);
      const unitCost = item.peso == null ? item.costo : item.cantidad > 0 ? item.costo / item.cantidad : Number(product.ultimo_costo ?? 0);
      await tx.products.update({ where: { id: product.id }, data: { ultimo_costo: unitCost, costo_promedio: unitCost } });
      await tx.existencias.upsert({ where: { ubicacion_id_product_id: { ubicacion_id: item.location.id, product_id: product.id } }, create: { negocio_id: negocio.id, ubicacion_id: item.location.id, product_id: product.id, cantidad_disponible: item.cantidad, costo_promedio: unitCost }, update: { cantidad_disponible: item.cantidad, cantidad_reservada: 0, cantidad_transito: 0, costo_promedio: unitCost, costo_transito_promedio: null } });
      if (item.cantidad > 0) await tx.movimientos_inventario.create({ data: { negocio_id: negocio.id, product_id: product.id, ubicacion_destino_id: item.location.id, tipo: 'conteo_inicial', cantidad: item.cantidad, costo_unitario: unitCost, costo_total: item.cantidad*unitCost, usuario_id: admin.id, fecha: week32Start, documento_tipo: 'reinicio_semana', comentario: 'Inventario inicial semana 32 importado del cierre físico del cliente', idempotency_key: `reset-week32:${item.location.id}:${product.id}` } });
      if (item.peso != null && item.cantidad > 0) await tx.lotes_materia_prima.create({ data: { negocio_id: negocio.id, ubicacion_id: item.location.id, product_id: product.id, fecha: week32Start, congelado: false, cajas_iniciales: item.cantidad, cajas_disponibles: item.cantidad, peso_inicial_lb: item.peso, peso_disponible_lb: item.peso, costo_inicial: item.costo, costo_disponible: item.costo } });
    }

    const week32 = await tx.semanas_operativas.upsert({ where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 32 } }, update: { inicia_at: week32Start, termina_at: week32End, estado: 'abierta', cerrado_por: null, cerrado_at: null, valor_carne: calculated.meatValue, valor_congelado: 0, valor_desechables: calculated.disposableValue, cuentas_por_cobrar: 0, cuentas_por_pagar: calculated.payable, balance_neto: r2(calculated.meatValue+calculated.disposableValue-calculated.payable) }, create: { negocio_id: negocio.id, anio: 2026, semana: 32, inicia_at: week32Start, termina_at: week32End, estado: 'abierta', valor_carne: calculated.meatValue, valor_congelado: 0, valor_desechables: calculated.disposableValue, cuentas_por_cobrar: 0, cuentas_por_pagar: calculated.payable, balance_neto: r2(calculated.meatValue+calculated.disposableValue-calculated.payable) } });

    for (const location of [carniceria,bodega]) {
      const locationStocks = stocks.filter(x=>x.location.id===location.id);
      const count = await tx.conteos.create({ data: { negocio_id: negocio.id, ubicacion_id: location.id, estado: 'cerrado', fecha: week32Start, creado_por: admin.id, cerrado_por: admin.id, cerrado_at: new Date(), notas: `inventario_inicial_operativo:2026-08-02:reinicio-cliente-semana32` } });
      await tx.conteo_lineas.createMany({ data: locationStocks.map(item=>{ const product=item.sku?bySku.get(item.sku):byName.get(item.nombre.trim().toUpperCase()); if(!product) throw new Error(`Producto sin mapear ${item.nombre}`); return { conteo_id: count.id, product_id: product.id, unidad_id: product.unidad_distribucion_id, qty: item.cantidad, factor: 1, contado: true }; }) });
    }

    const providers = new Map((await tx.proveedores.findMany({ where: { negocio_id: negocio.id }, select: { id: true, nombre: true } })).map(p=>[p.nombre.toUpperCase(),p]));
    for (const account of cuentas) {
      const provider=providers.get(account.proveedor.toUpperCase()); if(!provider) throw new Error(`Proveedor sin mapear: ${account.proveedor}`);
      await tx.compras.create({ data: { negocio_id: negocio.id, proveedor_id: provider.id, ubicacion_id: carniceria.id, fecha: endDelete, vence_at: endDelete, referencia: `APERTURA-W32-${provider.id}`, total: account.total, estado: 'pendiente', registrado_por: admin.id, idempotency_key: `reset-week32-cxp:${provider.id}` } });
    }
    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: KEY } });
    await tx.auditoria_operativa.create({ data: { negocio_id: negocio.id, usuario_id: admin.id, accion: 'reiniciar_operacion_semana_32', entidad: 'semana_operativa', entidad_id: week32.id, datos: { eliminadas: { pedidos: orders.count, distribuciones: distributionIds.length, compras: purchases.length, producciones: productions.length, conteos: counts.length, facturas: invoices.length }, inventario: calculated, cuentas } } });
    const summary = { orders: orders.count, distributions: distributionIds.length, purchases: purchases.length, productions: productions.length, counts: counts.length, invoices: invoices.length, week32: Number(week32.id) };
    if (SIMULATE) throw new Error(`SIMULATION_ROLLBACK:${JSON.stringify(summary)}`);
    return summary;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120000 });
  console.log('✅ Reinicio aplicado:', result);
}

main().catch(error=>{
  if (error instanceof Error && error.message.startsWith('SIMULATION_ROLLBACK:')) {
    console.log(`✅ Simulación revertida correctamente: ${error.message.slice('SIMULATION_ROLLBACK:'.length)}`);
    return;
  }
  console.error(error); process.exitCode=1;
}).finally(()=>prisma.$disconnect());
