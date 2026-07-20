import { useEffect, useMemo, useRef, useState } from 'react';
import { Icono } from '../icons';

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
  /** A partir de cuántas opciones se usa el dropdown compacto en vez de pills. */
  umbralDropdown?: number;
}

/**
 * Selector de ubicación profesional y compacto. Con pocas ubicaciones muestra pills táctiles;
 * con muchas (≥ umbral) usa un dropdown con buscador para no saturar la pantalla.
 */
export default function UbicacionPicker({ label, opciones, value, onChange, umbralDropdown = 5 }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const seleccionada = opciones.find((o) => String(o.id) === value) ?? null;

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return opciones;
    return opciones.filter((o) => o.nombre.toLowerCase().includes(t));
  }, [q, opciones]);

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);

  if (opciones.length <= 1) return null;

  // Pocas: pills directas.
  if (opciones.length < umbralDropdown) {
    return (
      <div className="ubic-picker">
        {label && <span className="ubic-picker-label">{label}</span>}
        <div className="ubic-picker-pills">
          {opciones.map((o) => (
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
        </div>
      </div>
    );
  }

  // Muchas: dropdown compacto con buscador.
  return (
    <div className="ubic-picker" ref={ref}>
      {label && <span className="ubic-picker-label">{label}</span>}
      <div className="ubic-dropdown">
        <button type="button" className="ubic-dropdown-trigger" onClick={() => { setAbierto((v) => !v); setQ(''); }} aria-expanded={abierto}>
          <span className="ubic-dropdown-current">
            {seleccionada?.tipo === 'bodega' && <span className="ubic-pill-tag">Bodega</span>}
            {seleccionada?.nombre ?? 'Elegir ubicación…'}
          </span>
          <span className={`ubic-dropdown-caret ${abierto ? 'is-open' : ''}`}>▾</span>
        </button>
        {abierto && (
          <div className="ubic-dropdown-panel">
            <input
              className="ubic-dropdown-search"
              type="search"
              placeholder="Buscar ubicación…"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="ubic-dropdown-list">
              {filtradas.length === 0 ? (
                <span className="muted ubic-dropdown-empty">Sin coincidencias</span>
              ) : (
                filtradas.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`ubic-dropdown-opt ${String(o.id) === value ? 'is-sel' : ''}`}
                    onClick={() => { onChange(String(o.id)); setAbierto(false); }}
                  >
                    {o.tipo === 'bodega' && <span className="ubic-pill-tag">Bodega</span>}
                    <span className="ubic-dropdown-opt-name">{o.nombre}</span>
                    {String(o.id) === value && <span className="ubic-dropdown-check"><Icono name="checks" size={16} /></span>}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
