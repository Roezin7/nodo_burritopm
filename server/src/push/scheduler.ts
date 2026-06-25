import { prisma } from '../db.js';
import { enviarAUsuarios, pushHabilitado, usuariosDeUbicacion } from './service.js';

// Hora del negocio a partir de la cual se manda el aviso "hoy toca inventario".
const HORA_AVISO = 8;
const CADA_MS = 15 * 60 * 1000; // revisa cada 15 min

const fechaISOEnTz = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const diaSemanaEnTz = (d: Date, tz: string) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d));
const horaEnTz = (d: Date, tz: string) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(d));

/**
 * Una vez al día (en día programado, a partir de HORA_AVISO en la zona del negocio) avisa a las
 * sucursales que aún no han cerrado su inventario de hoy. Idempotente vía aviso_inventario_at.
 */
export async function tickAvisos() {
  if (!pushHabilitado) return;
  const ahora = new Date();
  const negocios = await prisma.negocios.findMany();

  for (const n of negocios) {
    const tz = n.zona_horaria;
    if (!n.inventario_dias.includes(diaSemanaEnTz(ahora, tz))) continue;
    if (horaEnTz(ahora, tz) < HORA_AVISO) continue;
    const hoy = fechaISOEnTz(ahora, tz);
    if (n.aviso_inventario_at && n.aviso_inventario_at.toISOString().slice(0, 10) === hoy) continue;

    // Marca primero para evitar doble envío si hay solapamiento.
    await prisma.negocios.update({ where: { id: n.id }, data: { aviso_inventario_at: new Date(`${hoy}T00:00:00.000Z`) } });

    const sucursales = await prisma.ubicaciones.findMany({ where: { negocio_id: n.id, tipo: 'sucursal', activo: true } });
    for (const s of sucursales) {
      const cerrado = await prisma.conteos.findFirst({
        where: { ubicacion_id: s.id, fecha: new Date(`${hoy}T00:00:00.000Z`), estado: 'cerrado' },
        select: { id: true },
      });
      if (cerrado) continue;
      const usuarios = await usuariosDeUbicacion(s.id);
      await enviarAUsuarios(usuarios, { titulo: 'Hoy toca inventario 📋', cuerpo: `Captura el inventario de ${s.nombre}.`, url: '/inventario' });
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Arranca el chequeo periódico (no-op si el push está deshabilitado). */
export function iniciarAvisos() {
  if (!pushHabilitado || timer) return;
  void tickAvisos().catch(() => {});
  timer = setInterval(() => void tickAvisos().catch(() => {}), CADA_MS);
  console.log('🔔 Scheduler de avisos de inventario activo.');
}
