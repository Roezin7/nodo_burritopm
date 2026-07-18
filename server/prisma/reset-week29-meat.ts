import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.env.APPLY_WEEK29_RESET === '1';
const KEY = 'operacion-2026-semana-29-reinicio-carne-v1';
const inicio = new Date('2026-07-13T00:00:00.000Z');
const fin = new Date('2026-07-18T00:00:00.000Z');

const apertura = new Map<string, { cantidad: number; peso?: number; costo?: number }>([
  ['MEAT-PASTOR-BPM', { cantidad: 14, costo: 59.4189 }],
  ['MEAT-MILANESA', { cantidad: 8, costo: 142.25 }],
  ['MEAT-CHILE', { cantidad: 8, costo: 87 }],
  ['MEAT-DORADO', { cantidad: 39, costo: 87 }],
  ['RAW-INSIDE-SKIRT', { cantidad: 25, peso: 1873, costo: 15134.5 }],
  ['RAW-OUTSIDE-SKIRT', { cantidad: 26, peso: 1691.43, costo: 16423.78 }],
  ['RAW-INSIDE-ROUND', { cantidad: 20, peso: 1451, costo: 6993.82 }],
  ['RAW-TAPATIOS-TACO', { cantidad: 9, peso: 531, costo: 2918.07 }],
]);

