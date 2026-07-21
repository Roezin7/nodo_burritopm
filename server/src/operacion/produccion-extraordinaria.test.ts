import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { eliminarProduccionExtraordinaria, registrarProduccionExtraordinaria } from './service.js';

describe('producción extraordinaria', () => {
  let negocioId: bigint;
  let ubicacionId: bigint;
  let productId: bigint;
  let usuarioId: bigint;
  const llave = `vitest:produccion-extraordinaria:${randomUUID()}`;

  beforeAll(async () => {
    const negocio = await prisma.negocios.create({ data: { nombre: `__vitest extraordinaria ${randomUUID()}` } });
    negocioId = negocio.id;
    const unidad = await prisma.unidades.create({ data: { negocio_id: negocioId, nombre: 'Caja' } });
    const ubicacion = await prisma.ubicaciones.create({
      data: { negocio_id: negocioId, nombre: 'Carnicería vitest', codigo: 'CARN', tipo: 'bodega' },
    });
    ubicacionId = ubicacion.id;
    const producto = await prisma.products.create({
      data: {
        negocio_id: negocioId, nombre: 'Tamal Rojo', sku: 'MEAT-TAMAL', unidad_distribucion_id: unidad.id,
        linea_operacion: 'carne', tipo_operativo: 'precio_fijo', precio_venta_fijo: 90,
      },
    });
    productId = producto.id;
    const usuario = await prisma.usuarios.create({ data: { negocio_id: negocioId, nombre: 'Vitest', pin_hash: 'x', rol: 'admin' } });
    usuarioId = usuario.id;
    await prisma.existencias.create({
      data: { negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: productId, cantidad_disponible: 10, costo_promedio: 12 },
    });
  });

  afterAll(async () => {
    if (!negocioId) return;
    await prisma.movimientos_inventario.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.auditoria_operativa.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.producciones_extraordinarias.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.conteos.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.existencias.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.products.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.unidades.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.usuarios.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.ubicaciones.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.negocios.delete({ where: { id: negocioId } });
  });

  it('ingresa a inventario con costo cero, no duplica y revierte el promedio al eliminar', async () => {
    const input = {
      ubicacion_id: Number(ubicacionId), fecha: '2026-07-25', notas: 'Producción especial vitest',
      idempotency_key: llave, salidas: [{ product_id: Number(productId), cajas: 4 }],
    };

    const primera = await registrarProduccionExtraordinaria(negocioId, usuarioId, input);
    const existencia = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } },
    });
    expect(Number(existencia.cantidad_disponible)).toBe(14);
    expect(Number(existencia.costo_promedio)).toBeCloseTo(120 / 14, 4);

    const movimiento = await prisma.movimientos_inventario.findFirstOrThrow({
      where: { negocio_id: negocioId, documento_tipo: 'produccion_extraordinaria', documento_id: BigInt(primera.id) },
    });
    expect(Number(movimiento.costo_unitario)).toBe(0);
    expect(Number(movimiento.costo_total)).toBe(0);

    const repetida = await registrarProduccionExtraordinaria(negocioId, usuarioId, input);
    expect(repetida.id).toBe(primera.id);
    expect(await prisma.producciones_extraordinarias.count({ where: { negocio_id: negocioId } })).toBe(1);
    const sinDuplicar = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } },
    });
    expect(Number(sinDuplicar.cantidad_disponible)).toBe(14);

    await eliminarProduccionExtraordinaria(negocioId, BigInt(primera.id), usuarioId);
    const restaurada = await prisma.existencias.findUniqueOrThrow({
      where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } },
    });
    expect(Number(restaurada.cantidad_disponible)).toBe(10);
    expect(Number(restaurada.costo_promedio)).toBe(12);
    expect(await prisma.movimientos_inventario.count({ where: { negocio_id: negocioId, documento_tipo: 'produccion_extraordinaria' } })).toBe(0);
    expect(await prisma.auditoria_operativa.count({ where: { negocio_id: negocioId, entidad: 'produccion_extraordinaria' } })).toBe(1);
  });
});
