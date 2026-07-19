import { useEffect, useState } from 'react';
import { openDB, type IDBPDatabase } from 'idb';

// Cola limitada a capturas idempotentes. Movimientos financieros, carga, recepción, cierres y
// eliminaciones requieren confirmación inmediata del servidor y nunca deben reproducirse tarde.

export interface PendingReq {
  id?: number;
  method: string;
  path: string; // sin el prefijo /api
  body?: unknown;
  token: string | null;
  ts: number;
  intentos?: number;
  pausado?: boolean;
}

// Tope de reintentos ante error de servidor (5xx) antes de darlo por atorado: sin esto, una
// captura que el servidor rechaza de forma persistente (no transitoria) bloquea el resto de
// la cola para siempre, reintentando cada 15s sin fin.
const MAX_INTENTOS_5XX = 8;

const DB_NAME = 'bpm-offline';
const STORE = 'cola';
const STORE_FALLOS = 'fallidos';

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, 2, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains(STORE_FALLOS)) d.createObjectStore(STORE_FALLOS, { keyPath: 'id', autoIncrement: true });
      },
    });
  }
  return dbp;
}

export interface FalloSync { id: number; method: string; path: string; error: string; ts: number; reintentable: boolean }
interface FalloPersistido extends FalloSync { request_id?: number }
export interface EstadoOffline { online: boolean; pendientes: number; fallidos: FalloSync[] }
type Listener = (estado: EstadoOffline) => void;
const listeners = new Set<Listener>();
let online = navigator.onLine;

function esPeticionOfflineSegura(method: string, path: string) {
  return (method === 'PUT' && path === '/operacion/pedidos')
    || (method === 'PATCH' && /^\/conteos\/\d+\/lineas$/.test(path));
}

async function contarPendientes(): Promise<number> {
  return (await db()).count(STORE);
}

async function notificar() {
  const pendientes = await contarPendientes();
  const fallidos = await (await db()).getAll(STORE_FALLOS) as FalloPersistido[];
  for (const l of listeners) l({ online, pendientes, fallidos });
}

async function registrarFallo(fallo: Omit<FalloPersistido, 'id'>) {
  const d = await db();
  if (fallo.request_id != null) {
    const anteriores = await d.getAll(STORE_FALLOS) as FalloPersistido[];
    if (anteriores.some((actual) => actual.request_id === fallo.request_id)) return;
  }
  await d.add(STORE_FALLOS, fallo);
}

/** Reconoce un rechazo definitivo (4xx o acción antigua); la captura ya no está en cola. */
export function descartarFallos(id: number) {
  void (async () => {
    const d = await db();
    await d.delete(STORE_FALLOS, id);
    await notificar();
  })();
}

/** Reactiva una captura pausada después de varios 5xx sin perder su contenido. */
export function reintentarFallo(id: number) {
  void (async () => {
    const d = await db();
    const fallo = await d.get(STORE_FALLOS, id) as FalloPersistido | undefined;
    if (fallo?.request_id != null) {
      const req = await d.get(STORE, fallo.request_id) as PendingReq | undefined;
      if (req) await d.put(STORE, { ...req, intentos: 0, pausado: false });
    }
    await d.delete(STORE_FALLOS, id);
    await notificar();
    await sincronizar();
  })();
}

/** El usuario decide descartar explícitamente una captura pausada. */
export function descartarOperacionFallida(id: number) {
  void (async () => {
    const d = await db();
    const fallo = await d.get(STORE_FALLOS, id) as FalloPersistido | undefined;
    if (fallo?.request_id != null) await d.delete(STORE, fallo.request_id);
    await d.delete(STORE_FALLOS, id);
    await notificar();
  })();
}

export function suscribir(l: Listener): () => void {
  listeners.add(l);
  void notificar();
  return () => listeners.delete(l);
}

