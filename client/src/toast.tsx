import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { Icono } from './icons';

interface Accion { label: string; onClick: () => void }
interface Toast {
  id: number;
  tipo: 'ok' | 'error';
  texto: string;
  accion?: Accion;
}

interface ToastCtx {
  ok: (texto: string, accion?: Accion) => void;
  error: (texto: string) => void;
}

const Ctx = createContext<ToastCtx>(null as unknown as ToastCtx);

let seq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const quitar = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const tm = timers.current[id];
    if (tm) { clearTimeout(tm); delete timers.current[id]; }
  }, []);

  const empujar = useCallback((t: Omit<Toast, 'id'>) => {
    const id = seq++;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    timers.current[id] = setTimeout(() => quitar(id), t.accion ? 7000 : 4000);
  }, [quitar]);

  const ok = useCallback((texto: string, accion?: Accion) => empujar({ tipo: 'ok', texto, accion }), [empujar]);
  const error = useCallback((texto: string) => empujar({ tipo: 'error', texto }), [empujar]);

  return (
    <Ctx.Provider value={{ ok, error }}>
      {children}
      <div className="toaster" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tipo}`}>
            <span className="toast-texto">{t.texto}</span>
            {t.accion && (
              <button className="toast-accion" onClick={() => { t.accion!.onClick(); quitar(t.id); }}>
                {t.accion.label}
              </button>
            )}
            <button className="toast-x" aria-label="Cerrar" onClick={() => quitar(t.id)}><Icono name="x" size={17} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Mensaje de error claro: usa el del servidor si existe; si no, un fallback con qué hacer. */
export function mensajeError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return 'Sin conexión. Lo guardaremos y se enviará cuando vuelva el internet.';
    if (e.message) return e.message;
  }
  return fallback;
}
