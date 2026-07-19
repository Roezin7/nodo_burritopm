import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

interface OpcionesTransaccion {
  maxWait?: number;
  timeout?: number;
  reintentos?: number;
  reintentarUnico?: boolean;
}

export function esErrorPrisma(error: unknown, codigo: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === codigo;
}

/**
 * PostgreSQL puede abortar correctamente una transacción Serializable cuando dos capturas
 * compiten. Reintentamos la unidad completa para que esa protección no se convierta en un 500
 * visible ni obligue al usuario a volver a capturar.
 */
export async function transaccionSerializable<T>(
  trabajo: (tx: Prisma.TransactionClient) => Promise<T>,
  opciones: OpcionesTransaccion = {},
): Promise<T> {
  const { maxWait = 5_000, timeout = 20_000, reintentos = 3, reintentarUnico = false } = opciones;
  for (let intento = 0; ; intento += 1) {
    try {
      return await prisma.$transaction(trabajo, { isolationLevel: 'Serializable', maxWait, timeout });
    } catch (error) {
      const reintentable = esErrorPrisma(error, 'P2034') || (reintentarUnico && esErrorPrisma(error, 'P2002'));
      if (!reintentable || intento >= reintentos) throw error;
    }
  }
}
