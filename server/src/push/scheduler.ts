import { prisma } from '../db.js';
import { autoCerrarTransitoVencido } from '../distribuciones/service.js';
import { avisarAdminRezagados, enviarAUsuarios, pushHabilitado, usuariosDeUbicacion } from './service.js';

// Hora del negocio a partir de la cual se manda el aviso "hoy toca pedido" a sucursales.
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

/** Sucursales/líneas programadas hoy que todavía no tienen una venta confirmada. */
async function pedidosPendientes(negocioId: bigint, hoyISO: string, dia: number) {
  const plantillas = await prisma.plantillas_ruta.findMany({
    where: { negocio_id: negocioId, dia_semana: dia, activo: true },
    include: { paradas: { where: { opcional: false }, select: { ubicacion_id: true } } },
  });
  if (!plantillas.length) return [];
  const sucursales = await prisma.ubicaciones.findMany({
    where: { negocio_id: negocioId, tipo: 'sucursal', activo: true, empresa_cliente_id: { not: null } },
  });
  const pedidos = await prisma.pedidos_operativos.findMany({
    where: {
      negocio_id: negocioId,
      fecha_entrega: new Date(`${hoyISO}T00:00:00.000Z`),
      estado: { notIn: ['borrador', 'cancelado'] },
    },
    select: { ubicacion_id: true, linea_operacion: true },
  });
  const capturados = new Set(pedidos.map((p) => `${p.ubicacion_id}:${p.linea_operacion}`));
  const pendientes: { sucursal: (typeof sucursales)[number]; linea: 'carne' | 'desechables' }[] = [];
  const agregados = new Set<string>();
  for (const plantilla of plantillas) {
    const destinos = new Set(plantilla.paradas.map((p) => p.ubicacion_id.toString()));
    for (const sucursal of sucursales) {
      const destino = sucursal.entrega_en_ubicacion_id ?? sucursal.id;
      const clave = `${sucursal.id}:${plantilla.linea_operacion}`;
      if (destinos.has(destino.toString()) && !capturados.has(clave) && !agregados.has(clave)) {
        pendientes.push({ sucursal, linea: plantilla.linea_operacion });
        agregados.add(clave);
      }
    }
  }
  return pendientes;
}

/**
 * Una vez al día (en día programado, a partir de HORA_AVISO en la zona del negocio) avisa a las
 * sucursales que aún no han cerrado su pedido de hoy. Idempotente vía aviso_inventario_at.
 * Más tarde (HORA_REZAGADOS) avisa al admin de las que siguen pendientes (aviso_rezagados_at).
 */
export async function tickAvisos() {
  if (!pushHabilitado) return;
  const ahora = new Date();
  const negocios = await prisma.negocios.findMany();

  for (const n of negocios) {
    const tz = n.zona_horaria;
    const dia = diaSemanaEnTz(ahora, tz);
    const hora = horaEnTz(ahora, tz);
    if (hora < HORA_AVISO) continue;
    const hoy = fechaISOEnTz(ahora, tz);

    // 1) Aviso temprano a las sucursales pendientes (una vez al día).
    if (!n.aviso_inventario_at || n.aviso_inventario_at.toISOString().slice(0, 10) !== hoy) {
      // Marca primero para evitar doble envío si hay solapamiento.
      await prisma.negocios.update({ where: { id: n.id }, data: { aviso_inventario_at: new Date(`${hoy}T00:00:00.000Z`) } });
      const pendientes = await pedidosPendientes(n.id, hoy, dia);
      const porSucursal = new Map<string, { sucursal: (typeof pendientes)[number]['sucursal']; lineas: string[] }>();
      for (const p of pendientes) {
        const actual = porSucursal.get(p.sucursal.id.toString()) ?? { sucursal: p.sucursal, lineas: [] };
        actual.lineas.push(p.linea);
        porSucursal.set(p.sucursal.id.toString(), actual);
      }
      for (const { sucursal, lineas } of porSucursal.values()) {
        const usuarios = await usuariosDeUbicacion(sucursal.id);
        await enviarAUsuarios(usuarios, { titulo: 'Hoy toca pedido 📋', cuerpo: `Captura ${lineas.join(' y ')} para ${sucursal.nombre}.`, url: '/pedidos' });
      }
    }

    // 2) Aviso al admin de rezagados, más tarde y una sola vez al día.
    if (hora >= HORA_REZAGADOS && (!n.aviso_rezagados_at || n.aviso_rezagados_at.toISOString().slice(0, 10) !== hoy)) {
      await prisma.negocios.update({ where: { id: n.id }, data: { aviso_rezagados_at: new Date(`${hoy}T00:00:00.000Z`) } });
      const pendientes = await pedidosPendientes(n.id, hoy, dia);
      await avisarAdminRezagados(n.id, new Set(pendientes.map((p) => p.sucursal.id.toString())).size);
    }
  }
}

/** Cierra el tránsito sin confirmar de cada negocio que tenga el auto-cierre activado. */
export async function tickAutoCierre() {
  const negocios = await prisma.negocios.findMany({ where: { auto_cierre_horas: { gt: 0 } }, select: { id: true, auto_cierre_horas: true } });
  for (const n of negocios) {
    await autoCerrarTransitoVencido(n.id, n.auto_cierre_horas).catch((error) => console.error('Error en auto-cierre de tránsito', error));
  }
}

async function tick() {
  await tickAvisos().catch((error) => console.error('Error enviando avisos de pedidos', error));
  await tickAutoCierre().catch((error) => console.error('Error ejecutando auto-cierre', error));
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Arranca el chequeo periódico: avisos de pedido (si hay push) + auto-cierre de tránsito. */
export function iniciarAvisos() {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), CADA_MS);
  console.log('🔔 Scheduler activo (avisos de pedido + auto-cierre de tránsito).');
}
