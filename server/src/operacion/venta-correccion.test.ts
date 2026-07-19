import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { guardarPedido } from './service.js';

describe('corrección de una venta procesada', () => {
  let negocioId: bigint;
  let unidadId: bigint;
  let empresaId: bigint;
  let bodegaId: bigint;
  let sucursalId: bigint;
  let productoId: bigint;
  let usuarioId: bigint;
  let pedidoId: bigint;
  let lineaPedidoId: bigint;
  let distribucionId: bigint;
  let actualizadoAt: string;

  beforeAll(async () => {
    const negocio = await prisma.negocios.create({ data: { nombre: '__vitest corrección venta', reparto_habilitado: true } });
    negocioId = negocio.id;
    const unidad = await prisma.unidades.create({ data: { negocio_id: negocioId, nombre: 'Caja' } });
    unidadId = unidad.id;
    const empresa = await prisma.empresas_clientes.create({
      data: { negocio_id: negocioId, nombre: '__vitest BPM', codigo: 'BPM', tipo: 'interna' },
    });
    empresaId = empresa.id;
    const bodega = await prisma.ubicaciones.create({
      data: { negocio_id: negocioId, nombre: 'Carnicería vitest', codigo: 'CARN-VT', tipo: 'bodega' },
    });
    bodegaId = bodega.id;
    const sucursal = await prisma.ubicaciones.create({
      data: { negocio_id: negocioId, nombre: 'Sucursal vitest', codigo: 'SUC-VT', tipo: 'sucursal', empresa_cliente_id: empresaId },
    });
    sucursalId = sucursal.id;
    const producto = await prisma.products.create({
      data: {
        negocio_id: negocioId,
        nombre: 'Steak vitest',
        sku: 'MEAT-VT',
        unidad_distribucion_id: unidad.id,
        linea_operacion: 'carne',
        tipo_operativo: 'proteina',
        ultimo_costo: 100,
      },
    });
    productoId = producto.id;
    const usuario = await prisma.usuarios.create({
      data: { negocio_id: negocioId, nombre: 'Admin vitest', rol: 'admin', pin_hash: 'x' },
    });
    usuarioId = usuario.id;
    await prisma.semanas_operativas.create({
      data: {
        negocio_id: negocioId,
        anio: 2037,
        semana: 28,
        inicia_at: new Date('2037-07-13T00:00:00.000Z'),
        termina_at: new Date('2037-07-18T00:00:00.000Z'),
      },
    });
    const pedido = await prisma.pedidos_operativos.create({
      data: {
        negocio_id: negocioId,
        empresa_cliente_id: empresaId,
        ubicacion_id: sucursalId,
        linea_operacion: 'carne',
        fecha_entrega: new Date('2037-07-15T00:00:00.000Z'),
        estado: 'despachado',
        capturado_por: usuarioId,
      },
    });
    pedidoId = pedido.id;
    actualizadoAt = pedido.actualizado_at.toISOString();
    const linea = await prisma.pedido_operativo_lineas.create({
      data: { pedido_id: pedidoId, product_id: productoId, cantidad: 10, precio_unitario: 115 },
    });
    lineaPedidoId = linea.id;
    const distribucion = await prisma.distribuciones.create({
      data: {
        negocio_id: negocioId,
        creado_por: usuarioId,
        estado: 'en_transito',
        linea_operacion: 'carne',
        fecha_entrega: new Date('2037-07-15T00:00:00.000Z'),
      },
    });
    distribucionId = distribucion.id;
    await prisma.distribucion_lineas.create({
      data: {
        distribucion_id: distribucionId,
        ubicacion_destino_id: sucursalId,
        product_id: productoId,
        pedido_linea_id: lineaPedidoId,
        cantidad_sugerida: 10,
        cantidad_aprobada: 10,
        cantidad_cargada: 10,
        costo_unitario: 100,
        costo_total: 1000,
      },
    });
    await prisma.existencias.create({
      data: { negocio_id: negocioId, ubicacion_id: bodegaId, product_id: productoId, cantidad_disponible: 20, cantidad_transito: 10, costo_promedio: 100 },
    });
  });

  afterAll(async () => {
    await prisma.auditoria_operativa.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.movimientos_inventario.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.distribucion_lineas.deleteMany({ where: { distribuciones: { negocio_id: negocioId } } });
    await prisma.distribuciones.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.pedido_operativo_lineas.deleteMany({ where: { pedido_id: pedidoId } });
    await prisma.pedidos_operativos.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.existencias.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.lotes_materia_prima.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.semanas_operativas.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.products.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.usuarios.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.ubicaciones.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.empresas_clientes.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.unidades.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.negocios.delete({ where: { id: negocioId } });
  });

  it('disminuye y aumenta solo la diferencia sin cambiar el estado ni recrear el despacho', async () => {
    const disminuida = await guardarPedido(negocioId, usuarioId, {
      ubicacion_id: Number(sucursalId),
      linea: 'carne',
      fecha_entrega: '2037-07-15',
      actualizado_at: actualizadoAt,
      lineas: [{ product_id: Number(productoId), cantidad: 7 }],
    }, true);
    expect(disminuida.estado).toBe('despachado');

    let linea = await prisma.distribucion_lineas.findUniqueOrThrow({ where: { pedido_linea_id: lineaPedidoId } });
    let existencia = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: bodegaId, product_id: productoId } },
    });
    expect(Number(linea.cantidad_cargada)).toBe(7);
    expect(Number(linea.cantidad_aprobada)).toBe(7);
    expect(Number(existencia.cantidad_disponible)).toBe(23);
    expect(Number(existencia.cantidad_transito)).toBe(7);

    const aumentada = await guardarPedido(negocioId, usuarioId, {
      ubicacion_id: Number(sucursalId),
      linea: 'carne',
      fecha_entrega: '2037-07-15',
      actualizado_at: disminuida.actualizado_at,
      lineas: [{ product_id: Number(productoId), cantidad: 9 }],
    }, true);
    expect(aumentada.estado).toBe('despachado');
    linea = await prisma.distribucion_lineas.findUniqueOrThrow({ where: { pedido_linea_id: lineaPedidoId } });
    existencia = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: bodegaId, product_id: productoId } },
    });
    expect(Number(linea.cantidad_cargada)).toBe(9);
    expect(Number(existencia.cantidad_disponible)).toBe(21);
    expect(Number(existencia.cantidad_transito)).toBe(9);
    expect(await prisma.distribuciones.count({ where: { negocio_id: negocioId } })).toBe(1);
    expect(await prisma.auditoria_operativa.count({ where: { negocio_id: negocioId, accion: 'corregir_venta_procesada' } })).toBe(2);
  });

  it('corrige una entrega de desechables y restaura/consume únicamente la diferencia FIFO', async () => {
    const adison = await prisma.ubicaciones.create({
      data: { negocio_id: negocioId, nombre: 'Bodega Adison vitest', codigo: 'ADI-VT', tipo: 'bodega' },
    });
    const producto = await prisma.products.create({
      data: {
        negocio_id: negocioId,
        nombre: 'Vaso vitest',
        sku: 'DISP-VT',
        unidad_distribucion_id: unidadId,
        linea_operacion: 'desechables',
        tipo_operativo: 'desechable',
        ultimo_costo: 10,
        precio_venta_fijo: 12,
      },
    });
    const pedido = await prisma.pedidos_operativos.create({
      data: {
        negocio_id: negocioId,
        empresa_cliente_id: empresaId,
        ubicacion_id: sucursalId,
        linea_operacion: 'desechables',
        fecha_entrega: new Date('2037-07-15T00:00:00.000Z'),
        estado: 'entregado',
        capturado_por: usuarioId,
      },
    });
    const lineaPedido = await prisma.pedido_operativo_lineas.create({
      data: { pedido_id: pedido.id, product_id: producto.id, cantidad: 10, precio_unitario: 12 },
    });
    const distribucion = await prisma.distribuciones.create({
      data: {
        negocio_id: negocioId,
        creado_por: usuarioId,
        estado: 'cerrada',
        linea_operacion: 'desechables',
        fecha_entrega: new Date('2037-07-15T00:00:00.000Z'),
      },
    });
    const lineaDistribucion = await prisma.distribucion_lineas.create({
      data: {
        distribucion_id: distribucion.id,
        ubicacion_destino_id: sucursalId,
        product_id: producto.id,
        pedido_linea_id: lineaPedido.id,
        cantidad_sugerida: 10,
        cantidad_aprobada: 10,
        cantidad_cargada: 10,
        cantidad_recibida: 10,
        costo_unitario: 10,
        costo_total: 100,
      },
    });
    const lote = await prisma.lotes_materia_prima.create({
      data: {
        negocio_id: negocioId,
        ubicacion_id: adison.id,
        product_id: producto.id,
        fecha: new Date('2037-07-13T00:00:00.000Z'),
        cajas_iniciales: 20,
        cajas_disponibles: 10,
        peso_inicial_lb: 0,
        peso_disponible_lb: 0,
        costo_inicial: 200,
        costo_disponible: 100,
      },
    });
    await prisma.existencias.createMany({
      data: [
        { negocio_id: negocioId, ubicacion_id: adison.id, product_id: producto.id, cantidad_disponible: 10, costo_promedio: 10 },
        { negocio_id: negocioId, ubicacion_id: sucursalId, product_id: producto.id, cantidad_disponible: 10, costo_promedio: 10 },
      ],
    });
    const movimiento = await prisma.movimientos_inventario.create({
      data: {
        negocio_id: negocioId,
        product_id: producto.id,
        ubicacion_origen_id: adison.id,
        ubicacion_destino_id: sucursalId,
        tipo: 'transferencia',
        cantidad: 10,
        costo_unitario: 10,
        costo_total: 100,
        documento_tipo: 'distribucion',
        documento_id: distribucion.id,
        usuario_id: usuarioId,
        idempotency_key: `carga:${lineaDistribucion.id}`,
      },
    });
    await prisma.consumos_lote_inventario.create({
      data: { movimiento_id: movimiento.id, lote_id: lote.id, cajas: 10, peso_lb: 0, costo: 100 },
    });

    const disminuida = await guardarPedido(negocioId, usuarioId, {
      ubicacion_id: Number(sucursalId),
      linea: 'desechables',
      fecha_entrega: '2037-07-15',
      actualizado_at: pedido.actualizado_at.toISOString(),
      lineas: [{ product_id: Number(producto.id), cantidad: 7 }],
    }, true);
    let loteActual = await prisma.lotes_materia_prima.findUniqueOrThrow({ where: { id: lote.id } });
    let origen = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: adison.id, product_id: producto.id } },
    });
    let destino = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: sucursalId, product_id: producto.id } },
    });
    expect(Number(loteActual.cajas_disponibles)).toBe(13);
    expect(Number(origen.cantidad_disponible)).toBe(13);
    expect(Number(destino.cantidad_disponible)).toBe(7);

    await guardarPedido(negocioId, usuarioId, {
      ubicacion_id: Number(sucursalId),
      linea: 'desechables',
      fecha_entrega: '2037-07-15',
      actualizado_at: disminuida.actualizado_at,
      lineas: [{ product_id: Number(producto.id), cantidad: 9 }],
    }, true);
    loteActual = await prisma.lotes_materia_prima.findUniqueOrThrow({ where: { id: lote.id } });
    origen = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: adison.id, product_id: producto.id } },
    });
    destino = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: sucursalId, product_id: producto.id } },
    });
    expect(Number(loteActual.cajas_disponibles)).toBe(11);
    expect(Number(origen.cantidad_disponible)).toBe(11);
    expect(Number(destino.cantidad_disponible)).toBe(9);
    const actualizada = await prisma.distribucion_lineas.findUniqueOrThrow({ where: { id: lineaDistribucion.id } });
    expect(Number(actualizada.cantidad_recibida)).toBe(9);
  });
});
