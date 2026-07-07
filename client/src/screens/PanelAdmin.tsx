import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ParadaChip, FaseChip, faseDistribucion } from '../flujo';

// ── Tablero del ciclo: semáforo por sucursal (pedido / distribución / recepción) ──
type EstadoCelda = 'cerrado' | 'abierto' | 'pendiente' | 'en' | 'sin' | 'recibido' | 'parcial' | 'na';
interface FilaCiclo { id: number; nombre: string; conteo: 'cerrado' | 'abierto' | 'pendiente'; pedido: 'en' | 'sin' | 'na'; recepcion: 'recibido' | 'parcial' | 'pendiente' | 'na' }
interface Ciclo { distribucion: { id: number; estado: string; total_lineas: number } | null; sucursales: FilaCiclo[] }

// Color (tono) de cada estado de celda: verde=listo, ámbar=en proceso, rojo=falta, gris=n/a.
const TONO: Record<EstadoCelda, 'ok' | 'warn' | 'bad' | 'na'> = {
  cerrado: 'ok', recibido: 'ok', en: 'ok',
  abierto: 'warn', parcial: 'warn',
  pendiente: 'bad',
  sin: 'na', na: 'na',
};
const ETIQUETA: Record<EstadoCelda, string> = {
  cerrado: 'Listo', abierto: 'Captura', pendiente: 'Falta',
  en: 'Sí', sin: 'No', recibido: 'Recibido', parcial: 'Parcial', na: '—',
};

function Celda({ v }: { v: EstadoCelda }) {
  return (
    <span className={`ciclo-celda ciclo-celda--${TONO[v]}`}>
      <span className="ciclo-dot" />
      {ETIQUETA[v]}
    </span>
  );
}

function TableroCiclo() {
  const [c, setC] = useState<Ciclo | null>(null);
  useEffect(() => { api<Ciclo>('/dashboard/ciclo').then(setC).catch(() => {}); }, []);
  if (!c) return null;

  const fase = c.distribucion ? faseDistribucion(c.distribucion.estado) : null;
  const faltanConteo = c.sucursales.filter((s) => s.conteo !== 'cerrado').length;

  return (
    <div className="card ciclo-card">
      <div className="ciclo-head">
        <div className="ciclo-titulo">
          <strong>Estado del ciclo</strong>
          <small className="muted">{faltanConteo > 0 ? `${faltanConteo} sin cerrar pedido` : 'Pedidos al día'}</small>
        </div>
        {c.distribucion ? (
          <Link className="ciclo-pedido" to="/distribucion">
            <FaseChip estado={c.distribucion.estado} />
            <small className="muted">Pedido #{c.distribucion.id}</small>
          </Link>
        ) : (
          <Link className="link-btn" to="/distribucion">Crear pedido →</Link>
        )}
      </div>

      <div className="ciclo-tabla">
        <div className="ciclo-fila ciclo-fila--head">
          <span>Sucursal</span>
          <span>Pedido sucursal</span>
          <span>Pedido</span>
          <span>Recepción</span>
        </div>
        {c.sucursales.map((s) => (
          <Link key={s.id} to={`/inventario?ubicacion=${s.id}`} className="ciclo-fila ciclo-fila--link">
            <span className="ciclo-suc">{s.nombre}</span>
            <Celda v={s.conteo} />
            <Celda v={s.pedido} />
            <Celda v={s.recepcion} />
          </Link>
        ))}
      </div>

      {fase && (
        <p className="muted ciclo-pie">
          Fase actual del pedido: <strong>{fase.label}</strong>. {fase.clave === 'planeacion' ? 'Revisa y aprueba en Distribución.' : fase.clave === 'bodega' ? 'Bodega debe surtir y cargar.' : fase.clave === 'ruta' ? 'En reparto; las sucursales confirman recepción.' : 'Ciclo recibido.'}
        </p>
      )}
    </div>
  );
}

