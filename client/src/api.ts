// Cliente HTTP mínimo para la API. Guarda el JWT en localStorage.

const TOKEN_KEY = 'bpm_token';
const CACHE_GET_MS = 15_000;
const cacheGet = new Map<string, { hasta: number; datos: unknown }>();
const getEnCurso = new Map<string, Promise<unknown>>();

/** Llave estable para reintentar una mutación sin duplicarla en el servidor. */
export function nuevaClaveIdempotencia(alcance: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${alcance}:${uuid}`;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Resultado sintético cuando una mutación se encola offline. */
export interface Encolado { queued: true }
export const fueEncolado = (r: unknown): r is Encolado =>
  typeof r === 'object' && r !== null && (r as Encolado).queued === true;

// Solo acciones de campo idempotentes pueden esperar sin conexión. Compras, producción,
// cierres, pagos, altas y eliminaciones deben confirmar con el servidor en ese momento: si se
// encolaran, la pantalla podría anunciar éxito aunque el movimiento financiero nunca ocurriera.
function admiteColaOffline(method: string, path: string) {
  if (method === 'PUT' && path === '/operacion/pedidos') return true;
  if (method === 'PATCH' && /^\/conteos\/\d+\/lineas$/.test(path)) return true;
  return false;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const esMutacion = method !== 'GET' && method !== 'HEAD';
  const token = auth ? getToken() : null;
  const claveGet = `${token ?? 'publico'}:${path}`;
  if (method === 'GET') {
    const guardado = cacheGet.get(claveGet);
    if (guardado && guardado.hasta > Date.now()) return guardado.datos as T;
    const pendiente = getEnCurso.get(claveGet);
    if (pendiente) return pendiente as Promise<T>;
  }
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const ejecutar = async (): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // La implementación de IndexedDB se descarga únicamente si la red realmente falla.
      if (esMutacion && admiteColaOffline(method, path)) {
        const { encolar } = await import('./offline');
        await encolar({ method, path, body, token });
        return { queued: true } as T;
      }
      throw new ApiError(0, 'Sin conexión');
    }

    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) {
        setToken(null);
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('bpm-auth-expired'));
      }
      throw new ApiError(res.status, (data as { error?: string }).error ?? 'Error de red');
    }
    if (method === 'GET') cacheGet.set(claveGet, { hasta: Date.now() + CACHE_GET_MS, datos: data });
    else cacheGet.clear();
    return data as T;
  };

  const solicitud = ejecutar();
  if (method !== 'GET') return solicitud;
  getEnCurso.set(claveGet, solicitud);
  try {
    return await solicitud;
  } finally {
    getEnCurso.delete(claveGet);
  }
}
