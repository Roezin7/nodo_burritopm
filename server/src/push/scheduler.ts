import { prisma } from '../db.js';
import { autoCerrarTransitoVencido } from '../distribuciones/service.js';
import { avisarAdminRezagados, enviarAUsuarios, pushHabilitado, usuariosDeUbicacion } from './service.js';

// Hora del negocio a partir de la cual se manda el aviso "hoy toca inventario".
const HORA_AVISO = 8;
// Hora a partir de la cual, si aún faltan sucursales por cerrar, se avisa al admin.
const HORA_REZAGADOS = 11;
const CADA_MS = 15 * 60 * 1000; // revisa cada 15 min

const fechaISOEnTz = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const diaSemanaEnTz = (d: Date, tz: string) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d));
const horaEnTz = (d: Date, tz: string) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(d));

/** Sucursales activas de un negocio sin inventario cerrado en la fecha dada (ISO yyyy-mm-dd). */
async function sucursalesSinCerrar(negocioId: bigint, hoyISO: string) {
  const sucursales = await prisma.ubicaciones.findMany({ where: { negocio_id: negocioId, tipo: 'sucursal', activo: true } });
  const pendientes = [];
  for (const s of sucursales) {
    const cerrado = await prisma.conteos.findFirst({
      where: { ubicacion_id: s.id, fecha: new Date(`${hoyISO}T00:00:00.000Z`), estado: 'cerrado' },
      select: { id: true },
    });
    if (!cerrado) pendientes.push(s);
  }
  return pendientes;
}

/**
 * Una vez al día (en día programado, a partir de HORA_AVISO en la zona del negocio) avisa a las
 * sucursales que aún no han cerrado su inventario de hoy. Idempotente vía aviso_inventario_at.
 * Más tarde (HORA_REZAGADOS) avisa al admin de las que siguen pendientes (aviso_rezagados_at).
 */
export async function tickAvisos() {
  if (!pushHabilitado) return;
  const ahora = new Date();
  const negocios = await prisma.negocios.findMany();

  for (const n of negocios) {
    const tz = n.zona_horaria;
    if (!n.inventario_dias.includes(diaSemanaEnTz(ahora, tz))) continue;
    const hora = horaEnTz(ahora, tz);
    if (hora < HORA_AVISO) continue;
    const hoy = fechaISOEnTz(ahora, tz);

    // 1) Aviso temprano a las sucursales pendientes (una vez al día).
    if (!n.aviso_inventario_at || n.aviso_inventario_at.toISOString().slice(0, 10) !== hoy) {
      // Marca primero para evitar doble envío si hay solapamiento.
      await prisma.negocios.update({ where: { id: n.id }, data: { aviso_inventario_at: new Date(`${hoy}T00:00:00.000Z`) } });
      for (const s of await sucursalesSinCerrar(n.id, hoy)) {
        const usuarios = await usuariosDeUbicacion(s.id);
        await enviarAUsuarios(usuarios, { titulo: 'Hoy toca inventario 📋', cuerpo: `Captura el inventario de ${s.nombre}.`, url: '/inventario' });
      }
    }

    // 2) Aviso al admin de rezagados, más tarde y una sola vez al día.
    if (hora >= HORA_REZAGADOS && (!n.aviso_rezagados_at || n.aviso_rezagados_at.toISOString().slice(0, 10) !== hoy)) {
      await prisma.negocios.update({ where: { id: n.id }, data: { aviso_rezagados_at: new Date(`${hoy}T00:00:00.000Z`) } });
      const pendientes = await sucursalesSinCerrar(n.id, hoy);
      await avisarAdminRezagados(n.id, pendientes.length);
    }
  }
}

/** Cierra el tránsito sin confirmar de cada negocio que tenga el auto-cierre activado. */
export async function tickAutoCierre() {
  const negocios = await prisma.negocios.findMany({ where: { auto_cierre_horas: { gt: 0 } }, select: { id: true, auto_cierre_horas: true } });
  for (const n of negocios) {
    await autoCerrarTransitoVencido(n.id, n.auto_cierre_horas).catch(() => {});
  }
}

async function tick() {
  await tickAvisos().catch(() => {});
  await tickAutoCierre().catch(() => {});
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Arranca el chequeo periódico: avisos de inventario (si hay push) + auto-cierre de tránsito. */
export function iniciarAvisos() {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), CADA_MS);
  console.log('🔔 Scheduler activo (avisos de inventario + auto-cierre de tránsito).');
}
