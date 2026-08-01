import { type ReactNode } from 'react';
import { Icono } from '../icons';

export default function MoreActions({ children, label = 'Más acciones' }: { children: ReactNode; label?: string }) {
  return <details className="more-actions">
    <summary className="btn btn-ghost">
      <Icono name="menu" size={17} />
      <span>{label}</span>
    </summary>
    <div className="more-actions__menu" role="group" aria-label={label}>
      {children}
    </div>
  </details>;
}
