import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Regulariza la semana 36 contra Billing (36) del cliente.
 *
 * No borra pedidos ni movimientos: las diferencias de cantidades/tarifas se
 * registran como ajustes de facturación trazables.  El script es idempotente
 * (cada ajuste usa una clave estable) y deja una incidencia para lo que no
 * puede resolverse sin inventar información (paperware residual y CxP).
 */
const prisma = new PrismaClient();
const negocioId = 1n;
const semanaId = 202n;
const usuarioId = 1n;

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Totales de Billing (36), filas 19/20 del Excel. Los códigos de producción
// equivalen a los encabezados del workbook (BURLI = TAQ. AURORA #2).
const fuente: Record<string, { unidades: number; carne: number }> = {
  LOMBA: { unidades: 38.5, carne: 4204.24 },
  NAPER: { unidades: 102, carne: 11331.26 },
  CAROL: { unidades: 56, carne: 5923.99 },
  LISLE: { unidades: 60, carne: 7107.04 },
  GLEND: { unidades: 38.5, carne: 4460.42 },
  WESTC: { unidades: 40, carne: 4313.40 },
  BATAV: { unidades: 47, carne: 5183.09 },
  ALGON: { unidades: 58.5, carne: 6971.67 },
  NAPER2: { unidades: 45, carne: 4760.96 },
  ROLLI: { unidades: 33, carne: 3133.33 },
  SCHAU: { unidades: 32.5, carne: 3642.34 },
  CRYST: { unidades: 30, carne: 3147.21 },
  AUROR: { unidades: 16, carne: 2108.00 },
  BURLI: { unidades: 6, carne: 1078.80 },
  TGE: { unidades: 36, carne: 3390.84 },
  TST: { unidades: 37, carne: 3682.62 },
  TLO: { unidades: 11, carne: 972.78 },
};

async function ajusteUnaVez(tx: Prisma.TransactionClient, data: Prisma.ajustes_facturacionCreateInput) {
  const existente = await tx.ajustes_facturacion.findFirst({
    where: { negocio_id: negocioId, idempotency_key: data.idempotency_key },
    select: { id: true },
  });
  if (existente) return Number(existente.id);
  const creado = await tx.ajustes_facturacion.create({ data });
  return Number(creado.id);
}

