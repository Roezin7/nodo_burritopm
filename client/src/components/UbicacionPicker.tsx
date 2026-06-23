import { useMemo, useState } from 'react';

export interface OpcionUbic {
  id: number;
  nombre: string;
  tipo?: 'bodega' | 'sucursal';
}

interface Props {
  label?: string;
  opciones: OpcionUbic[];
  value: string; // id seleccionado (string para usar directo en estado)
  onChange: (id: string) => void;
  /** Umbral a partir del cual se muestra el buscador. */
  umbralBusqueda?: number;
}

/**
 * Selector de ubicación profesional: pills táctiles para elegir de un toque y, cuando hay
 * muchas (≥ umbral), un buscador para filtrarlas. Reemplaza los <select> crudos.
 */
export default function UbicacionPicker({ label, opciones, value, onChange, umbralBusqueda = 8 }: Props) {
  const [q, setQ] = useState('');
  const conBusqueda = opciones.length >= umbralBusqueda;

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return opciones;
    return opciones.filter((o) => o.nombre.toLowerCase().includes(t));
  }, [q, opciones]);

  if (opciones.length <= 1) return null;

  return (
    <div className="ubic-picker">
      {label && <span className="ubic-picker-label">{label}</span>}
      {conBusqueda && (
        <input
          className="ubic-picker-search"
          type="search"
          placeholder="Buscar sucursal…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      <div className="ubic-picker-pills">
        {filtradas.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`ubic-pill ${String(o.id) === value ? 'ubic-pill--on' : ''}`}
            onClick={() => onChange(String(o.id))}
          >
            {o.tipo === 'bodega' && <span className="ubic-pill-tag">Bodega</span>}
            {o.nombre}
          </button>
        ))}
        {filtradas.length === 0 && <span className="muted">Sin coincidencias</span>}
      </div>
    </div>
  );
}
