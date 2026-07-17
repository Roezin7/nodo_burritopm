import type { LineaOperacion, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { aplicarMovimiento } from '../ledger/service.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sumarDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86400000);

const salidasPorMateria: Record<string, string[]> = {
  'RAW-INSIDE-SKIRT': ['MEAT-STEAK'],
  'RAW-CHICKEN': ['MEAT-CHICKEN'],
  'RAW-PORK-BUTT': ['MEAT-PASTOR-BPM', 'MEAT-PASTOR-TAP'],
  'RAW-OUTSIDE-SKIRT': ['MEAT-ASADA', 'MEAT-FAJITAS'],
  'RAW-INSIDE-ROUND': ['MEAT-MILANESA'],
  'RAW-TAPATIOS-TACO': ['MEAT-TAPATIOS-TACO'],
};

export function precioVentaProducto(p: {
  tipo_operativo: string | null;
  precio_venta_fijo: Prisma.Decimal | null;
  ultimo_costo: Prisma.Decimal | null;
  costo_promedio: Prisma.Decimal | null;
  markup_caja: Prisma.Decimal;
}): number | null {
  const fijo = num(p.precio_venta_fijo);
  if (fijo != null) return r4(fijo);
  const costo = num(p.ultimo_costo) ?? num(p.costo_promedio);
  if (costo == null) return null;
  return r4(costo + (p.tipo_operativo === 'proteina' ? num0(p.markup_caja) : 0));
}

export async function catalogoOperacion(negocioId: bigint, esAdmin: boolean, ubicacionesPermitidas?: bigint[]) {
  const [empresas, ubicaciones, productos, proveedores, plantillas, semanas] = await Promise.all([
    prisma.empresas_clientes.findMany({
      where: { negocio_id: negocioId, activo: true, id: esAdmin ? undefined : { in: ubicacionesPermitidas ?? [] } },
      orderBy: { nombre: 'asc' },
    }),
    prisma.ubicaciones.findMany({
      where: { negocio_id: negocioId, activo: true },
      include: { empresa_cliente: { select: { id: true, nombre: true, codigo: true } }, entrega_en: { select: { id: true, nombre: true } } },
      orderBy: [{ tipo: 'asc' }, { orden_operativo: 'asc' }, { nombre: 'asc' }],
    }),
    prisma.products.findMany({
      where: { negocio_id: negocioId, activo: true, linea_operacion: { not: null } },
      include: { unidad_distribucion: { select: { nombre: true } } },
      orderBy: [{ linea_operacion: 'asc' }, { orden_operativo: 'asc' }, { nombre: 'asc' }],
    }),
    prisma.proveedores.findMany({ where: { negocio_id: negocioId, activo: true }, orderBy: { nombre: 'asc' } }),
    prisma.plantillas_ruta.findMany({
      where: { negocio_id: negocioId, activo: true },
      include: { paradas: { include: { ubicacion: { select: { id: true, nombre: true } } }, orderBy: { orden: 'asc' } } },
      orderBy: [{ linea_operacion: 'asc' }, { dia_semana: 'asc' }, { nombre: 'asc' }],
    }),
    prisma.semanas_operativas.findMany({
      where: { negocio_id: negocioId },
      orderBy: [{ anio: 'desc' }, { semana: 'desc' }],
      take: 52,
    }),
  ]);
  return {
    empresas: empresas.map((e) => ({ ...e, id: Number(e.id) })),
    ubicaciones: ubicaciones.map((u) => ({
      id: Number(u.id), nombre: u.nombre, codigo: u.codigo, direccion: u.direccion, tipo: u.tipo,
      empresa: u.empresa_cliente ? { ...u.empresa_cliente, id: Number(u.empresa_cliente.id) } : null,
      entrega_en: u.entrega_en ? { id: Number(u.entrega_en.id), nombre: u.entrega_en.nombre } : null,
    })),
    productos: productos.map((p) => ({
      id: Number(p.id), nombre: p.nombre, sku: p.sku, linea: p.linea_operacion, orden: p.orden_operativo,
      tipo: p.tipo_operativo, unidad: p.unidad_distribucion.nombre,
      costo: esAdmin ? num(p.ultimo_costo) ?? num(p.costo_promedio) : undefined, precio: precioVentaProducto(p),
      precio_fijo: esAdmin ? num(p.precio_venta_fijo) : undefined, markup: esAdmin ? num0(p.markup_caja) : undefined,
      peso_caja_lb: num(p.peso_caja_lb), produccion_dias: p.produccion_dias,
    })),
    proveedores: esAdmin ? proveedores.map((p) => ({ id: Number(p.id), nombre: p.nombre })) : [],
    plantillas: esAdmin ? plantillas.map((p) => ({
      id: Number(p.id), nombre: p.nombre, codigo: p.codigo, linea: p.linea_operacion,
      dia_semana: p.dia_semana, conductor: p.conductor,
      paradas: p.paradas.map((x) => ({ ubicacion_id: Number(x.ubicacion_id), nombre: x.ubicacion.nombre, orden: x.orden, opcional: x.opcional })),
    })) : [],
    semanas: semanas.map((s) => ({
      id: Number(s.id), anio: s.anio, semana: s.semana, inicia_at: iso(s.inicia_at), termina_at: iso(s.termina_at), estado: s.estado,
    })),
  };
}

export async function listarPedidos(
  negocioId: bigint,
  filtros: { desde?: string; hasta?: string; linea?: LineaOperacion; ubicacionId?: bigint },
) {
  const rows = await prisma.pedidos_operativos.findMany({
    where: {
      negocio_id: negocioId,
      linea_operacion: filtros.linea,
      ubicacion_id: filtros.ubicacionId,
      fecha_entrega: filtros.desde || filtros.hasta ? { gte: filtros.desde ? fecha(filtros.desde) : undefined, lte: filtros.hasta ? fecha(filtros.hasta) : undefined } : undefined,
    },
    include: {
      empresa: { select: { id: true, nombre: true, codigo: true } },
      ubicacion: { select: { id: true, nombre: true, entrega_en: { select: { id: true, nombre: true } } } },
      lineas: { include: { producto: { select: { id: true, nombre: true, sku: true } } }, orderBy: { producto: { orden_operativo: 'asc' } } },
    },
    orderBy: [{ fecha_entrega: 'desc' }, { ubicacion: { orden_operativo: 'asc' } }],
  });
  return rows.map((p) => ({
    id: Number(p.id), linea: p.linea_operacion, fecha_entrega: iso(p.fecha_entrega), estado: p.estado,
    empresa: { ...p.empresa, id: Number(p.empresa.id) },
    ubicacion: { id: Number(p.ubicacion.id), nombre: p.ubicacion.nombre, entrega_en: p.ubicacion.entrega_en ? { id: Number(p.ubicacion.entrega_en.id), nombre: p.ubicacion.entrega_en.nombre } : null },
    notas: p.notas,
    lineas: p.lineas.map((l) => ({ id: Number(l.id), product_id: Number(l.product_id), nombre: l.producto.nombre, sku: l.producto.sku, cantidad: num0(l.cantidad), precio: num(l.precio_unitario) })),
  }));
}

export interface GuardarPedidoInput {
  ubicacion_id: number;
  linea: LineaOperacion;
  fecha_entrega: string;
  confirmar?: boolean;
  notas?: string | null;
  lineas: { product_id: number; cantidad: number; notas?: string | null }[];
}

export async function guardarPedido(
  negocioId: bigint,
  usuarioId: bigint,
  input: GuardarPedidoInput,
  esAdmin: boolean,
) {
  const ubicacion = await prisma.ubicaciones.findFirst({
    where: { id: BigInt(input.ubicacion_id), negocio_id: negocioId, tipo: 'sucursal', activo: true },
    include: { empresa_cliente: true },
  });
  if (!ubicacion?.empresa_cliente) throw new HttpError(400, 'La ubicación no tiene empresa de facturación configurada');
  const empresaId = ubicacion.empresa_cliente.id;

  const productIds = [...new Set(input.lineas.map((l) => BigInt(l.product_id)))];
  const productos = await prisma.products.findMany({
    where: { id: { in: productIds }, negocio_id: negocioId, linea_operacion: input.linea, activo: true },
  });
  if (productos.length !== productIds.length) throw new HttpError(400, 'Hay productos que no pertenecen a esa línea operativa');
  const porId = new Map(productos.map((p) => [p.id.toString(), p]));
  const dia = fecha(input.fecha_entrega).getUTCDay();
  if (!esAdmin) {
    const permitido = input.linea === 'carne' ? [1, 3, 4, 6].includes(dia) : dia === 3;
    if (!permitido) throw new HttpError(400, 'La fecha no corresponde a un día de entrega de esta operación');
  }

  const result = await prisma.$transaction(async (tx) => {
    let pedido = await tx.pedidos_operativos.findUnique({
      where: { ubicacion_id_linea_operacion_fecha_entrega: { ubicacion_id: ubicacion.id, linea_operacion: input.linea, fecha_entrega: fecha(input.fecha_entrega) } },
    });
    if (pedido && !esAdmin && !['borrador', 'confirmado'].includes(pedido.estado)) {
      throw new HttpError(409, 'El pedido ya entró a preparación; solo el administrador puede modificarlo');
    }
    pedido = pedido
      ? await tx.pedidos_operativos.update({
          where: { id: pedido.id },
          data: { estado: input.confirmar ? 'confirmado' : pedido.estado, confirmado_at: input.confirmar ? new Date() : pedido.confirmado_at, notas: input.notas },
        })
      : await tx.pedidos_operativos.create({
          data: {
            negocio_id: negocioId, empresa_cliente_id: empresaId, ubicacion_id: ubicacion.id,
            linea_operacion: input.linea, fecha_entrega: fecha(input.fecha_entrega), capturado_por: usuarioId,
            estado: input.confirmar ? 'confirmado' : 'borrador', confirmado_at: input.confirmar ? new Date() : null, notas: input.notas,
          },
        });

    await tx.pedido_operativo_lineas.deleteMany({ where: { pedido_id: pedido.id } });
    const positivas = input.lineas.filter((l) => l.cantidad > 0);
    if (positivas.length) {
      await tx.pedido_operativo_lineas.createMany({
        data: positivas.map((l) => {
          const p = porId.get(String(l.product_id))!;
          return { pedido_id: pedido!.id, product_id: p.id, cantidad: r3(l.cantidad), precio_unitario: precioVentaProducto(p), notas: l.notas };
        }),
      });
    }
    return pedido;
  });
  return { id: Number(result.id), estado: result.estado };
}

export async function guardarPlantilla(
  negocioId: bigint,
  id: bigint,
  datos: { nombre?: string; conductor?: string; activo?: boolean; paradas?: { ubicacion_id: number; orden: number; opcional?: boolean }[] },
) {
  const plantilla = await prisma.plantillas_ruta.findFirst({ where: { id, negocio_id: negocioId } });
  if (!plantilla) throw new HttpError(404, 'Plantilla no encontrada');
  if (datos.paradas) {
    const ids = datos.paradas.map((p) => BigInt(p.ubicacion_id));
    const validas = await prisma.ubicaciones.count({ where: { negocio_id: negocioId, id: { in: ids }, activo: true } });
    if (validas !== new Set(ids.map(String)).size) throw new HttpError(400, 'Una parada no es válida');
  }
  await prisma.$transaction(async (tx) => {
    await tx.plantillas_ruta.update({ where: { id }, data: { nombre: datos.nombre, conductor: datos.conductor, activo: datos.activo } });
    if (datos.paradas) {
      await tx.plantilla_ruta_paradas.deleteMany({ where: { plantilla_id: id } });
      const ordenadas = [...datos.paradas].sort((a, b) => a.orden - b.orden);
      if (ordenadas.length) await tx.plantilla_ruta_paradas.createMany({ data: ordenadas.map((p, i) => ({ plantilla_id: id, ubicacion_id: BigInt(p.ubicacion_id), orden: i + 1, opcional: p.opcional ?? false })) });
    }
  });
  return { ok: true };
}

export async function crearDistribucionOperativa(
  negocioId: bigint,
  usuarioId: bigint,
  linea: LineaOperacion,
  fechaEntrega: string,
) {
  const entrega = fecha(fechaEntrega);
  const pedidos = await prisma.pedidos_operativos.findMany({
    where: { negocio_id: negocioId, linea_operacion: linea, fecha_entrega: entrega, estado: 'confirmado' },
    include: { lineas: { include: { producto: true } }, ubicacion: { select: { id: true, nombre: true, entrega_en_ubicacion_id: true } } },
  });
  if (!pedidos.length) throw new HttpError(400, 'No hay pedidos confirmados para esa fecha');
  const ya = await prisma.distribuciones.findFirst({ where: { negocio_id: negocioId, linea_operacion: linea, fecha_entrega: entrega, estado: { not: 'cancelada' } } });
  if (ya) throw new HttpError(409, 'Ya existe una distribución para esa línea y fecha');
  const dias = entrega.getUTCDay();
  const plantillas = await prisma.plantillas_ruta.findMany({
    where: { negocio_id: negocioId, linea_operacion: linea, dia_semana: dias, activo: true },
    include: { paradas: { orderBy: { orden: 'asc' } } },
    orderBy: { nombre: 'asc' },
  });
  const rep = await prisma.usuarios.findFirst({ where: { negocio_id: negocioId, rol: 'encargado_bodega', activo: true }, orderBy: { id: 'asc' } });

  const dist = await prisma.$transaction(async (tx) => {
    const d = await tx.distribuciones.create({
      data: { negocio_id: negocioId, creado_por: usuarioId, estado: 'calculada', linea_operacion: linea, fecha_entrega: entrega, nombre: `${linea === 'carne' ? 'Carne' : 'Desechables'} · ${fechaEntrega}` },
    });
    const lineas = pedidos.flatMap((p) => p.lineas.map((l) => ({
      distribucion_id: d.id, ubicacion_destino_id: p.ubicacion_id, product_id: l.product_id,
      pedido_linea_id: l.id, cantidad_sugerida: l.cantidad, cantidad_aprobada: l.cantidad,
      costo_unitario: l.producto.ultimo_costo ?? l.producto.costo_promedio,
      costo_total: r2(num0(l.cantidad) * (num(l.producto.ultimo_costo) ?? num(l.producto.costo_promedio) ?? 0)),
    })));
    if (lineas.length) await tx.distribucion_lineas.createMany({ data: lineas });

    const destinosFisicos = new Set(pedidos.map((p) => (p.ubicacion.entrega_en_ubicacion_id ?? p.ubicacion_id).toString()));
    const asignados = new Set<string>();
    for (const plantilla of plantillas) {
      const paradas = plantilla.paradas.filter((p) => destinosFisicos.has(p.ubicacion_id.toString()));
      if (!paradas.length) continue;
      const ruta = await tx.rutas.create({
        data: { negocio_id: negocioId, distribucion_id: d.id, plantilla_id: plantilla.id, fecha_entrega: entrega, nombre: plantilla.nombre, repartidor_id: rep?.id ?? null, creado_por: usuarioId },
      });
      await tx.ruta_paradas.createMany({ data: paradas.map((p, i) => ({ ruta_id: ruta.id, ubicacion_id: p.ubicacion_id, orden: i + 1 })) });
      paradas.forEach((p) => asignados.add(p.ubicacion_id.toString()));
    }
    const faltantes = [...destinosFisicos].filter((id) => !asignados.has(id));
    if (faltantes.length) {
      const us = await tx.ubicaciones.findMany({ where: { id: { in: faltantes.map(BigInt) } }, orderBy: { nombre: 'asc' } });
      const ruta = await tx.rutas.create({ data: { negocio_id: negocioId, distribucion_id: d.id, fecha_entrega: entrega, nombre: 'Ruta por asignar', repartidor_id: rep?.id ?? null, creado_por: usuarioId } });
      await tx.ruta_paradas.createMany({ data: us.map((u, i) => ({ ruta_id: ruta.id, ubicacion_id: u.id, orden: i + 1 })) });
    }
    await tx.pedidos_operativos.updateMany({ where: { id: { in: pedidos.map((p) => p.id) } }, data: { estado: 'en_preparacion' } });
    return d;
  });
  return { id: Number(dist.id), pedidos: pedidos.length, rutas: plantillas.length };
}

export interface CompraInput {
  proveedor_id: number;
  ubicacion_id: number;
  fecha: string;
  referencia?: string | null;
  lineas: { product_id: number; cajas: number; peso_total_lb?: number; costo_total: number; congelado?: boolean }[];
}

export async function registrarCompra(negocioId: bigint, usuarioId: bigint, input: CompraInput) {
  const proveedor = await prisma.proveedores.findFirst({ where: { id: BigInt(input.proveedor_id), negocio_id: negocioId, activo: true } });
  if (!proveedor) throw new HttpError(400, 'Proveedor no válido');
  const ubicacion = await prisma.ubicaciones.findFirst({ where: { id: BigInt(input.ubicacion_id), negocio_id: negocioId, activo: true } });
  if (!ubicacion) throw new HttpError(400, 'Ubicación no válida');
  if (!input.lineas.length || input.lineas.some((l) => l.cajas <= 0 || l.costo_total < 0)) throw new HttpError(400, 'La compra requiere cantidad y costo válidos');
  const ids = input.lineas.map((l) => BigInt(l.product_id));
  const productos = await prisma.products.findMany({ where: { id: { in: ids }, negocio_id: negocioId, linea_operacion: { not: null }, activo: true } });
  if (productos.length !== new Set(ids.map(String)).size) throw new HttpError(400, 'La compra contiene un producto no válido');
  for (const l of input.lineas) {
    const p = productos.find((x) => x.id === BigInt(l.product_id))!;
    if (p.tipo_operativo === 'materia_prima' && (l.peso_total_lb ?? 0) <= 0) throw new HttpError(400, `${p.nombre} requiere peso total`);
  }
  const total = r2(input.lineas.reduce((a, l) => a + l.costo_total, 0));
  const f = fecha(input.fecha);

  const compra = await prisma.$transaction(async (tx) => {
    const c = await tx.compras.create({
      data: { negocio_id: negocioId, proveedor_id: proveedor.id, ubicacion_id: ubicacion.id, fecha: f, vence_at: sumarDias(f, 14), referencia: input.referencia, total, registrado_por: usuarioId },
    });
    for (const [i, l] of input.lineas.entries()) {
      const pid = BigInt(l.product_id);
      const actual = await tx.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacion.id, product_id: pid } } });
      const prod = productos.find((p) => p.id === pid)!;
      const cajasPrev = Math.max(0, num0(actual?.cantidad_disponible));
      const pesoTotal = l.peso_total_lb ?? 0;
      const esMateriaPrima = prod.tipo_operativo === 'materia_prima';
      const pesoPrev = cajasPrev * (num(prod.peso_caja_lb) ?? (pesoTotal > 0 ? pesoTotal / l.cajas : 0));
      const pesoCaja = esMateriaPrima ? r3((pesoPrev + pesoTotal) / (cajasPrev + l.cajas)) : num(prod.peso_caja_lb);
      const costoCaja = r4(l.costo_total / l.cajas);
      const cl = await tx.compra_lineas.create({ data: { compra_id: c.id, product_id: pid, cajas: r3(l.cajas), peso_total_lb: r3(pesoTotal), costo_total: r2(l.costo_total), congelado: esMateriaPrima && (l.congelado ?? false) } });
      if (esMateriaPrima) {
        await tx.lotes_materia_prima.create({
          data: { negocio_id: negocioId, ubicacion_id: ubicacion.id, product_id: pid, compra_linea_id: cl.id, fecha: f, congelado: l.congelado ?? false, cajas_iniciales: r3(l.cajas), cajas_disponibles: r3(l.cajas), peso_inicial_lb: r3(pesoTotal), peso_disponible_lb: r3(pesoTotal), costo_inicial: r2(l.costo_total), costo_disponible: r2(l.costo_total) },
        });
      }
      await aplicarMovimiento(tx, {
        negocioId, productId: pid, tipo: 'compra_recibida', cantidad: l.cajas, usuarioId,
        destinoId: ubicacion.id, costoUnitario: costoCaja, documentoTipo: 'compra', documentoId: c.id,
        comentario: `${proveedor.nombre}${esMateriaPrima && l.congelado ? ' · congelado' : ''}`,
        idempotencyKey: `compra:${c.id}:${i}`,
        deltas: [{ ubicacionId: ubicacion.id, productId: pid, disponible: l.cajas, costoUnitario: costoCaja }],
      });
      await tx.products.update({ where: { id: pid }, data: { ultimo_costo: costoCaja, peso_caja_lb: esMateriaPrima ? pesoCaja : undefined } });
    }
    return c;
  });
  return { id: Number(compra.id), total, vence_at: iso(compra.vence_at) };
}

