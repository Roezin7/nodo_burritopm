import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

export type Rol = 'admin' | 'encargado_bodega' | 'encargado_sucursal' | 'repartidor';
export interface Usuario {
  id: number;
  nombre: string;
  rol: Rol;
}

interface AuthCtx {
  usuario: Usuario | null;
  cargando: boolean;
  login: (usuario_id: number, pin: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

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
  }

  function logout() {
    setToken(null);
    setUsuario(null);
  }

  return <Ctx.Provider value={{ usuario, cargando, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
