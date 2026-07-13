/** Indicador de carga consistente en toda la app (reemplaza los "Cargando…" sueltos). */
export default function Spinner({ label, small = false }: { label?: string; small?: boolean }) {
  return (
    <div className={`spinner-wrap ${small ? 'spinner-wrap--sm' : ''}`} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span className="muted">{label}</span>}
    </div>
  );
}
