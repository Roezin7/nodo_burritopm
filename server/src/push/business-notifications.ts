import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export interface AvisoAdminOperacion {
  tipo: string;
  entidad: string;
  entidadId?: bigint | number | null;
  dedupeKey: string;
  titulo: string;
  cuerpo: string;
  url: string;
  actorId?: bigint | number | null;
  datos?: Record<string, unknown>;
}

/**
 * Registra un evento operativo y lo encola para todos los administradores activos.
 * La escritura es independiente del envío: el scheduler se encarga de entregar,
 * reintentar y limpiar suscripciones vencidas.
 */
export async function registrarAvisoAdmins(negocioId: bigint, aviso: AvisoAdminOperacion) {
  const admins = await prisma.usuarios.findMany({
    where: { negocio_id: negocioId, rol: 'admin', activo: true },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    const evento = await tx.notificacion_eventos.create({
      data: {
        negocio_id: negocioId,
        tipo: aviso.tipo,
        entidad: aviso.entidad,
        entidad_id: aviso.entidadId == null ? null : BigInt(aviso.entidadId),
        actor_id: aviso.actorId == null ? null : BigInt(aviso.actorId),
        dedupe_key: aviso.dedupeKey,
        titulo: aviso.titulo,
        cuerpo: aviso.cuerpo,
        url: aviso.url,
        datos: (aviso.datos ?? {}) as Prisma.InputJsonValue,
      },
    });
    if (!admins.length) return;
    const suscritos = await tx.push_subscriptions.findMany({
      where: { usuario_id: { in: admins.map((admin) => admin.id) } },
      select: { usuario_id: true },
      distinct: ['usuario_id'],
    });
    if (suscritos.length) {
      await tx.notificacion_entregas.createMany({
        data: suscritos.map((suscrito) => ({ evento_id: evento.id, usuario_id: suscrito.usuario_id, canal: 'web_push' })),
      });
    }
  });
}

/** No debe fallar la operación principal por un problema temporal del canal push. */
export async function registrarAvisoAdminsBestEffort(negocioId: bigint, aviso: AvisoAdminOperacion) {
  try {
    await registrarAvisoAdmins(negocioId, aviso);
  } catch (error) {
    console.error('No se pudo registrar notificación operativa', { tipo: aviso.tipo, dedupeKey: aviso.dedupeKey, error });
  }
}