interface Panel {
  sucursales_total: number;
  conteos_pendientes: number;
  conteos_listos: number;
  sucursales_pendientes: { id: number; nombre: string }[];
  bajo_minimo: number;
  valor_total: number;
  valor_por_ubicacion: { id: number; nombre: string; tipo: string; valor: number; conteo_estado: string | null }[];
  distribucion_actual: { id: number; estado: string; creado_at: string; total_lineas: number } | null;
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

interface RutaParada {
  parada_id: number;
  ubicacion: { id: number; nombre: string };
  orden: number;
  estado: string;
}
interface RutaDetalle {
  ruta_id: number;
  estado: string;
  repartidor: { id: number; nombre: string } | null;
  paradas: RutaParada[];
}

export default function PanelAdmin() {
  const [p, setP] = useState<Panel | null>(null);
  const [ruta, setRuta] = useState<RutaDetalle | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Panel>('/dashboard').then(setP).catch(() => setError('No se pudo cargar el panel'));
  }, []);

  useEffect(() => {
    if (!p?.distribucion_actual) { setRuta(null); return; }
    api<RutaDetalle | null>(`/distribuciones/${p.distribucion_actual.id}/ruta`).then(setRuta).catch(() => setRuta(null));
  }, [p?.distribucion_actual?.id]);

  if (error) return <p className="error-msg">{error}</p>;
  if (!p) return <p className="muted">Cargando panel…</p>;

  return (
    <div className="panel-admin">
      <TableroCiclo />

      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Pedidos listos</span>
          <span className="big-number">{p.conteos_listos}<small className="muted">/{p.sucursales_total}</small></span>
        </div>
        <div className={`kpi-card ${p.conteos_pendientes > 0 ? 'kpi-card--warn' : ''}`}>
          <span className="kpi-label">Pedidos pendientes</span>
          <span className="big-number">{p.conteos_pendientes}</span>
        </div>
        <div className={`kpi-card ${p.bajo_minimo > 0 ? 'kpi-card--warn' : ''}`}>
          <span className="kpi-label">Productos bajo mínimo</span>
          <span className="big-number">{p.bajo_minimo}</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Valor de inventario</span>
          <span className="big-number">{usd(p.valor_total)}</span>
        </div>
      </div>

      {p.conteos_pendientes > 0 && (
        <div className="card card--falt">
          <strong>Sucursales sin pedido cerrado</strong>
          <div className="dist-suc-mini">
            {p.sucursales_pendientes.map((s) => <span key={s.id}>{s.nombre}</span>)}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <strong>Pedido actual</strong>
          <Link className="link-btn" to="/distribucion">Ir a Distribución →</Link>
        </div>
        {p.distribucion_actual ? (
          <div className="dist-actual-row">
            <FaseChip estado={p.distribucion_actual.estado} />
            <span className="muted">
              Pedido #{p.distribucion_actual.id} · {p.distribucion_actual.total_lineas} líneas ·{' '}
              {new Date(p.distribucion_actual.creado_at).toLocaleDateString('es-MX', { timeZone: 'America/Chicago' })}
            </span>
          </div>
        ) : (
          <p className="muted">Aún no hay pedidos. Crea uno cuando las sucursales cierren su pedido.</p>
        )}
      </div>

      {ruta && ruta.paradas.length > 0 && (
        <div className="card">
          <div className="card-head">
            <strong>Avance de la ruta</strong>
            <span className="muted">{ruta.repartidor?.nombre ?? 'sin repartidor'}</span>
          </div>
          <div className="ruta-tablero">
            {[...ruta.paradas].sort((a, b) => a.orden - b.orden).map((p) => (
              <div key={p.parada_id} className="ruta-parada-fila">
                <span className={`ruta-dot ruta-dot--${p.estado}`} />
                <span><strong>{p.orden}. {p.ubicacion.nombre}</strong></span>
                <ParadaChip estado={p.estado} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><strong>Valor por ubicación</strong></div>
        <div className="lista-ubicaciones">
          {p.valor_por_ubicacion.map((u) => (
            <div key={u.id} className="ubic-row">
              <div>
                {u.nombre} <span className={`chip ${u.tipo === 'bodega' ? 'chip--info' : 'chip--ok'}`}>{u.tipo}</span>
                {u.tipo === 'sucursal' && u.conteo_estado !== 'cerrado' && <span className="chip chip--warn">sin pedido cerrado</span>}
              </div>
              <div className="dist-valor">{usd(u.valor)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
