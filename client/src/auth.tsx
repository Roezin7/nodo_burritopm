import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import { useToast } from './toast';

export type Rol = 'admin' | 'encargado_bodega' | 'encargado_sucursal';

// Último usuario que inició sesión en ESTE dispositivo (para ofrecerlo de un toque).
const ULTIMO_KEY = 'bpm_ultimo_usuario';
export function getUltimoUsuario(): number | null {
  try {
    const v = localStorage.getItem(ULTIMO_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
function setUltimoUsuario(id: number) {
  try {
    localStorage.setItem(ULTIMO_KEY, String(id));
  } catch {
    /* almacenamiento no disponible */
  }
}

/** Etiqueta visible del rol. `encargado_bodega` cubre bodega + reparto (rol unificado). */
export function rolLabel(rol: Rol): string {
  switch (rol) {
    case 'admin': return 'Admin';
    case 'encargado_bodega': return 'Bodega y reparto';
    case 'encargado_sucursal': return 'Sucursal';
  }
}

export interface UbicacionAsignada {
  id: number;
  nombre: string;
  tipo: 'bodega' | 'sucursal';
  activo: boolean;
}

export interface Usuario {
  id: number;
  nombre: string;
  rol: Rol;
  requiere_cambio_pin?: boolean;
  ubicaciones?: UbicacionAsignada[];
}

interface AuthCtx {
  usuario: Usuario | null;
  cargando: boolean;
  recienEntro: boolean; // true tras un login explícito (para mandar a Inicio)
  consumirRecienEntro: () => void;
  login: (usuario_id: number, pin: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recienEntro, setRecienEntro] = useState(false);
  const toast = useToast();

  useEffect(() => {
    const expirada = () => {
      // Sin esto, el login reaparecía de la nada a media captura y el usuario no entendía
      // si era un error de la app; ahora se explica que fue la sesión, no una falla.
      setUsuario((actual) => {
        if (actual) toast.error('Tu sesión expiró. Vuelve a entrar con tu PIN.');
        return null;
      });
      setRecienEntro(false);
    };
    window.addEventListener('bpm-auth-expired', expirada);
    return () => window.removeEventListener('bpm-auth-expired', expirada);
  }, [toast]);

  // Al montar: si hay token, validar con /me.
  useEffect(() => {
    if (!getToken()) {
      setCargando(false);
      return;
    }
    api<Usuario>('/auth/me')
      .then(setUsuario)
      .catch(() => setToken(null))
      .finally(() => setCargando(false));
  }, []);

  async function login(usuario_id: number, pin: string) {
    const { token, usuario } = await api<{ token: string; usuario: Usuario }>('/auth/login', {
      method: 'POST',
      body: { usuario_id, pin },
      auth: false,
    });
    setToken(token);
    setUsuario(usuario);
    setUltimoUsuario(usuario.id);
    setRecienEntro(true);
  }

  function logout() {
    setToken(null);
    setUsuario(null);
  }

  return (
    <Ctx.Provider value={{ usuario, cargando, recienEntro, consumirRecienEntro: () => setRecienEntro(false), login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
