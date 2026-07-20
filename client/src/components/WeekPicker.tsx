import { crearSemana, etiquetaRango, moverSemana, semanasAlrededor, type SemanaSeleccionada } from '../semana';

interface WeekPickerProps {
  semana: SemanaSeleccionada;
  onChange: (inicio: string) => void;
  label?: string;
  className?: string;
}

/** Selector único para que todas las pantallas mantengan el mismo contexto semanal. */
export default function WeekPicker({ semana, onChange, label = 'Semana de trabajo', className = '' }: WeekPickerProps) {
  const opciones = semanasAlrededor(crearSemana());
  const anterior = moverSemana(semana, -1);
  const siguiente = moverSemana(semana, 1);

  return <section className={`global-week-picker ${className}`.trim()} aria-label={label}>
    <button type="button" className="icon-btn" aria-label="Semana anterior" onClick={() => onChange(anterior.inicio)}>←</button>
    <label>
      <span>{label}</span>
      <select value={semana.inicio} onChange={(e) => onChange(e.target.value)}>
        {opciones.map((opcion) => <option key={opcion.inicio} value={opcion.inicio}>Semana {opcion.numero} · {etiquetaRango(opcion)}</option>)}
      </select>
    </label>
    <button type="button" className="icon-btn" aria-label="Semana siguiente" onClick={() => onChange(siguiente.inicio)}>→</button>
    {!semana.actual && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(crearSemana().inicio)}>Ir a semana actual</button>}
  </section>;
}
