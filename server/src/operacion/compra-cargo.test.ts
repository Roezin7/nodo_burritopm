import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { editarCompra, eliminarCompra, registrarCompra } from './service.js';

describe('compras con cargo contable', () => {
  let negocioId: bigint;
  let usuarioId: bigint;
  let proveedorId: bigint;
  let bodegaId: bigint;
  let inventariableId: bigint;
  let cargoId: bigint;

  beforeAll(async () => {
    const negocio = await prisma.negocios.create({ data: { nombre: '__vitest cargo compra' } });
    negocioId = negocio.id;
    const unidad = await prisma.unidades.create({ data: { negocio_id: negocioId, nombre: 'Caja' } });
    const bodega = await prisma.ubicaciones.create({ data: { negocio_id: negocioId, nombre: 'Bodega Adison', codigo: 'BOD', tipo: 'bodega' } });
    bodegaId = bodega.id;
    proveedorId = (await prisma.proveedores.create({ data: { negocio_id: negocioId, nombre: 'Proveedor vitest' } })).id;
    usuarioId = (await prisma.usuarios.create({ data: { negocio_id: negocioId, nombre: 'Admin vitest', rol: 'admin', pin_hash: 'x' } })).id;
    inventariableId = (await prisma.products.create({
      data: {
        negocio_id: negocioId, nombre: 'Desechable vitest', sku: 'DES-VT', unidad_distribucion_id: unidad.id,
        linea_operacion: 'desechables', tipo_operativo: 'desechable',
      },
    })).id;
    cargoId = (await prisma.products.create({
      data: {
        negocio_id: negocioId, nombre: 'Grocery and Disposables', sku: 'EXP-VT', unidad_distribucion_id: unidad.id,
        linea_operacion: 'carne', tipo_operativo: 'servicio', es_cargo_compra: true, administrado_bodega: false,
      },
    })).id;
  });

  afterAll(async () => {
    await prisma.movimientos_inventario.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.lotes_materia_prima.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.compras.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.existencias.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.auditoria_operativa.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.products.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.proveedores.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.usuarios.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.ubicaciones.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.unidades.deleteMany({ where: { negocio_id: negocioId } });
    await prisma.negocios.delete({ where: { id: negocioId } });
  });

  it('suma el cargo a CxP sin crear inventario ni contaminar el costo', async () => {
    const creada = await registrarCompra(negocioId, usuarioId, {
      proveedor_id: Number(proveedorId), ubicacion_id: Number(bodegaId), fecha: '2039-07-20', referencia: 'VT-1',
      lineas: [
        { product_id: Number(inventariableId), cajas: 2, costo_total: 100 },
        { product_id: Number(cargoId), cajas: 1, costo_total: 50 },
      ],
    });
    expect(creada.total).toBe(150);

    const compra = await prisma.compras.findUniqueOrThrow({ where: { id: BigInt(creada.id) }, include: { lineas: true } });
    expect(Number(compra.total)).toBe(150);
    expect(compra.lineas).toHaveLength(2);
    expect(await prisma.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: bodegaId, product_id: cargoId } } })).toBeNull();
    expect(await prisma.lotes_materia_prima.count({ where: { negocio_id: negocioId, product_id: cargoId } })).toBe(0);
    expect(await prisma.movimientos_inventario.count({ where: { negocio_id: negocioId, product_id: cargoId } })).toBe(0);
    expect((await prisma.products.findUniqueOrThrow({ where: { id: cargoId } })).ultimo_costo).toBeNull();
    expect(Number((await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: bodegaId, product_id: inventariableId } } })).cantidad_disponible)).toBe(2);

    const editada = await editarCompra(negocioId, BigInt(creada.id), usuarioId, {
      proveedor_id: Number(proveedorId), ubicacion_id: Number(bodegaId), fecha: '2039-07-20', referencia: 'VT-1 corregida',
      lineas: [
        { product_id: Number(cargoId), cajas: 1, costo_total: 70 },
        { product_id: Number(inventariableId), cajas: 3, costo_total: 180 },
      ],
    });
    expect(editada.total).toBe(250);
    expect(Number((await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: bodegaId, product_id: inventariableId } } })).cantidad_disponible)).toBe(3);
    expect(await prisma.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: bodegaId, product_id: cargoId } } })).toBeNull();

    await eliminarCompra(negocioId, BigInt(creada.id), usuarioId);
    expect(await prisma.compras.findUnique({ where: { id: BigInt(creada.id) } })).toBeNull();
    expect(Number((await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: bodegaId, product_id: inventariableId } } })).cantidad_disponible)).toBe(0);
    expect(await prisma.movimientos_inventario.count({ where: { negocio_id: negocioId, product_id: cargoId } })).toBe(0);
  });
});
