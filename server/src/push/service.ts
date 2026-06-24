import webpush from 'web-push';
import { prisma } from '../db.js';
import { env } from '../env.js';

export const pushHabilitado = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

if (pushHabilitado) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export interface AvisoPush {
  titulo: string;
  cuerpo: string;
  url?: string;
}

/** Guarda (o actualiza) la suscripción de un dispositivo para un usuario. */
export async function guardarSuscripcion(
  negocioId: bigint,
  usuarioId: bigint,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
) {
  await prisma.push_subscriptions.upsert({
    where: { endpoint: sub.endpoint },
    create: { negocio_id: negocioId, usuario_id: usuarioId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { usuario_id: usuarioId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function borrarSuscripcion(endpoint: string) {
  await prisma.push_subscriptions.deleteMany({ where: { endpoint } });
}

/** Envía un aviso a todos los dispositivos de una lista de usuarios. Best-effort. */
export async function enviarAUsuarios(usuarioIds: bigint[], aviso: AvisoPush) {
  if (!pushHabilitado || usuarioIds.length === 0) return;
  const subs = await prisma.push_subscriptions.findMany({ where: { usuario_id: { in: usuarioIds } } });
  if (subs.length === 0) return;
  const payload = JSON.stringify(aviso);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (e: unknown) {
        // 404/410 = suscripción muerta → la limpiamos.
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await borrarSuscripcion(s.endpoint);
      }
    }),
  );
}

/** Usuarios activos asignados a una ubicación (para avisarles). */
export async function usuariosDeUbicacion(ubicacionId: bigint): Promise<bigint[]> {
  const filas = await prisma.usuario_ubicaciones.findMany({
    where: { ubicacion_id: ubicacionId, usuarios: { activo: true } },
    select: { usuario_id: true },
  });
  return filas.map((f) => f.usuario_id);
}

/** Notifica a las sucursales destino de una distribución que su pedido va en camino. */
export async function avisarPedidoEnCamino(distId: bigint) {
  if (!pushHabilitado) return;
  const lineas = await prisma.distribucion_lineas.findMany({
    where: { distribucion_id: distId },
    select: { ubicacion_destino_id: true },
    distinct: ['ubicacion_destino_id'],
  });
  for (const l of lineas) {
    const usuarios = await usuariosDeUbicacion(l.ubicacion_destino_id);
    await enviarAUsuarios(usuarios, { titulo: 'Tu pedido va en camino 🚚', cuerpo: 'Prepárate para recibirlo y confirmar la entrega.', url: '/recepcion' });
  }
}

/** Notifica a una sucursal que llegó su entrega y debe confirmar la recepción. */
export async function avisarConfirmarRecepcion(ubicacionId: bigint) {
  if (!pushHabilitado) return;
  const usuarios = await usuariosDeUbicacion(ubicacionId);
  await enviarAUsuarios(usuarios, { titulo: 'Llegó tu pedido 📦', cuerpo: 'Confirma tu recepción en la app.', url: '/recepcion' });
}
