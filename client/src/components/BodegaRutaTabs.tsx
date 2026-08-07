import { useLocation, useNavigate } from 'react-router-dom';
import { useOperacionConfig } from '../operacion-config';
import { useSemanaGlobal } from '../semana-context';

/** Conmutador de la sección "Bodega y reparto": surtir/cargar (/bodega) y repartir (/ruta).
 *  La misma persona hace ambas cosas, así que viven como una sola sección con dos vistas. */
export default function BodegaRutaTabs({ activo }: { activo: 'bodega' | 'reparto' }) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { semana } = useSemanaGlobal();
  const { repartoHabilitado } = useOperacionConfig();
  const destino = (ruta: string) => {
    const params = new URLSearchParams(search);
    params.set('semana', semana.inicio);
    return `${ruta}?${params.toString()}`;
  };
  return (
    <div className="tabs">
      <button
        className={activo === 'bodega' ? 'tab tab--on' : 'tab'}
        onClick={() => { if (activo !== 'bodega') navigate(destino('/semana/despacho')); }}
      >
        Surtir y cargar
      </button>
      {repartoHabilitado && (
        <button
          className={activo === 'reparto' ? 'tab tab--on' : 'tab'}
          onClick={() => { if (activo !== 'reparto') navigate(destino('/semana/reparto')); }}
        >
          Reparto
        </button>
      )}
    </div>
  );
}
