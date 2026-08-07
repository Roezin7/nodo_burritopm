import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';
import WeekPicker from '../../components/WeekPicker';
import type { SemanaSeleccionada } from '../../semana';

interface RutaCalendario {
  id: number;
  nombre: string;
  codigo: string;
  linea: 'carne' | 'desechables';
  dia_semana: number;
  conductor: string;
  paradas: { ubicacion_id: number; nombre: string; orden: number; opcional: boolean }[];
}

interface CatalogoEntregas {
  plantillas: RutaCalendario[];
}

const LINEA_LABEL: Record<RutaCalendario['linea'], string> = {
  carne: 'Carne',
  desechables: 'Desechables',
};

function fechasSemana(semana: SemanaSeleccionada) {
  const fechas: { iso: string; dia: number; etiqueta: string }[] = [];
  for (let iso = semana.inicio; iso <= semana.fin;) {
    const fecha = new Date(`${iso}T12:00:00`);
    fechas.push({
      iso,
      dia: fecha.getDay(),
      etiqueta: fecha.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
    });
    fecha.setDate(fecha.getDate() + 1);
    iso = fecha.toLocaleDateString('en-CA');
  }
  return fechas;
}

export default function Entregas({ semana, onChange }: { semana: SemanaSeleccionada; onChange: (inicio: string) => void }) {
  const [rutas, setRutas] = useState<RutaCalendario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const fechas = useMemo(() => fechasSemana(semana), [semana.inicio, semana.fin]);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError('');
    api<CatalogoEntregas>(`/operacion/catalogo?fecha_referencia=${semana.inicio}`)
      .then((catalogo) => { if (vigente) setRutas(catalogo.plantillas); })
      .catch((e) => { if (vigente) setError(e instanceof ApiError ? e.message : 'No se pudo cargar el calendario de entregas.'); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [semana.inicio]);

  return <div className="embedded-operation deliveries-calendar">
    <header className="embedded-head">
      <div>
        <span className="eyebrow">Operación diaria</span>
        <h2>Entregas</h2>
        <p className="page-sub">Calendario de rutas configuradas para esta semana.</p>
      </div>
      <Link className="btn btn-secondary btn-sm" to={`/semana/ventas?semana=${semana.inicio}`}>Abrir pedidos</Link>
    </header>
    <WeekPicker semana={semana} onChange={onChange} />
    {error && <p className="error-msg">{error}</p>}
    {cargando ? <Spinner /> : <div className="delivery-calendar-grid">
      {fechas.map((fecha) => {
        const delDia = rutas.filter((ruta) => ruta.dia_semana === fecha.dia);
        return <section className="delivery-day-card" key={fecha.iso}>
          <header><strong>{fecha.etiqueta}</strong><small>{delDia.length ? `${delDia.length} ruta${delDia.length === 1 ? '' : 's'}` : 'Sin rutas configuradas'}</small></header>
          {delDia.length > 0 ? delDia.map((ruta) => <article className="delivery-route-card" key={`${ruta.id}-${ruta.linea}`}>
            <div className="delivery-route-card__head">
              <div><strong>{ruta.nombre}</strong><small>{LINEA_LABEL[ruta.linea]} · {ruta.conductor}</small></div>
              <Link className="link-btn" to={`/semana/ventas?semana=${semana.inicio}&linea=${ruta.linea}`}>Ver pedidos</Link>
            </div>
            <ol>{ruta.paradas.map((parada) => <li key={`${ruta.id}-${parada.ubicacion_id}`}><span>{parada.orden}</span>{parada.nombre}{parada.opcional && <em>opcional</em>}</li>)}</ol>
          </article>) : <p className="muted">No hay entrega programada para este día.</p>}
        </section>;
      })}
    </div>}
  </div>;
}
