import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

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

export default function PanelAdmin() {
  const [p, setP] = useState<Panel | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Panel>('/dashboard').then(setP).catch(() => setError('No se pudo cargar el panel'));
  }, []);

  if (error) return <p className="error-msg">{error}</p>;
  if (!p) return <p className="muted">Cargando panel…</p>;

  return (
    <div className="panel-admin">
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-label">Conteos listos</span>
          <span className="big-number">{p.conteos_listos}<small className="muted">/{p.sucursales_total}</small></span>
        </div>
        <div className={`kpi-card ${p.conteos_pendientes > 0 ? 'kpi-card--warn' : ''}`}>
          <span className="kpi-label">Conteos pendientes</span>
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
          <strong>Sucursales sin conteo cerrado</strong>
          <div className="dist-suc-mini">
            {p.sucursales_pendientes.map((s) => <span key={s.id}>{s.nombre}</span>)}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <strong>Distribución actual</strong>
          <Link className="link-btn" to="/distribucion">Ir a distribución →</Link>
        </div>
        {p.distribucion_actual ? (
          <div className="muted">
            #{p.distribucion_actual.id} · {p.distribucion_actual.estado} · {p.distribucion_actual.total_lineas} líneas ·{' '}
            {new Date(p.distribucion_actual.creado_at).toLocaleDateString('es-MX', { timeZone: 'America/Chicago' })}
          </div>
        ) : (
          <p className="muted">Aún no hay distribuciones. Calcula una cuando las sucursales cierren su conteo.</p>
        )}
      </div>

      <div className="card">
        <div className="card-head"><strong>Valor por ubicación</strong></div>
        <div className="lista-ubicaciones">
          {p.valor_por_ubicacion.map((u) => (
            <div key={u.id} className="ubic-row">
              <div>
                {u.nombre} <span className={`chip ${u.tipo === 'bodega' ? 'chip--info' : 'chip--ok'}`}>{u.tipo}</span>
                {u.conteo_estado !== 'cerrado' && <span className="chip chip--warn">sin conteo cerrado</span>}
              </div>
              <div className="dist-valor">{usd(u.valor)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
