import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY_WEEK32_INVENTORY_V2 === '1';
const SIMULATE = process.env.SIMULATE_WEEK32_INVENTORY_V2 === '1';
const KEY = 'client-week32-corrected-inventory-v2';
const PAPERWARE_AVAILABLE = 218785.38;
const PAPERWARE_HOLD = 32485.20;
const PAPERWARE_TOTAL = 251270.58;
const CARTERA = 258175.36;

const corrected = [
  ['ARBOL BLEND',15,25],['BAGS TRASH',124,23.05],['BLUE TAPE',1,30],['CARNITAS BLEND',45,25],
  ['CLASIC COKE',3,137.54],['CLEAR CUP 12oz',51,44.95],['CLEAR CUP 24oz',184,38.95],['CLEAR TAPE',9,5],
  ['COCO LOPEZ',27,81.95],
  ['CO2 CYLINDER 20 LBS',10,70.54],['CONDENSED MILK',60,42.24],['CUCUMBER LEMON',73,21.5],['CUPS 12 BLACK',25,20.46],
  ['EVAPORATED MILK',206,26.11],['FOIL STD 12X1000',1685,21.95],['FRIED ICE CREAM',120,27.55],['GARLIC SALT',15,5],
  ['JAMAICA',114,21.5],['KIT FORK & KNIFE HVY',280,27.5],['MANGO',123,21.5],['MOLE BLEND',45,25],
  ['PORTION LID 2oz',446,18.745],['RICE BLEND',82,35],['TAPATIOS ONE COMPARTMENT',43,29.07],
  ['TAPATIOS SUIZO',144,23.55],['TAPATIOS THREE COMPARTMENT',444,29.07],['THERMAL PAPER ROLL 3 1/8"',50,33.5],
  ['XL NITRILE GLOVES',309,33.95],
] as const;

const holds = [
  ['TORTA - 8X6 32oz',600,28.75],
  ['FOIL STD 12X1000',486,23.95],
  ['THERMAL PAPER ROLL 3 1/8"',90,39.95],
] as const;

const r2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

