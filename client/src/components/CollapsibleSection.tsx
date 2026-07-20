import { useState, type ReactNode } from 'react';
import { Icono } from '../icons';

export default function CollapsibleSection({
  title,
  count,
  summary,
  defaultOpen = false,
  className = '',
  children,
}: {
  title: string;
  count?: number | string;
  summary?: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className={`collapsible-section ${className}`.trim()} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span className="collapsible-section__title"><strong>{title}</strong>{summary && <small>{summary}</small>}</span>
      <span className="collapsible-section__meta">{count != null && <b>{count}</b>}<i aria-hidden="true"><Icono name="down" size={17} /></i></span>
    </summary>
    <div className="collapsible-section__body">{children}</div>
  </details>;
}
