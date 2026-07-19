import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { aplicarMovimiento } from './service.js';

// Integración contra la base de datos de desarrollo (server/.env → localhost:55432). Crea su
// propio negocio de prueba y lo borra al final; las pruebas corren en secuencia porque cada
// una parte del saldo que dejó la anterior, igual que una captura real de bodega.
describe('ledger: aplicarMovimiento', () => {
  let negocioId: bigint;
  let ubicacionId: bigint;
  let productId: bigint;
  let usuarioId: bigint;

  beforeAll(async () => {
    const negocio = await prisma.negocios.create({ data: { nombre: '__vitest ledger' } });
    negocioId = negocio.id;
    const unidad = await prisma.unidades.create({ data: { negocio_id: negocioId, nombre: 'Caja' } });
    const ubicacion = await prisma.ubicaciones.create({ data: { negocio_id: negocioId, nombre: 'Bodega vitest', codigo: 'VTS', tipo: 'bodega' } });
    ubicacionId = ubicacion.id;
    const producto = await prisma.products.create({
      data: { negocio_id: negocioId, nombre: 'Producto vitest', sku: 'VTS-1', unidad_distribucion_id: unidad.id },
    });
    productId = producto.id;
    const usuario = await prisma.usuarios.create({ data: { negocio_id: negocioId, nombre: 'Vitest', pin_hash: 'x' } });
    usuarioId = usuario.id;
  });

  afterAll(async () => {
    await prisma.movimientos_inventario.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.existencias.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.products.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.unidades.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.usuarios.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.ubicaciones.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.negocios.delete({ where: { id: negocioId } });
  });

  it('crea la existencia con el costo unitario de la primera entrada', async () => {
    await prisma.$transaction(async (tx) => {
      const aplicada = await aplicarMovimiento(tx, {
        negocioId, productId, tipo: 'compra_recibida', cantidad: 10, usuarioId,
        destinoId: ubicacionId, costoUnitario: 5, documentoTipo: 'test', idempotencyKey: 'vitest:entrada:1',
        deltas: [{ ubicacionId, productId, disponible: 10, costoUnitario: 5 }],
      });
      expect(aplicada).toBe(true);
    });
    const ex = await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } } });
    expect(Number(ex.cantidad_disponible)).toBe(10);
    expect(Number(ex.costo_promedio)).toBe(5);
  });

  it('recalcula el costo promedio ponderado en una segunda entrada a otro costo', async () => {
    await prisma.$transaction(async (tx) => {
      await aplicarMovimiento(tx, {
        negocioId, productId, tipo: 'compra_recibida', cantidad: 10, usuarioId,
        destinoId: ubicacionId, costoUnitario: 7, documentoTipo: 'test', idempotencyKey: 'vitest:entrada:2',
        deltas: [{ ubicacionId, productId, disponible: 10, costoUnitario: 7 }],
      });
    });
    const ex = await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } } });
    // (10 unidades a 5 + 10 unidades a 7) / 20 = 6
    expect(Number(ex.cantidad_disponible)).toBe(20);
    expect(Number(ex.costo_promedio)).toBe(6);
  });

  it('rechaza una salida que dejaría el disponible negativo sin autorización', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await aplicarMovimiento(tx, {
          negocioId, productId, tipo: 'consumo', cantidad: 999, usuarioId,
          origenId: ubicacionId, documentoTipo: 'test', idempotencyKey: 'vitest:salida-invalida',
          deltas: [{ ubicacionId, productId, disponible: -999 }],
        });
      }),
    ).rejects.toThrow(HttpError);

    // La transacción debe haber revertido: el saldo sigue en 20, no en -979.
    const ex = await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } } });
    expect(Number(ex.cantidad_disponible)).toBe(20);
  });

  it('permite saldo provisional negativo cuando se autoriza explícitamente', async () => {
    await prisma.$transaction(async (tx) => {
      await aplicarMovimiento(tx, {
        negocioId, productId, tipo: 'consumo', cantidad: 25, usuarioId,
        origenId: ubicacionId, documentoTipo: 'test', idempotencyKey: 'vitest:salida-provisional',
        permitirDisponibleNegativo: true,
        deltas: [{ ubicacionId, productId, disponible: -25 }],
      });
    });
    const ex = await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } } });
    expect(Number(ex.cantidad_disponible)).toBe(-5); // 20 - 25
  });

  it('es idempotente: repetir la misma idempotency_key no vuelve a aplicar el movimiento', async () => {
    // El saldo viene negativo (-5) de la prueba anterior; se permite explícitamente para
    // aislar lo que esta prueba verifica: que repetir la key no vuelve a aplicar el delta.
    const params = {
      negocioId, productId, tipo: 'compra_recibida' as const, cantidad: 3, usuarioId,
      destinoId: ubicacionId, costoUnitario: 9, documentoTipo: 'test', idempotencyKey: 'vitest:repetido',
      permitirDisponibleNegativo: true,
      deltas: [{ ubicacionId, productId, disponible: 3, costoUnitario: 9 }],
    };
    await prisma.$transaction(async (tx) => {
      expect(await aplicarMovimiento(tx, params)).toBe(true);
    });
    const antes = await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } } });

    await prisma.$transaction(async (tx) => {
      expect(await aplicarMovimiento(tx, params)).toBe(false);
    });
    const despues = await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } } });
    expect(Number(despues.cantidad_disponible)).toBe(Number(antes.cantidad_disponible));

    const movimientos = await prisma.movimientos_inventario.count({ where: { idempotency_key: 'vitest:repetido' } });
    expect(movimientos).toBe(1);
  });
});
