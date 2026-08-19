import { readFileSync } from 'node:fs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { esErrorPrisma } from '../lib/transaccion.js';
import { pushHabilitado } from './service.js';

const RELEASE_ENV_KEYS = [
  'APP_RELEASE_ID',
  'RENDER_GIT_COMMIT',
  'SOURCE_VERSION',
  'GIT_COMMIT_SHA',
  'COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'RAILWAY_GIT_COMMIT_SHA',
  'HEROKU_SLUG_COMMIT',
] as const;

type ReleaseEnv = Partial<Record<(typeof RELEASE_ENV_KEYS)[number], string | undefined>>;

/** Prioriza un ID configurado y después los nombres comunes de las plataformas de deploy. */
export function resolverReleaseId(values: ReleaseEnv): string | null {
  for (const key of RELEASE_ENV_KEYS) {
    const value = values[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function releaseIdActual() {
  const configurado = resolverReleaseId({
    APP_RELEASE_ID: env.APP_RELEASE_ID,
    RENDER_GIT_COMMIT: process.env.RENDER_GIT_COMMIT,
    SOURCE_VERSION: process.env.SOURCE_VERSION,
    GIT_COMMIT_SHA: process.env.GIT_COMMIT_SHA,
    COMMIT_SHA: process.env.COMMIT_SHA,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA,
    RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
    HEROKU_SLUG_COMMIT: process.env.HEROKU_SLUG_COMMIT,
  });
  if (configurado) return configurado;
  try {
    // El Dockerfile escribe este archivo durante el build. Así Coolify no depende de exponer
    // una variable de commit y los reinicios de la misma imagen siguen siendo idempotentes.
    const generado = readFileSync(new URL('../../release-id', import.meta.url), 'utf8').trim();
    return generado || null;
  } catch {
    return null;
  }
}

/**
 * Registra una sola notificación por release y negocio para cada usuario activo. La cola existente
 * se encarga del envío, los reintentos y la limpieza de suscripciones vencidas.
 */
export async function registrarAvisoDeploy() {
  if (!pushHabilitado) return { registrado: 0, omitido: 'push_deshabilitado' as const };
  const releaseId = releaseIdActual();
  if (!releaseId) {
    console.warn('⚠️ Aviso de deploy omitido: configura APP_RELEASE_ID o expón el SHA del commit en el entorno.');
    return { registrado: 0, omitido: 'release_sin_identificar' as const };
  }

  const negocios = await prisma.negocios.findMany({ select: { id: true } });
  let registrado = 0;
  for (const negocio of negocios) {
    const dedupeKey = `deploy:${releaseId}`;
    try {
      await prisma.$transaction(async (tx) => {
        const evento = await tx.notificacion_eventos.create({
          data: {
            negocio_id: negocio.id,
            tipo: 'app_actualizada',
            entidad: 'deploy',
            dedupe_key: dedupeKey,
            titulo: 'Hay una actualización en la app 🚀',
            cuerpo: 'La aplicación se actualizó. Ábrela para cargar la nueva versión.',
            url: '/',
            datos: { release_id: releaseId } as Prisma.InputJsonValue,
          },
        });
        const usuarios = await tx.usuarios.findMany({
          where: { negocio_id: negocio.id, activo: true },
          select: { id: true },
        });
        if (usuarios.length) {
          await tx.notificacion_entregas.createMany({
            data: usuarios.map((usuario) => ({ evento_id: evento.id, usuario_id: usuario.id, canal: 'web_push' })),
          });
        }
      });
      registrado += 1;
    } catch (error) {
      // Dos instancias que arranquen juntas pueden competir por el mismo release. La restricción
      // única deja una sola notificación; cualquier otro error sí debe verse en los logs.
      if (!esErrorPrisma(error, 'P2002')) throw error;
    }
  }
  return { registrado, releaseId };
}
