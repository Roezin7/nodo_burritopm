import type { LineaOperacion, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { rangoSemana } from '../operacion/conciliacion.js';
import { enviarPushAUsuario, pushHabilitado } from './service.js';

export interface DetallePedidoNotificacion {
  product_id: number;
  nombre: string;
  cantidad: number;
  notas?: string | null;
}

export interface CambioPedido {
  product_id: number;
  nombre: string;
  anterior: number;
  nuevo: number;
  notas_anteriores: string | null;
  notas_nuevas: string | null;
}

/** Compara el contenido real del pedido, ignorando el orden de llegada del JSON. */
export function diferenciasPedido(
  anterior: DetallePedidoNotificacion[],
  nuevo: DetallePedidoNotificacion[],
): CambioPedido[] {
  const porProducto = new Map<number, { anterior?: DetallePedidoNotificacion; nuevo?: DetallePedidoNotificacion }>();
  for (const detalle of anterior) porProducto.set(detalle.product_id, { ...porProducto.get(detalle.product_id), anterior: detalle });
  for (const detalle of nuevo) porProducto.set(detalle.product_id, { ...porProducto.get(detalle.product_id), nuevo: detalle });
  return [...porProducto.entries()]
    .map(([productId, valores]) => {
      const antes = valores.anterior;
      const despues = valores.nuevo;
      const cantidadAnterior = antes?.cantidad ?? 0;
      const cantidadNueva = despues?.cantidad ?? 0;
      const notasAnteriores = antes?.notas ?? null;
      const notasNuevas = despues?.notas ?? null;
      if (cantidadAnterior === cantidadNueva && notasAnteriores === notasNuevas) return null;
      return {
        product_id: productId,
        nombre: despues?.nombre ?? antes?.nombre ?? `Producto ${productId}`,
        anterior: cantidadAnterior,
        nuevo: cantidadNueva,
        notas_anteriores: notasAnteriores,
        notas_nuevas: notasNuevas,
      };
    })
    .filter((cambio): cambio is CambioPedido => cambio != null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

interface RegistrarCambioPedidoInput {
  negocioId: bigint;
  usuarioId: bigint;
  pedido: { id: bigint; actualizado_at: Date; estado: string };
  ubicacion: { id: bigint; nombre: string };
  linea: LineaOperacion;
  fechaEntrega: string;
  estadoAnterior: string | null;
  notasAnteriores: string | null | undefined;
  notasNuevas: string | null | undefined;
  anterior: DetallePedidoNotificacion[];
  nuevo: DetallePedidoNotificacion[];
  tx: Prisma.TransactionClient;
}

const ESTADOS_PROCESADOS = new Set(['en_preparacion', 'despachado', 'entregado', 'cerrado']);

/** Registra el evento y sus destinatarios dentro de la misma transacción del pedido. */
export async function registrarCambioPedidoEnTx(input: RegistrarCambioPedidoInput) {
  const cambios = diferenciasPedido(input.anterior, input.nuevo);
  const notasCambiaron = (input.notasAnteriores ?? null) !== (input.notasNuevas ?? null);
  const estadoCambio = input.estadoAnterior !== input.pedido.estado;
  if (!cambios.length && !notasCambiaron && !estadoCambio) return null;

  const procesado = input.estadoAnterior != null && ESTADOS_PROCESADOS.has(input.estadoAnterior);
  const fueConfirmado = input.estadoAnterior == null || input.estadoAnterior === 'borrador';
  const tipo = procesado ? 'pedido_corregido_procesado' : fueConfirmado ? 'pedido_confirmado' : 'pedido_modificado';
  const titulo = tipo === 'pedido_confirmado'
    ? 'Pedido confirmado 📋'
    : tipo === 'pedido_corregido_procesado'
      ? 'Pedido procesado corregido ⚠️'
      : 'Pedido modificado ✏️';
  const resumen = cambios.length
    ? `${cambios.length} producto${cambios.length === 1 ? '' : 's'} cambiado${cambios.length === 1 ? '' : 's'}`
    : 'Se modificaron las notas';
  const cuerpo = `${input.ubicacion.nombre} · ${input.fechaEntrega} · ${input.linea}: ${resumen}.`;
  const dedupeKey = `pedido:${input.pedido.id.toString()}:${input.pedido.actualizado_at.toISOString()}:${tipo}`;
  const datos = {
    pedido_id: Number(input.pedido.id),
    ubicacion_id: Number(input.ubicacion.id),
    ubicacion: input.ubicacion.nombre,
    linea: input.linea,
    fecha_entrega: input.fechaEntrega,
    estado_anterior: input.estadoAnterior,
    estado_nuevo: input.pedido.estado,
    usuario_id: Number(input.usuarioId),
    notas_anteriores: input.notasAnteriores ?? null,
    notas_nuevas: input.notasNuevas ?? null,
    cambios,
  } as unknown as Prisma.InputJsonValue;

  const evento = await input.tx.notificacion_eventos.create({
    data: {
      negocio_id: input.negocioId,
      tipo,
      entidad: 'pedido_operativo',
      entidad_id: input.pedido.id,
      actor_id: input.usuarioId,
      dedupe_key: dedupeKey,
      titulo,
      cuerpo,
      url: `/semana/ventas?semana=${rangoSemana(input.fechaEntrega).desde}&linea=${input.linea}`,
      datos,
    },
  });

  const admins = await input.tx.usuarios.findMany({
    where: { negocio_id: input.negocioId, rol: 'admin', activo: true },
    select: { id: true },
  });
  const adminsConPush = admins.length
    ? await input.tx.push_subscriptions.findMany({
        where: { usuario_id: { in: admins.map((admin) => admin.id) } },
        select: { usuario_id: true },
        distinct: ['usuario_id'],
      })
    : [];
  if (adminsConPush.length) {
    await input.tx.notificacion_entregas.createMany({
      data: adminsConPush.map((suscripcion) => ({ evento_id: evento.id, usuario_id: suscripcion.usuario_id, canal: 'web_push' })),
    });
  }
  return evento;
}

function siguienteIntento(intentos: number) {
  const espera = Math.min(30 * 60 * 1000, 5_000 * (2 ** Math.min(intentos, 8)));
  return new Date(Date.now() + espera);
}

/** Consume la cola sin bloquear pedidos. La reclamación por estado evita dobles envíos. */
export async function procesarNotificaciones(limit = 100) {
  if (!pushHabilitado) return { procesadas: 0, enviadas: 0, reintentos: 0 };
  const ahora = new Date();
  const candidatas = await prisma.notificacion_entregas.findMany({
    where: { canal: 'web_push', estado: { in: ['pendiente', 'fallida'] }, disponible_at: { lte: ahora } },
    include: { evento: true },
    orderBy: { id: 'asc' },
    take: limit,
  });
  let enviadas = 0;
  let reintentos = 0;
  for (const candidata of candidatas) {
    const reclamada = await prisma.notificacion_entregas.updateMany({
      where: { id: candidata.id, estado: { in: ['pendiente', 'fallida'] }, disponible_at: { lte: ahora } },
      data: { estado: 'enviando', intentos: { increment: 1 } },
    });
    if (reclamada.count !== 1) continue;
    try {
      const resultado = await enviarPushAUsuario(candidata.usuario_id, {
        titulo: candidata.evento.titulo,
        cuerpo: candidata.evento.cuerpo,
        url: candidata.evento.url ?? '/',
      });
      if (resultado.suscripciones === 0) {
        await prisma.notificacion_entregas.update({ where: { id: candidata.id }, data: { estado: 'sin_suscripcion', enviado_at: new Date(), ultimo_error: null } });
      } else if (resultado.enviadas > 0) {
        await prisma.notificacion_entregas.update({ where: { id: candidata.id }, data: { estado: 'enviada', enviado_at: new Date(), ultimo_error: resultado.fallidas ? `${resultado.fallidas} dispositivo(s) no respondieron` : null } });
        enviadas += 1;
      } else {
        throw new Error('Ningún dispositivo aceptó el aviso');
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido al enviar Web Push';
      await prisma.notificacion_entregas.update({
        where: { id: candidata.id },
        data: { estado: 'fallida', disponible_at: siguienteIntento(candidata.intentos + 1), ultimo_error: mensaje.slice(0, 500) },
      });
      reintentos += 1;
    }
  }
  return { procesadas: candidatas.length, enviadas, reintentos };
}
