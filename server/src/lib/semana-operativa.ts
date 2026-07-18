import { prisma } from '../db.js';
import { HttpError } from '../middleware/error.js';

const fecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Protege la contabilidad histórica. Una semana cerrada solo puede modificarse después de
 * reabrirla desde Cierre; de lo contrario compras, producción e inventario dejan de coincidir
 * con las facturas ya emitidas.
 */
export async function asegurarSemanaEditable(negocioId: bigint, fechaIso: string) {
  const dia = fecha(fechaIso);
  const semana = await prisma.semanas_operativas.findFirst({
    where: { negocio_id: negocioId, inicia_at: { lte: dia }, termina_at: { gte: dia } },
    select: { estado: true, semana: true },
  });
  if (semana?.estado === 'cerrada') {
    throw new HttpError(409, `La semana ${semana.semana} está cerrada. Reábrela antes de modificar su operación.`);
  }
  return semana;
}

export async function asegurarRangoEditable(negocioId: bigint, desde: string, hasta: string) {
  const cerrada = await prisma.semanas_operativas.findFirst({
    where: {
      negocio_id: negocioId,
      estado: 'cerrada',
      inicia_at: { lte: fecha(hasta) },
      termina_at: { gte: fecha(desde) },
    },
    select: { semana: true },
  });
  if (cerrada) {
    throw new HttpError(409, `La semana ${cerrada.semana} está cerrada. Reábrela antes de modificar su operación.`);
  }
}
