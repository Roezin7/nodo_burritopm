import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const PILA_MODALES: symbol[] = [];

const SELECTOR_FOCO = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function Modal({
  children,
  onClose,
  className = '',
  backdropClassName = '',
  ariaLabel,
  ariaLabelledBy,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  backdropClassName?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}) {
  const dialogo = useRef<HTMLDivElement>(null);
  const id = useRef(Symbol('modal'));
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useEffect(() => {
    const modalId = id.current;
    PILA_MODALES.push(modalId);
    const focoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      const primero = dialogo.current?.querySelector<HTMLElement>('[data-autofocus], ' + SELECTOR_FOCO);
      (primero ?? dialogo.current)?.focus();
    });

    function teclado(evento: KeyboardEvent) {
      if (PILA_MODALES.at(-1) !== modalId) return;
      if (evento.key === 'Escape' && closeOnEscape) {
        evento.preventDefault();
        cerrar.current();
        return;
      }
      if (evento.key !== 'Tab' || !dialogo.current) return;
      const focables = [...dialogo.current.querySelectorAll<HTMLElement>(SELECTOR_FOCO)]
        .filter((elemento) => elemento.offsetParent !== null);
      if (!focables.length) { evento.preventDefault(); dialogo.current.focus(); return; }
      const primero = focables[0];
      const ultimo = focables.at(-1)!;
      if (evento.shiftKey && document.activeElement === primero) { evento.preventDefault(); ultimo.focus(); }
      else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primero.focus(); }
    }

    document.addEventListener('keydown', teclado);
    return () => {
      document.removeEventListener('keydown', teclado);
      const indice = PILA_MODALES.lastIndexOf(modalId);
      if (indice >= 0) PILA_MODALES.splice(indice, 1);
      document.body.style.overflow = overflowAnterior;
      focoAnterior?.focus();
    };
  }, [closeOnEscape]);

  return createPortal(
    <div
      className={`modal-backdrop ${backdropClassName}`.trim()}
      onClick={(evento) => { if (closeOnBackdrop && evento.target === evento.currentTarget) cerrar.current(); }}
    >
      <div
        ref={dialogo}
        className={`modal-card ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
