import { useEffect, useState } from 'react';
import { openDB, type IDBPDatabase } from 'idb';

// Cola de escrituras offline. Cuando no hay red, las mutaciones (POST/PATCH/PUT/DELETE)
// se encolan en IndexedDB y se reenvían al recuperar conexión (FIFO). Las lecturas (GET)
// no se encolan: requieren red (el app shell sí está cacheado por el service worker).

export interface PendingReq {
  id?: number;
  method: string;
  path: string; // sin el prefijo /api
  body?: unknown;
  token: string | null;
  ts: number;
}

const DB_NAME = 'bpm-offline';
const STORE = 'cola';

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      },
    });
  }
  return dbp;
}

export interface FalloSync { method: string; path: string; error: string; ts: number }
export interface EstadoOffline { online: boolean; pendientes: number; fallidos: FalloSync[] }
type Listener = (estado: EstadoOffline) => void;
const listeners = new Set<Listener>();
let online = navigator.onLine;
// Mutaciones que el servidor rechazó (4xx) al sincronizar: se descartan de la cola
// pero se conservan aquí para avisarle al usuario que NO se guardaron.
let fallidos: FalloSync[] = [];

async function contarPendientes(): Promise<number> {
  return (await db()).count(STORE);
}

async function notificar() {
  const pendientes = await contarPendientes();
  for (const l of listeners) l({ online, pendientes, fallidos });
}

/** Descarta los avisos de fallos (cuando el usuario los reconoce). */
export function descartarFallos() {
  fallidos = [];
  void notificar();
}

export function suscribir(l: Listener): () => void {
  listeners.add(l);
  void notificar();
  return () => listeners.delete(l);
}

export async function encolar(req: Omit<PendingReq, 'id' | 'ts'>) {
  await (await db()).add(STORE, { ...req, ts: Date.now() });
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
          // error de servidor transitorio: NO borrar; reintentaremos luego.
          break;
        }
        // La petición llegó. Si fue 4xx, el server la rechazó (inválida): la quitamos
        // de la cola y la registramos como fallo para avisarle al usuario.
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          fallidos.push({ method: req.method, path: req.path, error: (data as { error?: string }).error ?? `Error ${res.status}`, ts: Date.now() });
        }
        await d.delete(STORE, key);
      } catch {
        // Sin red: cortamos y reintentaremos luego.
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
  return { ...estado, sincronizar, descartarFallos };
}
