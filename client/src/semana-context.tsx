import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { crearSemana, type SemanaSeleccionada } from './semana';
import { hayCambiosSinGuardar } from './use-unsaved';

const CLAVE_SEMANA = 'bpm-semana-seleccionada';

interface SemanaContexto {
  semana: SemanaSeleccionada;
  seleccionarSemana: (inicio: string) => void;
  rutaSemana: (ruta: string) => string;
}

const Contexto = createContext<SemanaContexto | null>(null);

function inicioGuardado() {
  try { return localStorage.getItem(CLAVE_SEMANA) ?? undefined; } catch { return undefined; }
}

export function SemanaProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const inicioUrl = params.get('semana') ?? undefined;
  const [semana, setSemana] = useState(() => crearSemana(inicioUrl ?? inicioGuardado()));

  useEffect(() => {
    if (!inicioUrl) return;
    const siguiente = crearSemana(inicioUrl);
    setSemana((actual) => actual.inicio === siguiente.inicio ? actual : siguiente);
    try { localStorage.setItem(CLAVE_SEMANA, siguiente.inicio); } catch { /* almacenamiento no disponible */ }
  }, [inicioUrl]);

  const seleccionarSemana = (inicio: string) => {
    const siguiente = crearSemana(inicio);
    if (siguiente.inicio !== semana.inicio && hayCambiosSinGuardar()
      && !window.confirm('Hay información sin guardar. ¿Descartarla y cambiar de semana?')) return;
    setSemana(siguiente);
    try { localStorage.setItem(CLAVE_SEMANA, siguiente.inicio); } catch { /* almacenamiento no disponible */ }
    const nuevos = new URLSearchParams(params);
    nuevos.set('semana', siguiente.inicio);
    setParams(nuevos, { replace: true });
  };

  const valor: SemanaContexto = {
    semana,
    seleccionarSemana,
    rutaSemana: (ruta) => {
      const separador = ruta.includes('?') ? '&' : '?';
      return `${ruta}${separador}semana=${semana.inicio}`;
    },
  };

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSemanaGlobal() {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useSemanaGlobal debe usarse dentro de SemanaProvider');
  return contexto;
}
