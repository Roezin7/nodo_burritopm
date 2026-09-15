import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { guardarInventarioFinal, registrarCompra, registrarProduccion, editarProduccion, eliminarProduccion } from './service.js';
import { obtenerConciliacionAlmacen } from '../inventario/conciliacion-semanal.js';
import { eliminarConteo, reabrirConteo } from '../conteos/service.js';

describe('captura física y herencia con lotes reales', () => {
  let negocio: bigint; let usuario: bigint; let almacen: bigint; let raw: bigint; let terminado: bigint; let proveedor: bigint;
  beforeAll(async () => {
    const n = await prisma.negocios.create({ data: { nombre: `__vitest herencia ${randomUUID()}` } }); negocio = n.id;
    const u = await prisma.usuarios.create({ data: { negocio_id: negocio, nombre: 'Auditor', pin_hash: 'x', rol: 'admin' } }); usuario = u.id;
    const b = await prisma.ubicaciones.create({ data: { negocio_id: negocio, nombre: 'Carnicería', codigo: 'CARN', tipo: 'bodega' } }); almacen = b.id;
    const unidad = await prisma.unidades.create({ data: { negocio_id: negocio, nombre: 'Caja' } });
    const p = await prisma.products.create({ data: { negocio_id: negocio, nombre: 'Taco Meat Raw', sku: 'RAW-TACO', linea_operacion: 'carne', tipo_operativo: 'materia_prima', unidad_distribucion_id: unidad.id, peso_caja_lb: 10, ultimo_costo: 100 } }); raw = p.id;
    const t = await prisma.products.create({ data: { negocio_id: negocio, nombre: 'Taco Meat', sku: 'MEAT-TACO', linea_operacion: 'carne', tipo_operativo: 'proteina', unidad_distribucion_id: unidad.id, peso_caja_lb: 10, ultimo_costo: 100 } }); terminado = t.id;
    await prisma.recetas_produccion.create({ data: { negocio_id: negocio, materia_prima_id: raw, producto_salida_id: terminado } });
    proveedor = (await prisma.proveedores.create({ data: { negocio_id: negocio, nombre: 'Proveedor' } })).id;
    await prisma.existencias.create({ data: { negocio_id: negocio, ubicacion_id: almacen, product_id: raw, cantidad_disponible: 2, costo_promedio: 100 } });
    await prisma.lotes_materia_prima.create({ data: { negocio_id: negocio, ubicacion_id: almacen, product_id: raw, fecha: new Date('2026-09-05'), cajas_iniciales: 2, cajas_disponibles: 2, peso_inicial_lb: 20, peso_disponible_lb: 20, costo_inicial: 200, costo_disponible: 200 } });
    await prisma.conteos.create({ data: { negocio_id: negocio, ubicacion_id: almacen, fecha: new Date('2026-09-05'), tipo_captura: 'cierre', estado: 'cerrado', creado_por: usuario, lineas: { create: [{ product_id: raw, unidad_id: unidad.id, qty: 2, contado: true }, { product_id: terminado, unidad_id: unidad.id, qty: 0, contado: true }] } } });
  });
  afterAll(async () => {
    if (!negocio) return;
    await prisma.auditoria_operativa.deleteMany({ where: { negocio_id: negocio } });
    await prisma.consumos_lote_inventario.deleteMany({ where: { movimiento: { negocio_id: negocio } } });
    await prisma.movimientos_inventario.deleteMany({ where: { negocio_id: negocio } });
    await prisma.produccion_consumos_lote.deleteMany({ where: { produccion: { negocio_id: negocio } } });
    await prisma.produccion_salidas.deleteMany({ where: { produccion: { negocio_id: negocio } } });
    await prisma.producciones.deleteMany({ where: { negocio_id: negocio } });
    await prisma.conteos.deleteMany({ where: { negocio_id: negocio } });
    await prisma.lotes_materia_prima.deleteMany({ where: { negocio_id: negocio } });
    await prisma.compra_lineas.deleteMany({ where: { compra: { negocio_id: negocio } } });
    await prisma.compras.deleteMany({ where: { negocio_id: negocio } });
    await prisma.existencias.deleteMany({ where: { negocio_id: negocio } });
    await prisma.recetas_produccion.deleteMany({ where: { negocio_id: negocio } });
    await prisma.products.deleteMany({ where: { negocio_id: negocio } });
    await prisma.unidades.deleteMany({ where: { negocio_id: negocio } });
    await prisma.proveedores.deleteMany({ where: { negocio_id: negocio } });
    await prisma.usuarios.deleteMany({ where: { negocio_id: negocio } });
    await prisma.ubicaciones.deleteMany({ where: { negocio_id: negocio } });
    await prisma.semanas_operativas.deleteMany({ where: { negocio_id: negocio } });
    await prisma.negocios.delete({ where: { id: negocio } });
  });
  const captura = (tipo: 'apertura' | 'cierre', fecha: string, cantidad: number, cocinado = 0) => guardarInventarioFinal(negocio, usuario, {
    ubicacion_id: Number(almacen), fecha, tipo_captura: tipo,
    lineas: [{ product_id: Number(raw), cantidad }, { product_id: Number(terminado), cantidad: cocinado }],
  });
  const verificar = async (esperado: number) => {
    const ex = await prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: almacen, product_id: raw } } });
    const lotes = await prisma.lotes_materia_prima.aggregate({ where: { ubicacion_id: almacen, product_id: raw }, _sum: { cajas_disponibles: true } });
    expect(Number(ex.cantidad_disponible)).toBe(esperado);
    expect(Number(lotes._sum.cajas_disponibles)).toBe(esperado);
  };

  it('aplica apertura, compra, producción, cierre y correcciones tardías sin duplicar ni perder saldo', async () => {
    await captura('apertura', '2026-09-06', 10);
    await verificar(10);
    await captura('apertura', '2026-09-06', 2);
    await verificar(2);
    const original = await prisma.lotes_materia_prima.findFirstOrThrow({ where: { product_id: raw, fecha: new Date('2026-09-05') } });
    expect(Number(original.cajas_disponibles)).toBe(2);
    await captura('apertura', '2026-09-06', 10);
    await registrarCompra(negocio, usuario, { proveedor_id: Number(proveedor), ubicacion_id: Number(almacen), fecha: '2026-09-07', lineas: [{ product_id: Number(raw), cajas: 10, peso_total_lb: 100, costo_total: 1000 }] });
    await registrarProduccion(negocio, usuario, { ubicacion_id: Number(almacen), materia_prima_id: Number(raw), fecha: '2026-09-12', cajas_materia_prima: 10, salidas: [{ product_id: Number(terminado), cajas: 8 }] });
    await verificar(10);
    const c = await captura('cierre', '2026-09-12', 5, 8);
    await verificar(5);
    const reporte = await obtenerConciliacionAlmacen(negocio, '2026-09-06', '2026-09-12', almacen);
    const fila = reporte.filas.find(f => f.product_id === Number(raw))!;
    expect([fila.inicial, fila.teoricoFinal, fila.fisico_final, fila.diferenciaFinal, fila.saldoOperativoFinal]).toEqual([10, 10, 5, -5, 5]);
    const repetido = await captura('cierre', '2026-09-12', 5, 8);
    expect(repetido.inventario_id).toBe(c.inventario_id);
    expect(repetido.ajustes).toBe(0);
    await verificar(5);
    await registrarCompra(negocio, usuario, { proveedor_id: Number(proveedor), ubicacion_id: Number(almacen), fecha: '2026-09-14', lineas: [{ product_id: Number(raw), cajas: 4, peso_total_lb: 40, costo_total: 400 }] });
    await verificar(9);
    // La apertura automática del día 13 ya existe. Debe heredar 6, no sus 5 guardadas.
    await captura('cierre', '2026-09-12', 6, 8);
    await verificar(10);
    const siguiente = await obtenerConciliacionAlmacen(negocio, '2026-09-13', '2026-09-19', almacen);
    expect(siguiente.filas.find(f => f.product_id === Number(raw))?.inicial).toBe(6);
    expect(siguiente.filas.find(f => f.product_id === Number(raw))?.saldoOperativoFinal).toBe(10);
    // Los lotes de la apertura original ya se consumieron: corregir su referencia
    // mantiene la evidencia y respeta el físico posterior, sin sumar otra vez 2.
    await captura('apertura', '2026-09-06', 12);
    await verificar(10);
    await captura('cierre', '2026-09-12', 0, 8);
    await verificar(4);
    const final = await obtenerConciliacionAlmacen(negocio, '2026-09-06', '2026-09-12', almacen);
    const f = final.filas.find(x => x.product_id === Number(raw))!;
    expect([f.saldoOperativoFinal, f.actual, f.movimientos_posteriores, f.diferencia_ledger]).toEqual([0, 4, 4, 0]);
  });

  it('reasigna los conteos a Taco Meat terminado y deja Raw separado en 2 cajas', async () => {
    await captura('apertura', '2026-09-06', 2, 10);
    await captura('cierre', '2026-09-12', 2, 5);
    const reporte = await obtenerConciliacionAlmacen(negocio, '2026-09-06', '2026-09-12', almacen);
    const r = reporte.filas.find(f => f.product_id === Number(raw))!;
    const t = reporte.filas.find(f => f.product_id === Number(terminado))!;
    expect([r.inicial, r.fisico_final, r.saldoOperativoFinal, r.diferencia_ledger, r.diferencia_fifo]).toEqual([2, 2, 2, 0, 0]);
    expect([t.inicial, t.fisico_final, t.saldoOperativoFinal, t.actual, t.diferencia_ledger]).toEqual([10, 5, 5, 5, 0]);
    expect(t.fifo_disponible).toBeNull();
    const siguiente = await obtenerConciliacionAlmacen(negocio, '2026-09-13', '2026-09-19', almacen);
    expect(siguiente.filas.find(f => f.product_id === Number(terminado))?.inicial).toBe(5);
  });

  it('un físico diario usa la misma herencia y FIFO sin reescribir el cierre anterior', async () => {
    await guardarInventarioFinal(negocio, usuario, { ubicacion_id: Number(almacen), fecha: '2026-09-15', tipo_captura: 'diario',
      lineas: [{ product_id: Number(raw), cantidad: 8 }, { product_id: Number(terminado), cantidad: 5 }] });
    await verificar(8);
    const reporte = await obtenerConciliacionAlmacen(negocio, '2026-09-13', '2026-09-19', almacen);
    const f = reporte.filas.find(f => f.product_id === Number(raw))!;
    expect([f.inicial, f.compras1, f.teoricoFinal, f.fisico_final, f.diferenciaFinal, f.diferencia_fifo, f.diferencia_ledger]).toEqual([2, 4, 6, 8, 2, 0, 0]);
    const anterior = await obtenerConciliacionAlmacen(negocio, '2026-09-06', '2026-09-12', almacen);
    expect(anterior.filas.find(f => f.product_id === Number(raw))?.saldoOperativoFinal).toBe(2);
  });

  it('impide quitar una referencia con físicos posteriores o guardar cantidades negativas', async () => {
    const conteo = await prisma.conteos.findFirstOrThrow({ where: { negocio_id: negocio, fecha: new Date('2026-09-12') } });
    await expect(eliminarConteo(negocio, conteo.id, usuario)).rejects.toThrow('posteriores');
    await expect(reabrirConteo(negocio, conteo.id)).rejects.toThrow('semana operativa');
    await expect(captura('cierre', '2026-09-12', -1)).rejects.toThrow('mayores o iguales a cero');
    await verificar(8);
  });

  it('compra y producción tardías recalculan los físicos posteriores sin cambiar lo contado', async () => {
    await registrarCompra(negocio, usuario, { proveedor_id: Number(proveedor), ubicacion_id: Number(almacen), fecha: '2026-09-08', lineas: [{ product_id: Number(raw), cajas: 3, peso_total_lb: 30, costo_total: 300 }] });
    await verificar(8);
    const input = { ubicacion_id: Number(almacen), materia_prima_id: Number(raw), fecha: '2026-09-12', cajas_materia_prima: 2, salidas: [{ product_id: Number(terminado), cajas: 1 }] };
    const p = await registrarProduccion(negocio, usuario, input);
    await verificar(8);
    const t = () => prisma.existencias.findUniqueOrThrow({ where: { ubicacion_id_product_id: { ubicacion_id: almacen, product_id: terminado } } });
    expect(Number((await t()).cantidad_disponible)).toBe(5);
    await editarProduccion(negocio, BigInt(p.id), usuario, { ...input, salidas: [{ product_id: Number(terminado), cajas: 2 }] });
    await verificar(8);
    expect(Number((await t()).cantidad_disponible)).toBe(5);
    const actual = await prisma.producciones.findFirstOrThrow({ where: { negocio_id: negocio, cajas_materia_prima: 2 } });
    await eliminarProduccion(negocio, actual.id, usuario);
    await verificar(8);
    expect(Number((await t()).cantidad_disponible)).toBe(5);
    const r = await obtenerConciliacionAlmacen(negocio, '2026-09-06', '2026-09-12', almacen);
    expect(r.filas.every(f => Math.abs(f.diferencia_ledger) < 0.001 && Math.abs(f.diferencia_fifo ?? 0) < 0.001)).toBe(true);
    expect(r.filas.find(f => f.product_id === Number(raw))?.fisico_final).toBe(2);
  });

  it('contar tres desechables desde un saldo provisional -2 crea tres cajas FIFO, no cinco', async () => {
    const b = await prisma.ubicaciones.create({ data: { negocio_id: negocio, nombre: 'Bodega Adison', codigo: 'BOD', tipo: 'bodega' } });
    const unidad = (await prisma.products.findUniqueOrThrow({ where: { id: raw } })).unidad_distribucion_id;
    const p = await prisma.products.create({ data: { negocio_id: negocio, nombre: 'Trapos', sku: 'TEST-TRAPOS', linea_operacion: 'desechables', tipo_operativo: 'desechable', unidad_distribucion_id: unidad, ultimo_costo: 1 } });
    await prisma.existencias.create({ data: { negocio_id: negocio, ubicacion_id: b.id, product_id: p.id, cantidad_disponible: -2, costo_promedio: 1 } });
    await guardarInventarioFinal(negocio, usuario, { ubicacion_id: Number(b.id), fecha: '2026-09-12', tipo_captura: 'cierre', lineas: [{ product_id: Number(p.id), cantidad: 3 }] });
    const r = await obtenerConciliacionAlmacen(negocio, '2026-09-06', '2026-09-12', b.id);
    expect([r.filas[0]!.actual, r.filas[0]!.fifo_disponible, r.filas[0]!.diferencia_fifo]).toEqual([3, 3, 0]);
  });
});
