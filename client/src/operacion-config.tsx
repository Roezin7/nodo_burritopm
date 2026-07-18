import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth';

interface OperacionConfigCtx {
  repartoHabilitado: boolean;
  cargando: boolean;
  establecerRepartoHabilitado: (habilitado: boolean) => void;
}

const Ctx = createContext<OperacionConfigCtx | null>(null);

/** Configuración operativa compartida por menús y pantallas del flujo semanal. */
export function OperacionConfigProvider({ children }: { children: ReactNode }) {
  const { usuario } = useAuth();
  const [repartoHabilitado, setRepartoHabilitado] = useState(false);
  const [cargadoPara, setCargadoPara] = useState<number | null>(null);

  useEffect(() => {
    let activo = true;
    if (!usuario) {
      setRepartoHabilitado(false);
      setCargadoPara(null);
      return () => { activo = false; };
    }
    api<{ reparto_habilitado: boolean }>('/negocio')
      .then((n) => {
        if (!activo) return;
        setRepartoHabilitado(n.reparto_habilitado);
        setCargadoPara(usuario.id);
      })
      .catch(() => {
        if (!activo) return;
        // La migración deja Reparto apagado. Ante un fallo de lectura conservamos ese modo seguro.
        setRepartoHabilitado(false);
        setCargadoPara(usuario.id);
      });
    return () => { activo = false; };
  }, [usuario]);

  return (
    <Ctx.Provider value={{
      repartoHabilitado,
      cargando: !!usuario && cargadoPara !== usuario.id,
      establecerRepartoHabilitado: setRepartoHabilitado,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useOperacionConfig() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOperacionConfig debe usarse dentro de OperacionConfigProvider');
  return ctx;
}