export async function guardarInventarioFinal(
  negocioId: bigint,
  usuarioId: bigint,
  input: { ubicacion_id: number; fecha: string; lineas: { product_id: number; cantidad: number }[] },
) {
  const ubicacionId = BigInt(input.ubicacion_id);
  const ubicacion = await prisma.ubicaciones.findFirst({ where: { id: ubicacionId, negocio_id: negocioId, tipo: 'bodega', activo: true } });
  if (!ubicacion) throw new HttpError(400, 'Almacén no válido');
  const ids = [...new Set(input.lineas.map((l) => BigInt(l.product_id)))];
  const productos = await prisma.products.findMany({ where: { id: { in: ids }, negocio_id: negocioId, activo: true } });
  if (productos.length !== ids.length) throw new HttpError(400, 'El inventario contiene productos no válidos');
  const sello = `${input.fecha}:${Date.now()}`;
  let ajustes = 0;
  await prisma.$transaction(async (tx) => {
    for (const l of input.lineas) {
      const productId = BigInt(l.product_id);
      const actual = await tx.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } } });
      const delta = r3(l.cantidad - num0(actual?.cantidad_disponible));
      if (Math.abs(delta) < 0.0001) continue;
      const producto = productos.find((p) => p.id === productId)!;
      const costo = num(actual?.costo_promedio) ?? num(producto.ultimo_costo) ?? num(producto.costo_promedio);
      await aplicarMovimiento(tx, {
        negocioId, productId, tipo: delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo', cantidad: Math.abs(delta), usuarioId,
        origenId: delta < 0 ? ubicacionId : null, destinoId: delta > 0 ? ubicacionId : null, costoUnitario: costo,
        documentoTipo: 'inventario_final', comentario: `Inventario físico final · ${input.fecha}`,
        idempotencyKey: `inventario-final:${ubicacionId}:${sello}:${productId}`,
        deltas: [{ ubicacionId, productId, disponible: delta, costoUnitario: costo }],
      });
      ajustes += 1;
    }
  });
  return { ok: true, ajustes };
}