async function main() {
  const resultado = await prisma.$transaction(async (tx) => {
    const semana = await tx.semanas_operativas.findFirstOrThrow({ where: { id: semanaId, negocio_id: negocioId } });
    if (semana.estado === 'cerrada') throw new Error('La semana 36 ya está cerrada; no se modifica una semana histórica.');
    const admin = await tx.usuarios.findFirstOrThrow({ where: { id: usuarioId, negocio_id: negocioId }, select: { id: true } });

    // 1) Precio de venta de Bottled Water y líneas históricas de esta semana.
    const agua = await tx.products.findFirstOrThrow({ where: { id: 563n, negocio_id: negocioId } });
    await tx.products.update({ where: { id: agua.id }, data: { precio_venta_fijo: 20.48 } });
    const aguaLineas = await tx.pedido_operativo_lineas.findMany({
      where: { product_id: agua.id, pedido: { negocio_id: negocioId, fecha_entrega: { gte: new Date('2026-08-30T00:00:00Z'), lte: new Date('2026-09-05T00:00:00Z') }, estado: 'entregado' } },
      select: { id: true, precio_unitario: true },
    });
    const aguaActualizadas = aguaLineas.filter((l) => Number(l.precio_unitario ?? 0) === 0).map((l) => l.id);
    if (aguaActualizadas.length) await tx.pedido_operativo_lineas.updateMany({ where: { id: { in: aguaActualizadas } }, data: { precio_unitario: 20.48 } });

    // 2) Ajustes por ubicación para que la carne facturada sea exactamente la del Excel.
    const ubicaciones = await tx.ubicaciones.findMany({ where: { negocio_id: negocioId, codigo: { in: Object.keys(fuente) }, activo: true }, select: { id: true, codigo: true, empresa_cliente_id: true } });
    const ajustes: Array<Record<string, unknown>> = [];
    for (const ubicacion of ubicaciones) {
      const objetivo = fuente[ubicacion.codigo];
      if (!objetivo || !ubicacion.empresa_cliente_id || objetivo.unidades <= 0) continue;
      const lineas = await tx.pedido_operativo_lineas.findMany({
        where: { pedido: { negocio_id: negocioId, ubicacion_id: ubicacion.id, fecha_entrega: { gte: semana.inicia_at, lte: semana.termina_at }, estado: 'entregado' }, producto: { linea_operacion: 'carne' } },
        select: { cantidad: true, precio_unitario: true, product_id: true },
      });
      const actual = r2(lineas.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario ?? 0), 0));
      let delta = r2(objetivo.carne - actual);
      // TGE contiene exactamente las cinco unidades que el Excel no reconoce.
      // Se separan como crédito de cantidad y como ajuste tarifario residual.
      if (ubicacion.codigo === 'TGE') {
        const chileExtra = r2(lineas.filter((l) => l.product_id === 80n).reduce((s, l) => s + Number(l.cantidad), 0) - 2);
        const tacoExtra = r2(lineas.filter((l) => l.product_id === 75n).reduce((s, l) => s + Number(l.cantidad), 0) - 14);
        const creditoCantidad = r2(Math.max(0, chileExtra) * 91 + Math.max(0, tacoExtra) * 124.1846);
        if (creditoCantidad > 0) {
          await ajusteUnaVez(tx, {
            negocio_id: negocioId, semana_id: semanaId, empresa_cliente_id: ubicacion.empresa_cliente_id,
            ubicacion_id: ubicacion.id, linea_operacion: 'carne', tipo: 'credito', monto: creditoCantidad,
            descripcion: 'Corrección Billing (36): 5 unidades duplicadas en Tapatíos Glen Ellyn (1 Chile Relleno + 4 Tapatíos Taco Meat).',
            creado_por: admin.id, idempotency_key: 'billing36-correccion-cantidad-tge',
          });
          delta = r2(delta + creditoCantidad);
          ajustes.push({ ubicacion: ubicacion.codigo, tipo: 'cantidad', monto: -creditoCantidad, unidades: chileExtra + tacoExtra });
        }
      }
      if (Math.abs(delta) >= 0.01) {
        const tipo = delta < 0 ? 'credito' : 'cargo_excel';
        await ajusteUnaVez(tx, {
          negocio_id: negocioId, semana_id: semanaId, empresa_cliente_id: ubicacion.empresa_cliente_id,
          ubicacion_id: ubicacion.id, linea_operacion: 'carne', tipo, monto: Math.abs(delta),
          descripcion: `Conciliación de tarifa Billing (36) contra Excel para ${ubicacion.codigo}.`,
          creado_por: admin.id, idempotency_key: `billing36-tarifa-${ubicacion.codigo}`,
        });
        ajustes.push({ ubicacion: ubicacion.codigo, tipo: 'tarifa', monto: delta });
      }
      const markup = r2(objetivo.unidades * 10);
      await ajusteUnaVez(tx, {
        negocio_id: negocioId, semana_id: semanaId, empresa_cliente_id: ubicacion.empresa_cliente_id,
        ubicacion_id: ubicacion.id, linea_operacion: 'carne', tipo: 'markup', monto: markup,
        descripcion: 'Markup Billing (36) — componente separado del costo de carne ($10 por unidad).',
        creado_por: admin.id, idempotency_key: `billing36-markup-${ubicacion.codigo}`,
      });
    }
    // La suma de importes redondeados por sucursal queda a un centavo del total
    // del workbook. Se conserva como ajuste explícito de redondeo, nunca oculto.
    const lombard = ubicaciones.find((u) => u.codigo === 'LOMBA');
    if (lombard?.empresa_cliente_id) {
      await ajusteUnaVez(tx, {
        negocio_id: negocioId, semana_id: semanaId, empresa_cliente_id: lombard.empresa_cliente_id,
        ubicacion_id: lombard.id, linea_operacion: 'carne', tipo: 'cargo_excel', monto: 0.01,
        descripcion: 'Ajuste de redondeo agregado para igualar total Carne de Billing (36).',
        creado_por: admin.id, idempotency_key: 'billing36-redondeo-carne-01',
      });
    }

    // 3) Normaliza nombres de proveedores para que CxP sea comparable con Excel.
    const nombres: Record<string, string> = { 'Christ Panos': 'Christ Panos Food', Gordon: 'Gordon Food', 'South Star Foods': 'South Star' };
    const proveedores: Array<Record<string, unknown>> = [];
    for (const [anterior, nuevo] of Object.entries(nombres)) {
      const p = await tx.proveedores.findFirst({ where: { negocio_id: negocioId, nombre: anterior } });
      if (!p) continue;
      await tx.proveedores.update({ where: { id: p.id }, data: { nombre: nuevo } });
      proveedores.push({ id: Number(p.id), anterior, nuevo });
    }
    const incidencia = await tx.incidencias.findFirst({ where: { negocio_id: negocioId, tipo: 'reconciliacion_excel_proveedores', documento_tipo: 'semana', documento_id: semanaId, estado: 'abierta' }, select: { id: true } });
    if (!incidencia) await tx.incidencias.create({
      data: { negocio_id: negocioId, tipo: 'reconciliacion_excel_proveedores', prioridad: 'media', documento_tipo: 'semana', documento_id: semanaId, responsable_id: admin.id, comentarios: 'Excel Billing (36): CxP abierto $127,752.07. Producción: $126,627.09. Residual $1,124.98: Gordon +$1,151.27 y Sysco con estatus pagado ($2,277.25) mientras Excel conserva $2,276.25 abierto. No se alteran pagos sin comprobante.' },
    });

    // 4) Periodo de comparación explícito: no cambia la semana operativa domingo-sábado.
    const auditoria = await tx.auditoria_operativa.create({
      data: { negocio_id: negocioId, usuario_id: admin.id, accion: 'conciliacion_semana_36_con_billing_excel', entidad: 'semana_operativa', entidad_id: semanaId, datos: {
        fuente: '4. Billing 2026 3Q-21.xlsx / Billing (36)', excel_periodo: { desde: '2026-08-31', hasta: '2026-09-06' },
        produccion_periodo: { desde: '2026-08-30', hasta: '2026-09-05' }, ventana_comparable: { desde: '2026-08-31', hasta: '2026-09-05' },
        bottled_water: { lineas_actualizadas: aguaActualizadas.length, precio_unitario: 20.48 }, ajustes, proveedores,
        markup_excel_total: 6870, residual_paperware: 88.97, snapshot_fisico: 'pendiente_de_conteo_real',
      } },
    });
    return { agua_lineas_actualizadas: aguaActualizadas.length, ajustes, proveedores, auditoria_id: Number(auditoria.id) };
  }, { maxWait: 15000, timeout: 120000 });
  console.log(JSON.stringify(resultado, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