async function main() {
  if (!APPLY) return console.log('Reinicio de carne semana 29 en vista previa; usa APPLY_WEEK29_RESET=1 para aplicarlo.');
  const negocio = await prisma.negocios.findFirstOrThrow({ where: { nombre: 'Burrito Parrilla Mexicana' } });
  if (await prisma.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: KEY } } })) {
    return console.log(`✅ ${KEY} ya aplicado; no se volvió a modificar la semana.`);
  }
  const [admin, carniceria, productos] = await Promise.all([
    prisma.usuarios.findFirstOrThrow({ where: { negocio_id: negocio.id, rol: 'admin', activo: true }, orderBy: { id: 'asc' } }),
    prisma.ubicaciones.findFirstOrThrow({ where: { negocio_id: negocio.id, codigo: 'CARN' } }),
    prisma.products.findMany({ where: { negocio_id: negocio.id, linea_operacion: 'carne', activo: true } }),
  ]);
  const porSku = new Map(productos.map((p) => [p.sku, p]));
  const faltantes = [...apertura.keys()].filter((sku) => !porSku.has(sku));
  if (faltantes.length) throw new Error(`Faltan productos para reiniciar semana 29: ${faltantes.join(', ')}`);

  const resultado = await prisma.$transaction(async (tx) => {
    if (await tx.importaciones_sistema.findUnique({ where: { negocio_id_clave: { negocio_id: negocio.id, clave: KEY } } })) {
      return { omitido: true, pedidos: 0, distribuciones: 0, compras: 0, producciones: 0 };
    }

    const semana = await tx.semanas_operativas.upsert({
      where: { negocio_id_anio_semana: { negocio_id: negocio.id, anio: 2026, semana: 29 } },
      update: { inicia_at: inicio, termina_at: fin, estado: 'reabierta', cerrado_at: null, cerrado_por: null },
      create: { negocio_id: negocio.id, anio: 2026, semana: 29, inicia_at: inicio, termina_at: fin, estado: 'reabierta' },
    });

    const facturas = await tx.facturas.findMany({
      where: { semana_id: semana.id, linea_operacion: 'carne' },
      include: { pagos: { select: { id: true } } },
    });
    if (facturas.some((f) => f.pagos.length)) throw new Error('No se reinició semana 29 porque existen facturas de carne con pagos registrados.');
    if (facturas.length) {
      await tx.facturas.updateMany({ where: { reemplaza_factura_id: { in: facturas.map((f) => f.id) } }, data: { reemplaza_factura_id: null } });
      await tx.facturas.deleteMany({ where: { id: { in: facturas.map((f) => f.id) } } });
    }

    const distribuciones = await tx.distribuciones.findMany({
      where: { negocio_id: negocio.id, linea_operacion: 'carne', fecha_entrega: { gte: inicio, lte: fin } },
      include: { lineas: true },
    });
    const distribucionIds = distribuciones.map((d) => d.id);
    const lineasDistribucion = distribuciones.flatMap((d) => d.lineas);
    for (const linea of lineasDistribucion) {
      const recibida = Number(linea.cantidad_recibida ?? 0);
      if (recibida <= 0) continue;
      const existencia = await tx.existencias.findUnique({
        where: { ubicacion_id_product_id: { ubicacion_id: linea.ubicacion_destino_id, product_id: linea.product_id } },
      });
      if (existencia) await tx.existencias.update({
        where: { ubicacion_id_product_id: { ubicacion_id: linea.ubicacion_destino_id, product_id: linea.product_id } },
        data: { cantidad_disponible: Number(existencia.cantidad_disponible) - recibida },
      });
    }
    if (distribucionIds.length) {
      await tx.incidencias.deleteMany({
        where: {
          negocio_id: negocio.id,
          OR: [
            { documento_tipo: 'distribucion', documento_id: { in: distribucionIds } },
            { distribucion_linea_id: { in: lineasDistribucion.map((l) => l.id) } },
          ],
        },
      });
      await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, documento_tipo: 'distribucion', documento_id: { in: distribucionIds } } });
      await tx.distribuciones.deleteMany({ where: { id: { in: distribucionIds } } });
    }

    const pedidos = await tx.pedidos_operativos.findMany({
      where: { negocio_id: negocio.id, linea_operacion: 'carne', fecha_entrega: { gte: inicio, lte: fin } },
      select: { id: true },
    });
    if (pedidos.length) await tx.pedidos_operativos.deleteMany({ where: { id: { in: pedidos.map((p) => p.id) } } });

    const conteos = await tx.conteos.findMany({
      where: {
        negocio_id: negocio.id, ubicacion_id: carniceria.id, fecha: { gte: inicio, lte: fin },
        OR: [{ notas: { startsWith: 'inventario_inicial_operativo' } }, { notas: { startsWith: 'inventario_final_operativo' } }],
      },
      select: { id: true },
    });
    if (conteos.length) {
      await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, documento_tipo: 'conteo', documento_id: { in: conteos.map((c) => c.id) } } });
      await tx.conteos.deleteMany({ where: { id: { in: conteos.map((c) => c.id) } } });
    }

    const producciones = await tx.producciones.findMany({
      where: { negocio_id: negocio.id, ubicacion_id: carniceria.id, fecha: { gte: inicio, lte: fin } }, select: { id: true },
    });
    if (producciones.length) {
      await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, documento_tipo: 'produccion', documento_id: { in: producciones.map((p) => p.id) } } });
      await tx.producciones.deleteMany({ where: { id: { in: producciones.map((p) => p.id) } } });
    }

    const compras = await tx.compras.findMany({
      where: { negocio_id: negocio.id, ubicacion_id: carniceria.id, fecha: { gte: inicio, lte: fin } },
      include: { lineas: { select: { id: true } } },
    });
    if (compras.length) {
      const lineaCompraIds = compras.flatMap((c) => c.lineas.map((l) => l.id));
      await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocio.id, documento_tipo: 'compra', documento_id: { in: compras.map((c) => c.id) } } });
      if (lineaCompraIds.length) await tx.lotes_materia_prima.deleteMany({ where: { compra_linea_id: { in: lineaCompraIds } } });
      await tx.compras.deleteMany({ where: { id: { in: compras.map((c) => c.id) } } });
    }

    // Conserva lotes históricos como evidencia, pero elimina cualquier saldo disponible.
    await tx.lotes_materia_prima.updateMany({
      where: { negocio_id: negocio.id, ubicacion_id: carniceria.id },
      data: { cajas_disponibles: 0, peso_disponible_lb: 0, costo_disponible: 0 },
    });
    for (const [sku, valor] of apertura) {
      if (!sku.startsWith('RAW-')) continue;
      const producto = porSku.get(sku)!;
      await tx.lotes_materia_prima.create({
        data: {
          negocio_id: negocio.id, ubicacion_id: carniceria.id, product_id: producto.id, fecha: new Date('2026-07-11T00:00:00.000Z'),
          congelado: false, cajas_iniciales: valor.cantidad, cajas_disponibles: valor.cantidad,
          peso_inicial_lb: valor.peso!, peso_disponible_lb: valor.peso!, costo_inicial: valor.costo!, costo_disponible: valor.costo!,
        },
      });
    }

    for (const producto of productos) {
      const valor = apertura.get(producto.sku);
      const cantidad = valor?.cantidad ?? 0;
      const costoCaja = valor?.costo == null ? undefined : (valor.peso == null ? valor.costo : valor.costo / valor.cantidad);
      const anterior = await tx.existencias.findUnique({
        where: { ubicacion_id_product_id: { ubicacion_id: carniceria.id, product_id: producto.id } },
      });
      await tx.existencias.upsert({
        where: { ubicacion_id_product_id: { ubicacion_id: carniceria.id, product_id: producto.id } },
        create: { negocio_id: negocio.id, ubicacion_id: carniceria.id, product_id: producto.id, cantidad_disponible: cantidad, costo_promedio: costoCaja },
        update: { cantidad_disponible: cantidad, cantidad_reservada: 0, cantidad_transito: 0, costo_promedio: costoCaja ?? anterior?.costo_promedio },
      });
      const delta = cantidad - Number(anterior?.cantidad_disponible ?? 0);
      if (Math.abs(delta) > 0.0001) await tx.movimientos_inventario.create({
        data: {
          negocio_id: negocio.id, product_id: producto.id, tipo: 'correccion', cantidad: Math.abs(delta),
          costo_unitario: costoCaja ?? anterior?.costo_promedio, costo_total: costoCaja == null ? null : Math.abs(delta) * costoCaja,
          ubicacion_origen_id: delta < 0 ? carniceria.id : null, ubicacion_destino_id: delta > 0 ? carniceria.id : null,
          usuario_id: admin.id, fecha: inicio, documento_tipo: 'reinicio_semana', documento_id: semana.id,
          comentario: 'Reinicio autorizado de inventario inicial de carne · semana 29',
          idempotency_key: `reinicio-carne-semana-29:${producto.id}`,
        },
      });
    }

    const inventarioInicial = await tx.conteos.create({
      data: {
        negocio_id: negocio.id, ubicacion_id: carniceria.id, fecha: inicio, estado: 'cerrado', creado_por: admin.id,
        cerrado_por: admin.id, cerrado_at: new Date(), notas: 'inventario_inicial_operativo:2026-07-13:reinicio-autorizado-v1',
      },
    });
    await tx.conteo_lineas.createMany({
      data: productos.map((p) => ({
        conteo_id: inventarioInicial.id, product_id: p.id, unidad_id: p.unidad_distribucion_id,
        qty: apertura.get(p.sku)?.cantidad ?? 0, factor: 1, contado: true,
      })),
    });
    await tx.importaciones_sistema.create({ data: { negocio_id: negocio.id, clave: KEY } });
    return { omitido: false, pedidos: pedidos.length, distribuciones: distribuciones.length, compras: compras.length, producciones: producciones.length };
  }, { isolationLevel: 'Serializable', timeout: 30000 });

  console.log(`✅ Semana 29 reiniciada: ${resultado.pedidos} ventas, ${resultado.distribuciones} preparaciones, ${resultado.compras} compras y ${resultado.producciones} producciones de carne eliminadas.`);
  console.log('   Apertura fijada: Pastor BPM 14, Milanesa 8, Chile Relleno 8, Taco Dorado 39, Inside Skirt 25, Outside Skirt 26, Inside Round 20, Tapatíos Taco Meat raw 9.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