export async function cambiarCongelado(negocioId: bigint, loteId: bigint, congelado: boolean) {
  const lote = await prisma.lotes_materia_prima.findFirst({ where: { id: loteId, negocio_id: negocioId } });
  if (!lote) throw new HttpError(404, 'Lote no encontrado');
  await prisma.lotes_materia_prima.update({ where: { id: loteId }, data: { congelado } });
  return { ok: true, congelado };
}

export interface ProduccionInput {
  ubicacion_id: number;
  materia_prima_id: number;
  fecha: string;
  cajas_materia_prima: number;
  notas?: string | null;
  salidas: { product_id: number; cajas: number }[];
}

export async function registrarProduccion(negocioId: bigint, usuarioId: bigint, input: ProduccionInput) {
  if (input.cajas_materia_prima <= 0 || !input.salidas.length || input.salidas.some((s) => s.cajas <= 0)) throw new HttpError(400, 'La producción requiere entrada y salidas válidas');
  const ubicId = BigInt(input.ubicacion_id);
  const materiaId = BigInt(input.materia_prima_id);
  const materia = await prisma.products.findFirst({ where: { id: materiaId, negocio_id: negocioId, tipo_operativo: 'materia_prima', activo: true } });
  if (!materia) throw new HttpError(400, 'Materia prima no válida');
  const salidaIds = input.salidas.map((s) => BigInt(s.product_id));
  const productos = await prisma.products.findMany({ where: { id: { in: salidaIds }, negocio_id: negocioId, linea_operacion: 'carne', tipo_operativo: 'proteina', activo: true } });
  if (productos.length !== new Set(salidaIds.map(String)).size) throw new HttpError(400, 'Hay productos terminados no válidos');
  const permitidas = new Set(salidasPorMateria[materia.sku] ?? []);
  if (productos.some((p) => !permitidas.has(p.sku))) throw new HttpError(400, 'Una salida no corresponde a la materia prima seleccionada');
  for (const s of input.salidas) {
    const p = productos.find((x) => x.id === BigInt(s.product_id))!;
    if (num(p.peso_caja_lb) == null) throw new HttpError(400, `${p.nombre} no tiene peso estándar por caja`);
  }
  const lotes = await prisma.lotes_materia_prima.findMany({
    where: { negocio_id: negocioId, ubicacion_id: ubicId, product_id: materiaId, congelado: false, cajas_disponibles: { gt: 0 } },
    orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
  });
  if (lotes.reduce((a, l) => a + num0(l.cajas_disponibles), 0) + 0.0001 < input.cajas_materia_prima) throw new HttpError(409, 'No hay suficientes cajas frescas de esa materia prima');

  let faltan = input.cajas_materia_prima;
  const consumos: { lote: (typeof lotes)[number]; cajas: number; peso: number; costo: number }[] = [];
  for (const lote of lotes) {
    if (faltan <= 0.0001) break;
    const disponibles = num0(lote.cajas_disponibles);
    const cajas = Math.min(faltan, disponibles);
    const proporcion = disponibles > 0 ? cajas / disponibles : 0;
    consumos.push({ lote, cajas: r3(cajas), peso: r3(num0(lote.peso_disponible_lb) * proporcion), costo: r2(num0(lote.costo_disponible) * proporcion) });
    faltan = r3(faltan - cajas);
  }
  const pesoEntrada = r3(consumos.reduce((a, c) => a + c.peso, 0));
  const costoEntrada = r2(consumos.reduce((a, c) => a + c.costo, 0));
  const salidas = input.salidas.map((s) => {
    const p = productos.find((x) => x.id === BigInt(s.product_id))!;
    const pesoCaja = num0(p.peso_caja_lb);
    return { input: s, producto: p, pesoCaja, pesoTotal: r3(s.cajas * pesoCaja) };
  });
  const pesoSalida = r3(salidas.reduce((a, s) => a + s.pesoTotal, 0));
  if (pesoSalida > pesoEntrada + 0.001) throw new HttpError(400, 'El peso producido no puede superar el peso de materia prima usado');
  const desperdicio = r3(Math.max(0, pesoEntrada - pesoSalida));
  const yieldPct = pesoEntrada > 0 ? r4((pesoSalida / pesoEntrada) * 100) : 0;

  const produccion = await prisma.$transaction(async (tx) => {
    const p = await tx.producciones.create({
      data: { negocio_id: negocioId, ubicacion_id: ubicId, materia_prima_id: materiaId, fecha: fecha(input.fecha), cajas_materia_prima: r3(input.cajas_materia_prima), peso_entrada_lb: pesoEntrada, costo_entrada: costoEntrada, peso_salida_lb: pesoSalida, desperdicio_lb: desperdicio, yield_porcentaje: yieldPct, registrado_por: usuarioId, notas: input.notas },
    });
    for (const c of consumos) {
      await tx.produccion_consumos_lote.create({ data: { produccion_id: p.id, lote_id: c.lote.id, cajas: c.cajas, peso_lb: c.peso, costo: c.costo } });
      await tx.lotes_materia_prima.update({ where: { id: c.lote.id }, data: { cajas_disponibles: r3(num0(c.lote.cajas_disponibles) - c.cajas), peso_disponible_lb: r3(num0(c.lote.peso_disponible_lb) - c.peso), costo_disponible: r2(num0(c.lote.costo_disponible) - c.costo) } });
    }
    await aplicarMovimiento(tx, {
      negocioId, productId: materiaId, tipo: 'consumo', cantidad: input.cajas_materia_prima, usuarioId,
      origenId: ubicId, costoUnitario: costoEntrada / input.cajas_materia_prima, documentoTipo: 'produccion', documentoId: p.id,
      comentario: `Materia prima · yield ${yieldPct}%`, idempotencyKey: `produccion:${p.id}:entrada`,
      deltas: [{ ubicacionId: ubicId, productId: materiaId, disponible: -input.cajas_materia_prima }],
    });
    for (const [i, s] of salidas.entries()) {
      const costoTotal = pesoSalida > 0 ? r2(costoEntrada * (s.pesoTotal / pesoSalida)) : 0;
      const costoCaja = r4(costoTotal / s.input.cajas);
      const precio = s.producto.precio_venta_fijo != null ? num0(s.producto.precio_venta_fijo) : r4(costoCaja + (s.producto.tipo_operativo === 'proteina' ? num0(s.producto.markup_caja) : 0));
      await tx.produccion_salidas.create({ data: { produccion_id: p.id, product_id: s.producto.id, cajas: r3(s.input.cajas), peso_caja_lb: s.pesoCaja, peso_total_lb: s.pesoTotal, costo_total: costoTotal, costo_caja: costoCaja, precio_venta_caja: precio } });
      await aplicarMovimiento(tx, {
        negocioId, productId: s.producto.id, tipo: 'ajuste_positivo', cantidad: s.input.cajas, usuarioId,
        destinoId: ubicId, costoUnitario: costoCaja, documentoTipo: 'produccion', documentoId: p.id,
        comentario: `Producción · ${s.pesoTotal} lb`, idempotencyKey: `produccion:${p.id}:salida:${i}`,
        deltas: [{ ubicacionId: ubicId, productId: s.producto.id, disponible: s.input.cajas, costoUnitario: costoCaja }],
      });
      await tx.products.update({ where: { id: s.producto.id }, data: { ultimo_costo: costoCaja } });
    }
    return p;
  });
  return { id: Number(produccion.id), peso_entrada_lb: pesoEntrada, peso_salida_lb: pesoSalida, desperdicio_lb: desperdicio, yield_porcentaje: yieldPct, costo_total: costoEntrada };
}

