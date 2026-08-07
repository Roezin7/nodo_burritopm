import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import WeekPicker from '../../components/WeekPicker';
import HistoryToggle from '../../components/HistoryToggle';
import Spinner from '../../components/Spinner';
import { Icono } from '../../icons';
import type { SemanaSeleccionada } from '../../semana';

type Linea = 'carne' | 'desechables';

interface Salida {
  id: number;
  estado: string;
  fecha_entrega: string | null;
  linea: Linea | null;
  total_lineas: number;
}

interface CatalogoRutas {
  plantillas: { linea: Linea; dia_semana: number; activo?: boolean }[];
}

const COMPLETADAS = ['entregada', 'cerrada', 'cerrada_con_incidencias'];

function diasDeSemana(semana: SemanaSeleccionada) {
  const dias: { fecha: string; dia: string; numero: string; diaSemana: number }[] = [];
  const cursor = new Date(`${semana.inicio}T12:00:00`);
  while (cursor.toLocaleDateString('en-CA') <= semana.fin) {
    dias.push({
      fecha: cursor.toLocaleDateString('en-CA'),
      dia: cursor.toLocaleDateString('es-MX', { weekday: 'long' }),
      numero: cursor.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
      diaSemana: cursor.getDay(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

function estadoSalida(estado: string) {
  if (COMPLETADAS.includes(estado)) {
    return estado === 'cerrada_con_incidencias'
      ? { label: 'Despachada c/ faltantes', cls: 'chip--warn' }
      : { label: 'Despachada', cls: 'chip--ok' };
  }
  if (estado === 'cancelada') return { label: 'Cancelada', cls: 'chip--danger' };
  if (['aprobada', 'en_preparacion', 'preparada', 'verificada', 'en_carga', 'cargada', 'en_transito', 'parcialmente_entregada'].includes(estado)) {
    return { label: 'Programada', cls: 'chip--info' };
  }
  return { label: 'Pendiente', cls: 'chip--muted' };
}

export default function Entregas({ semana, onChange }: { semana: SemanaSeleccionada; onChange: (inicio: string) => void }) {
  const [salidas, setSalidas] = useState<Salida[]>([]);
  const [programacion, setProgramacion] = useState<CatalogoRutas['plantillas']>([]);
  const [mostrarCompletadas, setMostrarCompletadas] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    setCargando(true); setError(''); setSalidas([]);
    Promise.all([
      api<Salida[]>(`/distribuciones?desde=${semana.inicio}&hasta=${semana.fin}`),
      api<CatalogoRutas>('/operacion/catalogo'),
    ]).then(([filas, catalogo]) => {
      if (!vigente) return;
      setSalidas(filas);
      setProgramacion(catalogo.plantillas.filter((plantilla) => plantilla.activo !== false));
    }).catch((e) => {
      if (vigente) setError(e instanceof ApiError ? e.message : 'No se pudo cargar el calendario de entregas.');
    }).finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [semana.inicio, semana.fin]);

  const dias = diasDeSemana(semana);
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const salidasPor = (fecha: string, linea: Linea) => salidas
    .filter((salida) => salida.fecha_entrega === fecha && salida.linea === linea && salida.estado !== 'cancelada')
    .filter((salida) => mostrarCompletadas || !COMPLETADAS.includes(salida.estado))
    .sort((a, b) => a.id - b.id);
  const estaProgramado = (diaSemana: number, linea: Linea) => programacion.some((plantilla) => plantilla.dia_semana === diaSemana && plantilla.linea === linea);

  return <div className="embedded-operation">
    <header className="embedded-head">
      <div><span className="eyebrow">Producción a restaurante</span><h2>Entregas</h2><p className="page-sub">Salidas de la semana por día y línea.</p></div>
    </header>
    <WeekPicker semana={semana} onChange={onChange} />
    {error && <p className="error-msg">{error}</p>}
    <div className="history-access-bar"><strong>{mostrarCompletadas ? 'Todas las salidas de la semana' : 'Salidas pendientes'}</strong><HistoryToggle active={mostrarCompletadas} openLabel="Consultar completadas" closeLabel="Volver a pendientes" onToggle={() => setMostrarCompletadas((actual) => !actual)} /></div>
    {cargando ? <Spinner /> : <section className="dispatch-week-board" aria-label={`Calendario de entregas de la semana ${semana.numero}`}>
      <header className="dispatch-week-board__head"><div><span>Semana {semana.numero}</span><strong>Día</strong></div><div className="dispatch-line-title dispatch-line-title--carne"><span /><div><strong>Carne</strong><small>Carnicería</small></div></div><div className="dispatch-line-title dispatch-line-title--desechables"><span /><div><strong>Desechables</strong><small>Bodega Adison</small></div></div></header>
      <div className="dispatch-week-board__body">
        {dias.map((dia) => <div className={`dispatch-day-row ${dia.fecha === hoy ? 'is-today' : ''}`} key={dia.fecha}>
          <div className="dispatch-day-label"><strong>{dia.dia}</strong><span>{dia.numero}</span>{dia.fecha === hoy && <small>Hoy</small>}</div>
          {(['carne', 'desechables'] as const).map((linea) => {
            const delDia = salidasPor(dia.fecha, linea);
            const programada = estaProgramado(dia.diaSemana, linea);
            return <div className={`dispatch-day-cell dispatch-day-cell--${linea}`} key={linea}>
              {delDia.length ? delDia.map((salida) => {
                const estado = estadoSalida(salida.estado);
                return <Link className="dispatch-day-card" key={salida.id} to={`/semana/ventas?semana=${semana.inicio}&linea=${linea}`}>
                  <div><strong>{salida.total_lineas} partidas</strong><span>Ver salida</span></div><div><span className={`chip chip-estado ${estado.cls}`}>{estado.label}</span><b><Icono name="chevron" /></b></div>
                </Link>;
              }) : <div className={`dispatch-day-empty ${programada ? 'is-scheduled' : ''}`}><strong>{programada ? 'Salida programada' : 'Sin salida'}</strong>{programada && <span>Se generará al completar los pedidos</span>}</div>}
            </div>;
          })}
        </div>)}
      </div>
    </section>}
  </div>;
}
