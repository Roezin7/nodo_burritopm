import type { LineaOperacion, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { aplicarMovimiento } from '../ledger/service.js';
import { num, num0 } from '../lib/num.js';
import { HttpError } from '../middleware/error.js';
import { eliminarConteo } from '../conteos/service.js';
import { asegurarRangoEditable, asegurarSemanaEditable } from '../lib/semana-operativa.js';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const sumarDias = (d: Date, dias: number) => new Date(d.getTime() + dias * 86400000);
const consumiblesEnOrdenCarne = new Set(['BPM-0019', 'BPM-0047', 'BPM-0048', 'BPM-0049', 'BPM-0020', 'BPM-0029']);

const salidasPorMateria: Record<string, string[]> = {
  'RAW-INSIDE-SKIRT': ['MEAT-STEAK'],
  'RAW-CHICKEN': ['MEAT-CHICKEN'],
  'RAW-PORK-BUTT': ['MEAT-PASTOR-BPM', 'MEAT-PASTOR-TAP'],
  'RAW-OUTSIDE-SKIRT': ['MEAT-ASADA', 'MEAT-FAJITAS'],
  'RAW-INSIDE-ROUND': ['MEAT-MILANESA'],
  'RAW-TAPATIOS-TACO': ['MEAT-TAPATIOS-TACO'],
};

export interface LoteFifoCalculable {
  cajas: number;
  peso_lb: number;
  costo: number;
}

/**
 * Consume cajas por antigüedad conservando el peso y costo reales de cada lote.
 * Una fracción de caja toma la misma fracción del peso/costo restante del lote;
 * nunca se usa un peso fijo de catálogo para la materia prima comprada.
 */
export function calcularConsumoFifo(lotes: LoteFifoCalculable[], cajasSolicitadas: number) {
  let faltan = r3(cajasSolicitadas);
  const consumos: { indice: number; cajas: number; peso: number; costo: number }[] = [];
  for (const [indice, lote] of lotes.entries()) {
    if (faltan <= 0.0001) break;
    const disponibles = Math.max(0, lote.cajas);
    const cajas = Math.min(faltan, disponibles);
    if (cajas <= 0) continue;
    const proporcion = cajas / disponibles;
    consumos.push({ indice, cajas: r3(cajas), peso: r3(lote.peso_lb * proporcion), costo: r2(lote.costo * proporcion) });
    faltan = r3(faltan - cajas);
  }
  return {
    consumos,
    cajas_faltantes: Math.max(0, faltan),
    peso_total: r3(consumos.reduce((a, c) => a + c.peso, 0)),
    costo_total: r2(consumos.reduce((a, c) => a + c.costo, 0)),
  };
}

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

export function skuPastorParaEmpresa(empresaCodigo: string) {
  return empresaCodigo === 'LBT' ? 'MEAT-PASTOR-TAP' : 'MEAT-PASTOR-BPM';
}

export async function catalogoOperacion(negocioId: bigint, esAdmin: boolean, ubicacionesPermitidas?: bigint[]) {
  const [empresas, ubicaciones, productos, proveedores, plantillas, semanas] = await Promise.all([
    prisma.empresas_clientes.findMany({
      where: { negocio_id: negocioId, activo: true },
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
  const calendarioPedidos = ubicaciones
    .filter((u) => u.tipo === 'sucursal' && u.empresa_cliente_id && (esAdmin || (ubicacionesPermitidas ?? []).some((id) => id === u.id)))
    .flatMap((u) => {
      const destinoFisico = u.entrega_en_ubicacion_id ?? u.id;
      const porDia = new Map<string, { ubicacion_id: number; linea: LineaOperacion; dia_semana: number; rutas: { id: number; nombre: string; codigo: string; conductor: string }[] }>();
      for (const plantilla of plantillas.filter((p) => p.activo && p.paradas.some((parada) => parada.ubicacion_id === destinoFisico))) {
        const clave = `${plantilla.linea_operacion}:${plantilla.dia_semana}`;
        const entrada = porDia.get(clave) ?? { ubicacion_id: Number(u.id), linea: plantilla.linea_operacion, dia_semana: plantilla.dia_semana, rutas: [] };
        entrada.rutas.push({ id: Number(plantilla.id), nombre: plantilla.nombre, codigo: plantilla.codigo, conductor: plantilla.conductor });
        porDia.set(clave, entrada);
      }
      return [...porDia.values()];
    });
  return {
    empresas: empresas.map((e) => ({ ...e, id: Number(e.id) })),
    ubicaciones: ubicaciones.filter((u) => esAdmin || (ubicacionesPermitidas ?? []).some((id) => id === u.id)).map((u) => ({
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
    calendario_pedidos: calendarioPedidos,
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
  await asegurarSemanaEditable(negocioId, input.fecha_entrega);
  const ubicacion = await prisma.ubicaciones.findFirst({
    where: { id: BigInt(input.ubicacion_id), negocio_id: negocioId, tipo: 'sucursal', activo: true },
    include: { empresa_cliente: true },
  });
  if (!ubicacion?.empresa_cliente) throw new HttpError(400, 'La ubicación no tiene empresa de facturación configurada');
  const empresaId = ubicacion.empresa_cliente.id;

  const productIds = [...new Set(input.lineas.map((l) => BigInt(l.product_id)))];
  const productos = await prisma.products.findMany({
    // La hoja de carne incluye seis consumibles de Tapatíos. La línea del pedido define
    // la ruta; la línea propia del producto conserva su bodega e invoice correctos.
    where: { id: { in: productIds }, negocio_id: negocioId, linea_operacion: { not: null }, activo: true },
  });
  if (productos.length !== productIds.length) throw new HttpError(400, 'Hay productos que no pertenecen a la operación');
  const fueraDeFormato = productos.some((p) => p.linea_operacion !== input.linea && !(input.linea === 'carne' && consumiblesEnOrdenCarne.has(p.sku)));
  if (fueraDeFormato) throw new HttpError(400, 'Hay productos fuera del formato de esta orden');
  if (input.linea === 'carne') {
    const pastorEsperado = skuPastorParaEmpresa(ubicacion.empresa_cliente.codigo);
    const pastorIncorrecto = pastorEsperado === 'MEAT-PASTOR-TAP' ? 'MEAT-PASTOR-BPM' : 'MEAT-PASTOR-TAP';
    if (productos.some((p) => p.sku === pastorIncorrecto)) {
      throw new HttpError(400, ubicacion.empresa_cliente.codigo === 'LBT'
        ? 'Los Burritos Tapatíos debe ordenar Pastor Tapatíos'
        : 'Este restaurante debe ordenar el Pastor regular de BPM');
    }
  }
  const porId = new Map(productos.map((p) => [p.id.toString(), p]));
  const dia = fecha(input.fecha_entrega).getUTCDay();
  if (!esAdmin) {
    const destinoFisico = ubicacion.entrega_en_ubicacion_id ?? ubicacion.id;
    const permitido = await prisma.plantilla_ruta_paradas.findFirst({
      where: {
        ubicacion_id: destinoFisico,
        plantilla: { negocio_id: negocioId, linea_operacion: input.linea, dia_semana: dia, activo: true },
      },
      select: { plantilla_id: true },
    });
    if (!permitido) throw new HttpError(400, 'La fecha no corresponde a una entrega programada para este restaurante');
  }

  const result = await prisma.$transaction(async (tx) => {
    let pedido = await tx.pedidos_operativos.findUnique({
      where: { ubicacion_id_linea_operacion_fecha_entrega: { ubicacion_id: ubicacion.id, linea_operacion: input.linea, fecha_entrega: fecha(input.fecha_entrega) } },
    });
    if (pedido && !['borrador', 'confirmado'].includes(pedido.estado)) {
      throw new HttpError(409, pedido.estado === 'cerrado'
        ? 'El pedido pertenece a un cierre. Reabre la semana antes de corregirlo.'
        : 'El pedido ya entró a preparación. Elimina esa preparación para corregir la venta y volver a generarla.');
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

/**
 * Confirma en un solo paso todos los borradores que sí contienen cantidades.
 * Los borradores vacíos se conservan como borrador y nunca pasan a preparación.
 */
export async function confirmarPedidosEnRango(
  negocioId: bigint,
  linea: LineaOperacion,
  desde: string,
  hasta: string,
) {
  await asegurarRangoEditable(negocioId, desde, hasta);
  const rango = { gte: fecha(desde), lte: fecha(hasta) };
  const borradores = await prisma.pedidos_operativos.findMany({
    where: { negocio_id: negocioId, linea_operacion: linea, fecha_entrega: rango, estado: 'borrador' },
    select: { id: true, lineas: { select: { id: true }, take: 1 } },
  });
  const conPedido = borradores.filter((p) => p.lineas.length > 0).map((p) => p.id);
  if (conPedido.length) {
    await prisma.pedidos_operativos.updateMany({
      where: { id: { in: conPedido }, estado: 'borrador' },
      data: { estado: 'confirmado', confirmado_at: new Date() },
    });
  }

  // BPM opera con todas sus sucursales activas. La cobertura no inventa cantidades:
  // hace visible cualquier restaurante que aún no tenga un pedido confirmado.
  const bpm = await prisma.empresas_clientes.findFirst({
    where: { negocio_id: negocioId, codigo: 'BPM', activo: true },
    select: { id: true },
  });
  const sucursalesBpm = bpm
    ? await prisma.ubicaciones.findMany({
        where: { negocio_id: negocioId, empresa_cliente_id: bpm.id, tipo: 'sucursal', activo: true },
        select: { id: true, nombre: true },
        orderBy: [{ orden_operativo: 'asc' }, { nombre: 'asc' }],
      })
    : [];
  const fechasEsperadas: Date[] = [];
  for (let cursor = fecha(desde); cursor <= fecha(hasta); cursor = sumarDias(cursor, 1)) {
    const dia = cursor.getUTCDay();
    if ((linea === 'carne' && [3, 6].includes(dia)) || (linea === 'desechables' && dia === 3)) fechasEsperadas.push(cursor);
  }
  const pedidosBpm = sucursalesBpm.length && fechasEsperadas.length
    ? await prisma.pedidos_operativos.findMany({
        where: {
          negocio_id: negocioId,
          linea_operacion: linea,
          ubicacion_id: { in: sucursalesBpm.map((u) => u.id) },
          fecha_entrega: { in: fechasEsperadas },
          estado: { notIn: ['borrador', 'cancelado'] },
          lineas: { some: {} },
        },
        select: { ubicacion_id: true, fecha_entrega: true },
      })
    : [];
  const presentes = new Set(pedidosBpm.map((p) => `${iso(p.fecha_entrega)}:${p.ubicacion_id}`));
  const cobertura_bpm = fechasEsperadas.map((dia) => {
    const pendientes = sucursalesBpm.filter((u) => !presentes.has(`${iso(dia)}:${u.id}`)).map((u) => u.nombre);
    return { fecha: iso(dia), total: sucursalesBpm.length, confirmados: sucursalesBpm.length - pendientes.length, pendientes };
  });

  return {
    confirmados: conPedido.length,
    borradores_vacios: borradores.length - conPedido.length,
    cobertura_bpm,
  };
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
  await asegurarSemanaEditable(negocioId, fechaEntrega);
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

  const resultado = await prisma.$transaction(async (tx) => {
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
    let rutasCreadas = 0;
    for (const plantilla of plantillas) {
      const paradas = plantilla.paradas.filter((p) => destinosFisicos.has(p.ubicacion_id.toString()));
      const ruta = await tx.rutas.create({
        data: { negocio_id: negocioId, distribucion_id: d.id, plantilla_id: plantilla.id, fecha_entrega: entrega, nombre: plantilla.nombre, repartidor_id: rep?.id ?? null, creado_por: usuarioId },
      });
      rutasCreadas += 1;
      if (paradas.length) await tx.ruta_paradas.createMany({ data: paradas.map((p, i) => ({ ruta_id: ruta.id, ubicacion_id: p.ubicacion_id, orden: i + 1 })) });
      paradas.forEach((p) => asignados.add(p.ubicacion_id.toString()));
    }
    const faltantes = [...destinosFisicos].filter((id) => !asignados.has(id));
    if (faltantes.length) {
      const us = await tx.ubicaciones.findMany({ where: { id: { in: faltantes.map(BigInt) } }, orderBy: { nombre: 'asc' } });
      const ruta = await tx.rutas.create({ data: { negocio_id: negocioId, distribucion_id: d.id, fecha_entrega: entrega, nombre: 'Ruta por asignar', repartidor_id: rep?.id ?? null, creado_por: usuarioId } });
      await tx.ruta_paradas.createMany({ data: us.map((u, i) => ({ ruta_id: ruta.id, ubicacion_id: u.id, orden: i + 1 })) });
      rutasCreadas += 1;
    }
    await tx.pedidos_operativos.updateMany({ where: { id: { in: pedidos.map((p) => p.id) } }, data: { estado: 'en_preparacion' } });
    return { d, rutasCreadas };
  });
  return { id: Number(resultado.d.id), pedidos: pedidos.length, rutas: resultado.rutasCreadas };
}

/** Crea de una vez todas las preparaciones de la semana que tengan pedidos confirmados. */
export async function crearPreparacionesEnRango(
  negocioId: bigint,
  usuarioId: bigint,
  desde: string,
  hasta: string,
  linea?: LineaOperacion,
) {
  await asegurarRangoEditable(negocioId, desde, hasta);
  const grupos = await prisma.pedidos_operativos.findMany({
    where: {
      negocio_id: negocioId,
      linea_operacion: linea,
      fecha_entrega: { gte: fecha(desde), lte: fecha(hasta) },
      estado: 'confirmado',
      lineas: { some: {} },
    },
    select: { linea_operacion: true, fecha_entrega: true },
    distinct: ['linea_operacion', 'fecha_entrega'],
    orderBy: [{ fecha_entrega: 'asc' }, { linea_operacion: 'asc' }],
  });
  const borradores_omitidos = await prisma.pedidos_operativos.count({
    where: { negocio_id: negocioId, linea_operacion: linea, fecha_entrega: { gte: fecha(desde), lte: fecha(hasta) }, estado: 'borrador' },
  });
  const creadas: { id: number; linea: LineaOperacion; fecha: string; pedidos: number; rutas: number }[] = [];
  let existentes = 0;
  for (const grupo of grupos) {
    const ya = await prisma.distribuciones.findFirst({
      where: {
        negocio_id: negocioId,
        linea_operacion: grupo.linea_operacion,
        fecha_entrega: grupo.fecha_entrega,
        estado: { not: 'cancelada' },
      },
      select: { id: true },
    });
    if (ya) {
      existentes += 1;
      continue;
    }
    const creada = await crearDistribucionOperativa(negocioId, usuarioId, grupo.linea_operacion, iso(grupo.fecha_entrega));
    creadas.push({ ...creada, linea: grupo.linea_operacion, fecha: iso(grupo.fecha_entrega) });
  }
  return { creadas, existentes, borradores_omitidos };
}

export interface CompraInput {
  proveedor_id: number;
  ubicacion_id: number;
  fecha: string;
  referencia?: string | null;
  lineas: { product_id: number; cajas: number; peso_total_lb?: number; costo_total: number; congelado?: boolean }[];
}

export async function registrarCompra(negocioId: bigint, usuarioId: bigint, input: CompraInput) {
  await asegurarSemanaEditable(negocioId, input.fecha);
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
    if (p.tipo_operativo === 'materia_prima' && ubicacion.codigo !== 'CARN') throw new HttpError(400, `${p.nombre} debe recibirse en Carnicería`);
    if (p.linea_operacion === 'desechables' && ubicacion.codigo === 'CARN') throw new HttpError(400, `${p.nombre} debe recibirse en Bodega Adison`);
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
      const pesoTotal = l.peso_total_lb ?? 0;
      const esMateriaPrima = prod.tipo_operativo === 'materia_prima';
      // El peso promedio de materia prima se deriva de lotes comprados, nunca de un
      // ajuste manual de existencias. Así una captura física no contamina producción.
      const lotesPrevios = esMateriaPrima
        ? await tx.lotes_materia_prima.findMany({
            where: { negocio_id: negocioId, ubicacion_id: ubicacion.id, product_id: pid, cajas_disponibles: { gt: 0 } },
            select: { cajas_disponibles: true, peso_disponible_lb: true },
          })
        : [];
      const cajasPrev = esMateriaPrima
        ? lotesPrevios.reduce((a, lote) => a + num0(lote.cajas_disponibles), 0)
        : Math.max(0, num0(actual?.cantidad_disponible));
      const pesoPrev = esMateriaPrima
        ? lotesPrevios.reduce((a, lote) => a + num0(lote.peso_disponible_lb), 0)
        : cajasPrev * (num(prod.peso_caja_lb) ?? (pesoTotal > 0 ? pesoTotal / l.cajas : 0));
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
  }, { isolationLevel: 'Serializable' });
  return { id: Number(compra.id), total, vence_at: iso(compra.vence_at) };
}

/**
 * Elimina una compra y revierte su entrada de inventario. La materia prima solo
 * puede borrarse mientras su lote siga íntegro: una compra ya usada en producción
 * o ajustada por inventario conserva su trazabilidad y debe corregirse desde la
 * operación posterior correspondiente.
 */
export async function eliminarCompra(negocioId: bigint, compraId: bigint) {
  return prisma.$transaction(async (tx) => {
    const compra = await tx.compras.findFirst({
      where: { id: compraId, negocio_id: negocioId },
      include: {
        lineas: {
          include: {
            producto: true,
            lote: { include: { _count: { select: { consumos: true, ajustes: true } } } },
          },
        },
      },
    });
    if (!compra) throw new HttpError(404, 'Compra no encontrada');

    const semanaCerrada = await tx.semanas_operativas.findFirst({
      where: { negocio_id: negocioId, estado: 'cerrada', inicia_at: { lte: compra.fecha }, termina_at: { gte: compra.fecha } },
      select: { semana: true, anio: true },
    });
    if (semanaCerrada) throw new HttpError(409, `La compra pertenece a la semana ${semanaCerrada.semana} de ${semanaCerrada.anio}, que está cerrada. Reabre la semana antes de eliminarla.`);

    const grupos = new Map<string, { productId: bigint; cajas: number; costo: number; materiaPrima: boolean; nombre: string }>();
    for (const linea of compra.lineas) {
      const materiaPrima = linea.producto.tipo_operativo === 'materia_prima';
      if (materiaPrima) {
        const lote = linea.lote;
        if (!lote) throw new HttpError(409, `${linea.producto.nombre}: la compra no tiene un lote reversible.`);
        const loteIntegro = Math.abs(num0(lote.cajas_disponibles) - num0(lote.cajas_iniciales)) <= 0.001
          && Math.abs(num0(lote.peso_disponible_lb) - num0(lote.peso_inicial_lb)) <= 0.001
          && Math.abs(num0(lote.costo_disponible) - num0(lote.costo_inicial)) <= 0.01;
        if (!loteIntegro || lote._count.consumos > 0 || lote._count.ajustes > 0) {
          throw new HttpError(409, `${linea.producto.nombre}: esta compra ya fue utilizada en producción o inventario y no se puede eliminar.`);
        }
      }
      const clave = linea.product_id.toString();
      const grupo = grupos.get(clave) ?? { productId: linea.product_id, cajas: 0, costo: 0, materiaPrima, nombre: linea.producto.nombre };
      grupo.cajas = r3(grupo.cajas + num0(linea.cajas));
      grupo.costo = r2(grupo.costo + num0(linea.costo_total));
      grupos.set(clave, grupo);
    }

    const existenciasAntes = new Map<string, { cantidad: number; costo: number | null }>();
    for (const [clave, grupo] of grupos) {
      const existencia = await tx.existencias.findUnique({
        where: { ubicacion_id_product_id: { ubicacion_id: compra.ubicacion_id, product_id: grupo.productId } },
      });
      const cantidad = num0(existencia?.cantidad_disponible);
      if (cantidad + 0.0001 < grupo.cajas) {
        throw new HttpError(409, `${grupo.nombre}: el inventario disponible ya es menor que la compra. Revierte primero su uso antes de eliminarla.`);
      }
      existenciasAntes.set(clave, { cantidad, costo: num(existencia?.costo_promedio) });
    }

    const lotesIds = compra.lineas.flatMap((linea) => linea.lote ? [linea.lote.id] : []);
    if (lotesIds.length) await tx.lotes_materia_prima.deleteMany({ where: { id: { in: lotesIds } } });
    await tx.movimientos_inventario.deleteMany({ where: { negocio_id: negocioId, documento_tipo: 'compra', documento_id: compra.id } });
    await tx.compras.delete({ where: { id: compra.id } });

    for (const [clave, grupo] of grupos) {
      const anterior = existenciasAntes.get(clave)!;
      const cantidadNueva = r3(anterior.cantidad - grupo.cajas);
      const lotesRestantes = grupo.materiaPrima
        ? await tx.lotes_materia_prima.findMany({
            where: { negocio_id: negocioId, ubicacion_id: compra.ubicacion_id, product_id: grupo.productId, cajas_disponibles: { gt: 0 } },
            select: { cajas_disponibles: true, peso_disponible_lb: true, costo_disponible: true },
          })
        : [];
      const cajasLotes = lotesRestantes.reduce((a, lote) => a + num0(lote.cajas_disponibles), 0);
      const pesoLotes = lotesRestantes.reduce((a, lote) => a + num0(lote.peso_disponible_lb), 0);
      const costoLotes = lotesRestantes.reduce((a, lote) => a + num0(lote.costo_disponible), 0);
      const valorRestante = anterior.costo == null ? null : anterior.cantidad * anterior.costo - grupo.costo;
      const costoPromedio = cantidadNueva > 0 && valorRestante != null && valorRestante >= 0
        ? r4(valorRestante / cantidadNueva)
        : (grupo.materiaPrima && cajasLotes > 0 ? r4(costoLotes / cajasLotes) : null);
      await tx.existencias.updateMany({
        where: { ubicacion_id: compra.ubicacion_id, product_id: grupo.productId },
        data: { cantidad_disponible: Math.max(0, cantidadNueva), costo_promedio: costoPromedio },
      });

      const ultimaLinea = await tx.compra_lineas.findFirst({
        where: { product_id: grupo.productId, compra: { negocio_id: negocioId } },
        orderBy: { id: 'desc' },
        select: { cajas: true, peso_total_lb: true, costo_total: true },
      });
      const cajasUltima = num0(ultimaLinea?.cajas);
      const ultimoCosto = cajasUltima > 0 ? r4(num0(ultimaLinea?.costo_total) / cajasUltima) : null;
      await tx.products.update({
        where: { id: grupo.productId },
        data: {
          ultimo_costo: ultimoCosto,
          peso_caja_lb: grupo.materiaPrima
            ? (cajasLotes > 0 ? r3(pesoLotes / cajasLotes) : (cajasUltima > 0 ? r3(num0(ultimaLinea?.peso_total_lb) / cajasUltima) : null))
            : undefined,
        },
      });
    }
    return { ok: true, total_revertido: num0(compra.total), lineas_revertidas: compra.lineas.length };
  }, { isolationLevel: 'Serializable' });
}

export async function guardarInventarioFinal(
  negocioId: bigint,
  usuarioId: bigint,
  input: { ubicacion_id: number; fecha: string; lineas: { product_id: number; cantidad: number }[] },
) {
  await asegurarSemanaEditable(negocioId, input.fecha);
  const ubicacionId = BigInt(input.ubicacion_id);
  const ubicacion = await prisma.ubicaciones.findFirst({ where: { id: ubicacionId, negocio_id: negocioId, tipo: 'bodega', activo: true } });
  if (!ubicacion) throw new HttpError(400, 'Almacén no válido');
  const ids = [...new Set(input.lineas.map((l) => BigInt(l.product_id)))];
  const productos = await prisma.products.findMany({ where: { id: { in: ids }, negocio_id: negocioId, activo: true } });
  if (productos.length !== ids.length) throw new HttpError(400, 'El inventario contiene productos no válidos');
  let ajustes = 0;
  const conteo = await prisma.$transaction(async (tx) => {
    const registro = await tx.conteos.create({
      data: {
        negocio_id: negocioId,
        ubicacion_id: ubicacionId,
        estado: 'cerrado',
        fecha: fecha(input.fecha),
        creado_por: usuarioId,
        cerrado_por: usuarioId,
        cerrado_at: new Date(),
        notas: 'inventario_final_operativo',
      },
    });
    if (input.lineas.length) {
      await tx.conteo_lineas.createMany({
        data: input.lineas.map((l) => {
          const producto = productos.find((p) => p.id === BigInt(l.product_id))!;
          return { conteo_id: registro.id, product_id: producto.id, qty: r3(l.cantidad), unidad_id: producto.unidad_distribucion_id, factor: 1, contado: true };
        }),
      });
    }
    for (const l of input.lineas) {
      const productId = BigInt(l.product_id);
      const producto = productos.find((p) => p.id === productId)!;
      let costoLotes: number | null = null;

      if (producto.tipo_operativo === 'materia_prima') {
        const lotes = await tx.lotes_materia_prima.findMany({
          where: { negocio_id: negocioId, ubicacion_id: ubicacionId, product_id: productId, cajas_disponibles: { gt: 0 } },
          orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
        });
        const cajasLotes = r3(lotes.reduce((a, lote) => a + num0(lote.cajas_disponibles), 0));
        const costoDisponible = lotes.reduce((a, lote) => a + num0(lote.costo_disponible), 0);
        costoLotes = cajasLotes > 0 ? r4(costoDisponible / cajasLotes) : null;
        if (l.cantidad > cajasLotes + 0.0001) {
          throw new HttpError(409, `${producto.nombre}: el físico (${l.cantidad}) supera las ${cajasLotes} cajas respaldadas por compras. Registra la compra faltante antes de cerrar inventario.`);
        }
        let faltanteFisico = r3(cajasLotes - l.cantidad);
        for (const lote of lotes) {
          if (faltanteFisico <= 0.0001) break;
          const disponibles = num0(lote.cajas_disponibles);
          const cajas = Math.min(faltanteFisico, disponibles);
          const proporcion = disponibles > 0 ? cajas / disponibles : 0;
          const peso = r3(num0(lote.peso_disponible_lb) * proporcion);
          const costo = r2(num0(lote.costo_disponible) * proporcion);
          await tx.conteo_ajustes_lote.create({ data: { conteo_id: registro.id, lote_id: lote.id, cajas: r3(cajas), peso_lb: peso, costo } });
          await tx.lotes_materia_prima.update({
            where: { id: lote.id },
            data: {
              cajas_disponibles: r3(disponibles - cajas),
              peso_disponible_lb: r3(num0(lote.peso_disponible_lb) - peso),
              costo_disponible: r2(num0(lote.costo_disponible) - costo),
            },
          });
          faltanteFisico = r3(faltanteFisico - cajas);
        }
      }

      const actual = await tx.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacionId, product_id: productId } } });
      const delta = r3(l.cantidad - num0(actual?.cantidad_disponible));
      if (Math.abs(delta) < 0.0001) continue;
      const costo = costoLotes ?? num(actual?.costo_promedio) ?? num(producto.ultimo_costo) ?? num(producto.costo_promedio);
      await aplicarMovimiento(tx, {
        negocioId, productId, tipo: delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo', cantidad: Math.abs(delta), usuarioId,
        origenId: delta < 0 ? ubicacionId : null, destinoId: delta > 0 ? ubicacionId : null, costoUnitario: costo,
        documentoTipo: 'conteo', documentoId: registro.id, comentario: `Inventario físico final · ${input.fecha}`,
        idempotencyKey: `inventario-final:${registro.id}:${productId}`,
        deltas: [{ ubicacionId, productId, disponible: delta, costoUnitario: costo }],
      });
      ajustes += 1;
    }
    return registro;
  }, { isolationLevel: 'Serializable' });
  return { ok: true, ajustes, inventario_id: Number(conteo.id) };
}

const claveInventarioLegacy = (key: string) => {
  const match = /^(inventario-final:\d+:\d{4}-\d{2}-\d{2}:\d+):\d+$/.exec(key);
  return match?.[1] ?? null;
};

/** Historial unificado de capturas nuevas y ajustes creados por la versión anterior. */
export async function listarInventariosFinales(negocioId: bigint, ubicacionId?: bigint) {
  const [conteos, legacy] = await Promise.all([
    prisma.conteos.findMany({
      where: { negocio_id: negocioId, ubicacion_id: ubicacionId, notas: 'inventario_final_operativo' },
      include: { ubicaciones: { select: { nombre: true } }, _count: { select: { lineas: true } }, lineas: { select: { product_id: true, qty: true } } },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      take: 50,
    }),
    prisma.movimientos_inventario.findMany({
      where: { negocio_id: negocioId, documento_tipo: 'inventario_final', documento_id: null, OR: ubicacionId ? [{ ubicacion_origen_id: ubicacionId }, { ubicacion_destino_id: ubicacionId }] : undefined },
      include: { ubicacion_origen: { select: { nombre: true } }, ubicacion_destino: { select: { nombre: true } } },
      orderBy: { id: 'desc' },
    }),
  ]);
  const gruposLegacy = new Map<string, { id: bigint; fecha: string; ubicacion: string; ajustes: number }>();
  for (const movimiento of legacy) {
    const clave = claveInventarioLegacy(movimiento.idempotency_key);
    if (!clave) continue;
    const partes = clave.split(':');
    const actual = gruposLegacy.get(clave);
    if (actual) actual.ajustes += 1;
    else gruposLegacy.set(clave, { id: movimiento.id, fecha: partes[2] ?? iso(movimiento.fecha), ubicacion: movimiento.ubicacion_origen?.nombre ?? movimiento.ubicacion_destino?.nombre ?? 'Almacén', ajustes: 1 });
  }
  return [
    ...conteos.map((c) => ({ id: `conteo-${c.id}`, fecha: c.fecha ? iso(c.fecha) : iso(c.creado_at), ubicacion: c.ubicaciones.nombre, ajustes: c._count.lineas, tipo: 'trazable' as const, lineas: c.lineas.map((l) => ({ product_id: Number(l.product_id), cantidad: num0(l.qty) })) })),
    ...[...gruposLegacy.values()].map((g) => ({ id: `legacy-${g.id}`, fecha: g.fecha, ubicacion: g.ubicacion, ajustes: g.ajustes, tipo: 'anterior' as const, lineas: null })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));
}

/** Elimina/revierte una captura completa, incluida la versión antigua sin documento_id. */
export async function eliminarInventarioFinal(negocioId: bigint, token: string) {
  if (token.startsWith('conteo-')) {
    const id = BigInt(token.slice('conteo-'.length));
    const conteo = await prisma.conteos.findFirst({ where: { id, negocio_id: negocioId, notas: 'inventario_final_operativo' } });
    if (!conteo) throw new HttpError(404, 'Inventario no encontrado');
    await asegurarSemanaEditable(negocioId, iso(conteo.fecha ?? conteo.creado_at));
    return eliminarConteo(negocioId, id);
  }
  if (!token.startsWith('legacy-')) throw new HttpError(400, 'Identificador de inventario no válido');
  const movimientoId = BigInt(token.slice('legacy-'.length));
  const muestra = await prisma.movimientos_inventario.findFirst({ where: { id: movimientoId, negocio_id: negocioId, documento_tipo: 'inventario_final', documento_id: null } });
  const clave = muestra ? claveInventarioLegacy(muestra.idempotency_key) : null;
  if (!muestra || !clave) throw new HttpError(404, 'Inventario anterior no encontrado');
  const fechaInventario = clave.split(':')[2];
  if (fechaInventario) await asegurarSemanaEditable(negocioId, fechaInventario);
  const movimientos = await prisma.movimientos_inventario.findMany({
    where: { negocio_id: negocioId, documento_tipo: 'inventario_final', documento_id: null, idempotency_key: { startsWith: `${clave}:` } },
  });
  await prisma.$transaction(async (tx) => {
    for (const movimiento of movimientos) {
      const ubicacion = movimiento.ubicacion_destino_id ?? movimiento.ubicacion_origen_id;
      if (!ubicacion) continue;
      const signo = movimiento.tipo === 'ajuste_negativo' ? -1 : 1;
      const reversa = -signo * num0(movimiento.cantidad);
      const existencia = await tx.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: ubicacion, product_id: movimiento.product_id } } });
      const siguiente = r3(num0(existencia?.cantidad_disponible) + reversa);
      if (siguiente < -0.0001) throw new HttpError(409, 'Este inventario ya fue utilizado. Revierte primero las operaciones posteriores para no dejar existencias negativas.');
      await tx.existencias.updateMany({ where: { ubicacion_id: ubicacion, product_id: movimiento.product_id }, data: { cantidad_disponible: Math.max(0, siguiente) } });
    }
    await tx.movimientos_inventario.deleteMany({ where: { id: { in: movimientos.map((m) => m.id) } } });
  }, { isolationLevel: 'Serializable' });
  return { ok: true, ajustes_revertidos: movimientos.length };
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
  await asegurarSemanaEditable(negocioId, input.fecha);
  if (input.cajas_materia_prima <= 0 || !input.salidas.length || input.salidas.some((s) => s.cajas <= 0)) throw new HttpError(400, 'La producción requiere entrada y salidas válidas');
  const ubicId = BigInt(input.ubicacion_id);
  const materiaId = BigInt(input.materia_prima_id);
  const fechaProduccion = fecha(input.fecha);
  const ubicacion = await prisma.ubicaciones.findFirst({ where: { id: ubicId, negocio_id: negocioId, codigo: 'CARN', tipo: 'bodega', activo: true } });
  if (!ubicacion) throw new HttpError(400, 'La producción solo puede registrarse en Carnicería');
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
  // Disponibilidad, consumo de lotes y movimientos viven dentro de una transacción
  // serializable: dos capturas simultáneas nunca pueden gastar la misma compra.
  const resultado = await prisma.$transaction(async (tx) => {
    const lotes = await tx.lotes_materia_prima.findMany({
      where: { negocio_id: negocioId, ubicacion_id: ubicId, product_id: materiaId, congelado: false, fecha: { lte: fechaProduccion }, cajas_disponibles: { gt: 0 } },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    });
    const [todosLosLotes, existenciaMateria] = await Promise.all([
      tx.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, ubicacion_id: ubicId, product_id: materiaId, cajas_disponibles: { gt: 0 } }, select: { cajas_disponibles: true } }),
      tx.existencias.findUnique({ where: { ubicacion_id_product_id: { ubicacion_id: ubicId, product_id: materiaId } } }),
    ]);
    const cajasLotes = r3(todosLosLotes.reduce((a, lote) => a + num0(lote.cajas_disponibles), 0));
    const cajasExistencia = r3(num0(existenciaMateria?.cantidad_disponible));
    if (Math.abs(cajasLotes - cajasExistencia) > 0.001) {
      throw new HttpError(409, `${materia.nombre} no está conciliado: lotes ${cajasLotes}, inventario ${cajasExistencia}. Corrige o elimina el inventario físico antes de producir.`);
    }
    const frescas = r3(lotes.reduce((a, lote) => a + num0(lote.cajas_disponibles), 0));
    if (frescas + 0.0001 < input.cajas_materia_prima) {
      throw new HttpError(409, `No hay suficiente ${materia.nombre} fresca para esa fecha. Disponible: ${frescas} cajas; solicitadas: ${input.cajas_materia_prima}.`);
    }

    const calculoFifo = calcularConsumoFifo(
      lotes.map((lote) => ({ cajas: num0(lote.cajas_disponibles), peso_lb: num0(lote.peso_disponible_lb), costo: num0(lote.costo_disponible) })),
      input.cajas_materia_prima,
    );
    if (calculoFifo.cajas_faltantes > 0.0001) throw new HttpError(409, 'Los lotes cambiaron mientras se registraba la producción; vuelve a intentarlo.');
    const consumos = calculoFifo.consumos.map((consumo) => ({ ...consumo, lote: lotes[consumo.indice]! }));
    const pesoEntrada = calculoFifo.peso_total;
    const costoEntrada = calculoFifo.costo_total;
    const salidas = input.salidas.map((s) => {
      const p = productos.find((x) => x.id === BigInt(s.product_id))!;
      const pesoCaja = num0(p.peso_caja_lb);
      return { input: s, producto: p, pesoCaja, pesoTotal: r3(s.cajas * pesoCaja) };
    });
    const pesoSalida = r3(salidas.reduce((a, s) => a + s.pesoTotal, 0));
    if (pesoSalida > pesoEntrada + 0.001) throw new HttpError(400, 'El peso producido no puede superar el peso de materia prima usado');
    const desperdicio = r3(Math.max(0, pesoEntrada - pesoSalida));
    const yieldPct = pesoEntrada > 0 ? r4((pesoSalida / pesoEntrada) * 100) : 0;

    const p = await tx.producciones.create({
      data: { negocio_id: negocioId, ubicacion_id: ubicId, materia_prima_id: materiaId, fecha: fechaProduccion, cajas_materia_prima: r3(input.cajas_materia_prima), peso_entrada_lb: pesoEntrada, costo_entrada: costoEntrada, peso_salida_lb: pesoSalida, desperdicio_lb: desperdicio, yield_porcentaje: yieldPct, registrado_por: usuarioId, notas: input.notas },
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
    return { p, pesoEntrada, pesoSalida, desperdicio, yieldPct, costoEntrada };
  }, { isolationLevel: 'Serializable' });
  return { id: Number(resultado.p.id), peso_entrada_lb: resultado.pesoEntrada, peso_salida_lb: resultado.pesoSalida, desperdicio_lb: resultado.desperdicio, yield_porcentaje: resultado.yieldPct, costo_total: resultado.costoEntrada };
}

export async function resumenProduccion(negocioId: bigint, desde?: string, hasta?: string) {
  const rango = desde || hasta ? { gte: desde ? fecha(desde) : undefined, lte: hasta ? fecha(hasta) : undefined } : undefined;
  const [compras, producciones, lotes] = await Promise.all([
    prisma.compras.findMany({ where: { negocio_id: negocioId, fecha: rango }, include: { proveedor: true, lineas: { include: { producto: true } } }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], take: 100 }),
    prisma.producciones.findMany({ where: { negocio_id: negocioId, fecha: rango }, include: { materia_prima: true, salidas: { include: { producto: true } } }, orderBy: [{ fecha: 'desc' }, { id: 'desc' }], take: 100 }),
    prisma.lotes_materia_prima.findMany({ where: { negocio_id: negocioId, cajas_disponibles: { gt: 0 } }, include: { producto: true }, orderBy: [{ congelado: 'asc' }, { fecha: 'asc' }] }),
  ]);
  return {
    compras: compras.map((c) => ({ id: Number(c.id), fecha: iso(c.fecha), vence_at: iso(c.vence_at), proveedor: c.proveedor.nombre, referencia: c.referencia, total: num0(c.total), estado: c.estado, lineas: c.lineas.map((l) => ({ producto: l.producto.nombre, cajas: num0(l.cajas), peso_lb: num0(l.peso_total_lb), costo: num0(l.costo_total), congelado: l.congelado })) })),
    producciones: producciones.map((p) => ({ id: Number(p.id), fecha: iso(p.fecha), materia_prima: p.materia_prima.nombre, cajas_entrada: num0(p.cajas_materia_prima), peso_entrada_lb: num0(p.peso_entrada_lb), peso_salida_lb: num0(p.peso_salida_lb), desperdicio_lb: num0(p.desperdicio_lb), yield: num0(p.yield_porcentaje), costo: num0(p.costo_entrada), salidas: p.salidas.map((s) => ({ producto: s.producto.nombre, cajas: num0(s.cajas), costo_caja: num0(s.costo_caja), precio: num0(s.precio_venta_caja) })) })),
    lotes: lotes.map((l) => ({ id: Number(l.id), fecha: iso(l.fecha), producto: l.producto.nombre, product_id: Number(l.product_id), cajas: num0(l.cajas_disponibles), peso_lb: num0(l.peso_disponible_lb), costo: num0(l.costo_disponible), congelado: l.congelado })),
  };
}
