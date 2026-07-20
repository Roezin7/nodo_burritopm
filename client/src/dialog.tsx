import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Modal from './components/Modal';
import { Icono } from './icons';

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

export interface PromptOptions extends ConfirmOptions {
  label: string;
  initialValue?: string;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  maxLength?: number;
  validate?: (value: string) => string | null;
}

type Solicitud =
  | ({ id: number; type: 'confirm'; resolve: (value: boolean) => void } & ConfirmOptions)
  | ({ id: number; type: 'prompt'; resolve: (value: string | null) => void } & PromptOptions);

interface DialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [solicitud, setSolicitud] = useState<Solicitud | null>(null);
  const [valor, setValor] = useState('');
  const [error, setError] = useState('');
  const cola = useRef<Solicitud[]>([]);
  const solicitudActual = useRef<Solicitud | null>(null);
  const secuencia = useRef(0);

  function encolar(siguiente: Solicitud) {
    if (solicitudActual.current) {
      cola.current.push(siguiente);
      return;
    }
    solicitudActual.current = siguiente;
    setSolicitud(siguiente);
  }

  function terminar(resultado: boolean | string | null) {
    const actual = solicitudActual.current;
    if (!actual) return;
    if (actual.type === 'confirm') actual.resolve(Boolean(resultado));
    else actual.resolve(typeof resultado === 'string' ? resultado : null);
    const siguiente = cola.current.shift() ?? null;
    solicitudActual.current = siguiente;
    setSolicitud(siguiente);
  }

  useEffect(() => {
    setValor(solicitud?.type === 'prompt' ? solicitud.initialValue ?? '' : '');
    setError('');
  }, [solicitud?.id]);

  const api: DialogContextValue = {
    confirm: (options) => new Promise<boolean>((resolve) => encolar({ ...options, id: ++secuencia.current, type: 'confirm', resolve })),
    prompt: (options) => new Promise<string | null>((resolve) => encolar({ ...options, id: ++secuencia.current, type: 'prompt', resolve })),
  };

  function aceptar() {
    if (!solicitud) return;
    if (solicitud.type === 'confirm') { terminar(true); return; }
    const mensaje = solicitud.validate?.(valor) ?? null;
    if (mensaje) { setError(mensaje); return; }
    terminar(valor);
  }

  return <DialogContext.Provider value={api}>
    {children}
    {solicitud && <Modal
      className={`app-dialog ${solicitud.tone === 'danger' ? 'app-dialog--danger' : ''}`}
      ariaLabelledBy="app-dialog-title"
      onClose={() => terminar(solicitud.type === 'confirm' ? false : null)}
    >
      <header className="app-dialog__head">
        <div><span className="eyebrow">{solicitud.tone === 'danger' ? 'Acción importante' : 'Confirmación'}</span><h2 id="app-dialog-title">{solicitud.title}</h2></div>
        <button className="icon-btn" aria-label="Cerrar" onClick={() => terminar(solicitud.type === 'confirm' ? false : null)}><Icono name="x" /></button>
      </header>
      <p className="app-dialog__description">{solicitud.description}</p>
      {solicitud.type === 'prompt' && <label className="field app-dialog__field"><span>{solicitud.label}</span><input data-autofocus value={valor} inputMode={solicitud.inputMode} maxLength={solicitud.maxLength} placeholder={solicitud.placeholder} onChange={(evento) => { setValor(solicitud.inputMode === 'numeric' ? evento.target.value.replace(/\D/g, '') : evento.target.value); setError(''); }} onKeyDown={(evento) => { if (evento.key === 'Enter') { evento.preventDefault(); aceptar(); } }} />{error && <small className="error-msg">{error}</small>}</label>}
      <footer className="app-dialog__actions">
        <button className="btn btn-secondary" onClick={() => terminar(solicitud.type === 'confirm' ? false : null)}>{solicitud.cancelLabel ?? 'Cancelar'}</button>
        <button data-autofocus={solicitud.type === 'confirm' ? true : undefined} className={solicitud.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'} onClick={aceptar}>{solicitud.confirmLabel ?? 'Confirmar'}</button>
      </footer>
    </Modal>}
  </DialogContext.Provider>;
}

export function useDialog() {
  const contexto = useContext(DialogContext);
  if (!contexto) throw new Error('useDialog debe usarse dentro de DialogProvider');
  return contexto;
}
