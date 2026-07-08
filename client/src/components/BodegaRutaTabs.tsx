import { useNavigate } from 'react-router-dom';

/** Conmutador de la sección "Bodega y reparto": surtir/cargar (/bodega) y repartir (/ruta).
 *  La misma persona hace ambas cosas, así que viven como una sola sección con dos vistas. */
export default function BodegaRutaTabs({ activo }: { activo: 'bodega' | 'reparto' }) {
  const navigate = useNavigate();
  return (
    <div className="tabs">
      <button
        className={activo === 'bodega' ? 'tab tab--on' : 'tab'}
        onClick={() => { if (activo !== 'bodega') navigate('/bodega'); }}
      >
        Surtir y cargar
      </button>
      <button
        className={activo === 'reparto' ? 'tab tab--on' : 'tab'}
        onClick={() => { if (activo !== 'reparto') navigate('/ruta'); }}
      >
        Reparto
      </button>
    </div>
  );
}