export async function resumenProduccion(negocioId: bigint) {
  const [compras, producciones, lotes] = await Promise.all([
    prisma.compras.findMany({ where: { negocio_id: negocioId }, include: { proveedor: true, lineas: { include: { producto: true } } }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], take: 50 }),
    prisma.producciones.findMany({ where: { negocio_id: negocioId }, include: { materia_prima: true, salidas: { include: { producto: true } } }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], take: 50 }),
    prisma.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 } }, include: { producto: true }, orderBy: [{ congelado: 'asc' }, { fecha: 'asc' }] }),
  ]);
  return {
    compras: compras.map((c) => ({ id: Number(c.id), fecha: iso(c.fecha), vence_at: iso(c.vence_at), proveedor: c.proveedor.nombre, referencia: c.referencia, total: num0(c.total), estado: c.estado, lineas: c.lineas.map((l) => ({ producto: l.producto.nombre, cajas: num0(l.cajas), peso_lb: num0(l.peso_total_lb), costo: num0(l.costo_total), congelado: l.congelado })) })),
    producciones: producciones.map((p) => ({ id: Number(p.id), fecha: iso(p.fecha), materia_prima: p.materia_prima.nombre, cajas_entrada: num0(p.cajas_materia_prima), peso_entrada_lb: num0(p.peso_entrada_lb), peso_salida_lb: num0(p.peso_salida_lb), desperdicio_lb: num0(p.desperdicio_lb), yield: num0(p.yield_porcentaje), costo: num0(p.costo_entrada), salidas: p.salidas.map((s) => ({ producto: s.producto.nombre, cajas: num0(s.cajas), costo_caja: num0(s.costo_caja), precio: num0(s.precio_venta_caja) })) })),
    lotes: lotes.map((l) => ({ id: Number(l.id), fecha: iso(l.fecha), producto: l.producto.nombre, product_id: Number(l.product_id), cajas: num0(l.cajas_disponibles), peso_lb: num0(l.peso_disponible_lb), costo: num0(l.costo_disponible), congelado: l.congelado })),
  };
}