async function main() {
  console.log(JSON.stringify({ aplicar: APPLY, simular: SIMULATE, correcciones: corrected.length, disponible: PAPERWARE_AVAILABLE, hold: PAPERWARE_HOLD, total: PAPERWARE_TOTAL }));
  if (!APPLY && !SIMULATE) return;
  const result = await prisma.$transaction(async (tx) => {
    const negocio = await tx.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
    if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: KEY } } })) throw new Error(`${KEY} ya fue aplicado.`);
    const [admin,bodega,semana32,rutaSur] = await Promise.all([
      tx.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' } }),
      tx.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'BOD' } }),
      tx.semanas_operativas.findUniqueOrThrow({ where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 32 } } }),
      tx.plantillas_ruta.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'DES-SUR-MIE' } }),
    ]);
    const movimientosPosteriores = await tx.movimientos_inventario.findMany({
      where: { negocio_id: negocio.id, fecha: { gte: new Date('2026-08-02T00:00:00.000Z') }, documento_tipo: { notIn: ['reinicio_semana','reconciliacion_excel_semana32'] } },
    });
    const movimientosNoPreservables = movimientosPosteriores.filter((m) => m.documento_tipo !== 'distribucion' || m.tipo !== 'transferencia');
    if (movimientosNoPreservables.length) throw new Error(`Hay ${movimientosNoPreservables.length} movimientos posteriores que no son despachos; se canceló para no sobrescribir operación.`);
    const productos = await tx.products.findMany({ where: { negocio_id: negocio.id, linea_operacion: 'desechables', activo: true } });
    const porNombre = new Map(productos.map((p) => [p.nombre.trim().toUpperCase(),p]));
    const conteoInicial = await tx.conteos.findFirstOrThrow({
      where: { negocio_id: negocio.id, ubicacion_id: bodega.id, fecha: new Date('2026-08-02T00:00:00.000Z'), notas: { startsWith: 'inventario_inicial_operativo' } },
      orderBy: { id: 'desc' },
    });
    const existencias = await tx.existencias.findMany({ where: { ubicacion_id: bodega.id, product_id: { in: productos.map((p)=>p.id) } } });
    const existenciaPorProducto = new Map(existencias.map((e)=>[e.product_id.toString(),e]));
    const cambios: Array<{ producto: (typeof productos)[number]; cantidad: number; costo: number; anterior: number; delta: number }> = [];
    for (const [nombre,cantidadInicial,costo] of corrected) {
      const producto = porNombre.get(nombre.toUpperCase());
      if (!producto) throw new Error(`Producto sin mapear: ${nombre}`);
      const existencia = existenciaPorProducto.get(producto.id.toString());
      if (!existencia) throw new Error(`Existencia sin mapear: ${nombre}`);
      const cantidad = movimientosPosteriores.reduce((actual,movimiento) => {
        if (movimiento.product_id !== producto.id) return actual;
        if (movimiento.ubicacion_origen_id === bodega.id) return actual-Number(movimiento.cantidad);
        if (movimiento.ubicacion_destino_id === bodega.id) return actual+Number(movimiento.cantidad);
        return actual;
      },cantidadInicial);
      const anterior = Number(existencia.cantidad_disponible);
      const delta = cantidad-anterior;
      if (Math.abs(delta)>0.0001 || existencia.costo_promedio === null || Math.abs(Number(existencia.costo_promedio)-costo)>0.0001) cambios.push({ producto,cantidad,costo,anterior,delta });
    }
    await Promise.all(cambios.map(({producto,cantidad,costo})=>tx.existencias.update({ where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: producto.id } }, data: { cantidad_disponible: cantidad, costo_promedio: costo } })));
    const cambiosCantidad = cambios.filter(({delta})=>Math.abs(delta)>0.0001);
    if (cambiosCantidad.length) await tx.movimientos_inventario.createMany({ data: cambiosCantidad.map(({producto,costo,delta})=>({
      negocio_id: negocio.id, product_id: producto.id, ubicacion_origen_id: delta<0?bodega.id:null,
      ubicacion_destino_id: delta>0?bodega.id:null, tipo: 'correccion', cantidad: Math.abs(delta), costo_unitario: costo,
      costo_total: r2(Math.abs(delta)*costo), documento_tipo: 'reconciliacion_excel_semana32', usuario_id: admin.id,
      fecha: new Date('2026-08-02T00:00:00.000Z'), comentario: 'Inventario corregido por Inventarios-2.xlsx',
      idempotency_key: `week32-inventory-v2:${producto.id}`,
    })) });
    await Promise.all(corrected.map(([nombre,cantidad])=>{
      const producto=porNombre.get(nombre.toUpperCase())!;
      return tx.conteo_lineas.updateMany({ where: { conteo_id: conteoInicial.id, product_id: producto.id }, data: { qty: cantidad } });
    }));
    await Promise.all(holds.map(([nombre,cantidad,costo]) => {
      const producto = porNombre.get(nombre.toUpperCase());
      if (!producto) throw new Error(`Producto hold sin mapear: ${nombre}`);
      return tx.existencias.update({ where: { ubicacion_id_product_id: { ubicacion_id: bodega.id, product_id: producto.id } }, data: { cantidad_transito: cantidad, costo_transito_promedio: costo } });
    }));
    const bolingbrook = await tx.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'TBO', activo: true } });
    const parada = await tx.plantilla_ruta_paradas.findFirst({ where: { plantilla_id: rutaSur.id, ubicacion_id: bolingbrook.id } });
    if (!parada) {
      const ultima = await tx.plantilla_ruta_paradas.aggregate({ where: { plantilla_id: rutaSur.id }, _max: { orden: true } });
      await tx.plantilla_ruta_paradas.create({ data: { plantilla_id: rutaSur.id, ubicacion_id: bolingbrook.id, orden: (ultima._max.orden ?? 0)+1, opcional: false } });
    }
    const balance = r2(Number(semana32.valor_carne)+Number(semana32.valor_congelado)+PAPERWARE_TOTAL+CARTERA-Number(semana32.cuentas_por_pagar));
    await tx.semanas_operativas.update({ where: { id: semana32.id }, data: { valor_desechables: PAPERWARE_TOTAL, cuentas_por_cobrar: CARTERA, balance_neto: balance } });
    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: KEY } });
    await tx.auditoria_operativa.create({ data: { negocio_id: negocio.id, usuario_id: admin.id, accion: 'reconciliar_inventario_corregido_semana_32', entidad: 'semana_operativa', entidad_id: semana32.id, datos: { fuente: 'Inventarios-2.xlsx', cambios: cambios.map((c)=>({ producto:c.producto.nombre, anterior:c.anterior, corregido_actual:c.cantidad })), disponible_apertura: PAPERWARE_AVAILABLE, hold: PAPERWARE_HOLD, total_apertura: PAPERWARE_TOTAL, despachos_preservados: movimientosPosteriores.length, sucursal_nueva: 'TBO', balance } } });
    if (SIMULATE) throw new Error(`SIMULATION_ROLLBACK:${JSON.stringify({ cambios: cambios.length, balance, ruta: rutaSur.codigo })}`);
    return { cambios: cambios.length, balance, ruta: rutaSur.codigo };
  }, { timeout: 120000 });
  console.log('Reconciliación aplicada:',result);
}

main().catch((error)=>{
  if (error instanceof Error && error.message.startsWith('SIMULATION_ROLLBACK:')) return console.log(`Simulación revertida: ${error.message.slice('SIMULATION_ROLLBACK:'.length)}`);
  console.error(error); process.exitCode=1;
}).finally(()=>prisma.$disconnect());