export async function encolar(req: Omit<PendingReq, 'id' | 'ts'>) {
  const d = await db();
  // Una venta se guarda como documento completo. Si se vuelve a editar sin conexión,
  // conserva únicamente la versión más reciente del mismo restaurante/línea/fecha.
  if ((req.method === 'PUT' && req.path === '/operacion/pedidos' && req.body && typeof req.body === 'object')
    || (req.method === 'PATCH' && /^\/conteos\/\d+\/lineas$/.test(req.path))) {
    const actual = req.body as { ubicacion_id?: number; linea?: string; fecha_entrega?: string };
    const pendientes = await d.getAll(STORE) as PendingReq[];
    const keys = await d.getAllKeys(STORE);
    for (const [index, pendiente] of pendientes.entries()) {
      if (pendiente.method !== req.method || pendiente.path !== req.path) continue;
      const anterior = pendiente.body as typeof actual;
      const mismaCaptura = req.method === 'PATCH'
        || (pendiente.body && typeof pendiente.body === 'object'
          && anterior.ubicacion_id === actual.ubicacion_id && anterior.linea === actual.linea && anterior.fecha_entrega === actual.fecha_entrega);
      if (mismaCaptura) {
        const key = keys[index];
        if (typeof key === 'number') {
          await d.delete(STORE, key);
          const fallos = await d.getAll(STORE_FALLOS) as FalloPersistido[];
          for (const fallo of fallos) if (fallo.request_id === key) await d.delete(STORE_FALLOS, fallo.id);
        }
      }
    }
  }
  await d.add(STORE, { ...req, ts: Date.now() });
  await notificar();
}

let sincronizando = false;

/** Reenvía la cola en orden. Se detiene al primer fallo de red (sigue offline). */
export async function sincronizar(): Promise<void> {
  if (sincronizando) return;
  sincronizando = true;
  try {
    const d = await db();
    let keys = await d.getAllKeys(STORE);
    for (const key of keys) {
      const req = (await d.get(STORE, key)) as PendingReq | undefined;
      if (!req) continue;
      if (req.pausado) continue;
      // Versiones anteriores encolaban cualquier mutación. No reproducimos pagos, compras,
      // cargas o eliminaciones antiguas porque podrían duplicar o desordenar la contabilidad.
      if (!esPeticionOfflineSegura(req.method, req.path)) {
        await registrarFallo({ method: req.method, path: req.path, error: 'Acción pendiente descartada por seguridad; vuelve a capturarla con conexión', ts: Date.now(), reintentable: false });
        await d.delete(STORE, key);
        continue;
      }
      try {
        const res = await fetch(`/api${req.path}`, {
          method: req.method,
          headers: {
            ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(req.token ? { Authorization: `Bearer ${req.token}` } : {}),
          },
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        });
        if (!res.ok && res.status >= 500) {
          // Error de servidor: puede ser transitorio o un dato que el servidor nunca va a
          // aceptar. Reintentamos con tope; pasado el tope se descarta (con aviso) para no
          // atorar el resto de la cola detrás de este renglón para siempre.
          const intentos = (req.intentos ?? 0) + 1;
          if (intentos >= MAX_INTENTOS_5XX) {
            await d.put(STORE, { ...req, intentos, pausado: true });
            await registrarFallo({ method: req.method, path: req.path, error: `El servidor no aceptó este cambio tras varios intentos (error ${res.status}). La captura sigue guardada en este dispositivo.`, ts: Date.now(), reintentable: true, request_id: Number(key) });
            continue;
          }
          await d.put(STORE, { ...req, intentos });
          break; // conserva el orden hasta resolver o pausar esta captura
        }
        // La petición llegó. Si fue 4xx, el server la rechazó (inválida): la quitamos
        // de la cola y la registramos como fallo para avisarle al usuario.
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          await registrarFallo({ method: req.method, path: req.path, error: (data as { error?: string }).error ?? `Error ${res.status}`, ts: Date.now(), reintentable: false });
        }
        await d.delete(STORE, key);
      } catch {
        // Sin red: cortamos y reintentaremos luego (esto sí afecta a toda la cola por igual).
        break;
      }
    }
    keys = await d.getAllKeys(STORE);
    void notificar();
  } finally {
    sincronizando = false;
  }
}

export function iniciarOffline() {
  window.addEventListener('online', () => { online = true; void notificar(); void sincronizar(); });
  window.addEventListener('offline', () => { online = false; void notificar(); });
  // Intento periódico por si el evento 'online' no dispara (algunos navegadores).
  setInterval(() => { if (navigator.onLine) void sincronizar(); }, 15000);
  void sincronizar();
}

export const estaOnline = () => online;

/** Hook de estado de conexión + cola pendiente, para la barra de contexto y el banner. */
export function useOffline() {
  const [estado, setEstado] = useState<EstadoOffline>({ online, pendientes: 0, fallidos: [] });
  useEffect(() => suscribir(setEstado), []);
  return { ...estado, sincronizar, descartarFallos, reintentarFallo, descartarOperacionFallida };
}
