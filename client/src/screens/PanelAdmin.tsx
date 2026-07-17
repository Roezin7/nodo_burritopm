import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Spinner from '../components/Spinner';

interface Panorama {
  periodo: { anio: number; semana: number; inicia_at: string; termina_at: string; estado: string };
  ventas: { fuente: 'facturado' | 'proyectado'; total: number; carne: number; desechables: number; markup_proteina: number; por_empresa: { codigo: string; nombre: string; carne: number; desechables: number; total: number }[] };
  inventario: { total: number; materia_prima_fresca: number; materia_prima_congelada: number; carne_terminada: number; desechables: number };
  cartera: { por_cobrar: number; vencido_cobrar: number; facturas_pendientes: number; por_pagar: number; vencido_pagar: number; compras_pendientes: number; balance_neto: number };
  produccion: { costo: number; cajas: number; yield: number; compras_semana: number };
  operacion: { pedidos_confirmados: number; pedidos_borrador: number; distribuciones_abiertas: number; paradas_pendientes: number; productos_bajo_minimo: number };
  alertas: { tipo: string; titulo: string; detalle: string; ruta: string }[];
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });

function Desglose({ filas }: { filas: { label: string; valor: number; tono?: string }[] }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  return <div className="overview-breakdown">{filas.map((f) => <div className="overview-row" key={f.label}><div className="overview-row-head"><span>{f.label}</span><strong>{usd(f.valor)}</strong></div><div className="overview-track"><span className={f.tono ?? ''} style={{ width: `${Math.max(f.valor > 0 ? 2 : 0, (f.valor / max) * 100)}%` }} /></div></div>)}</div>;
}

export default function PanelAdmin() {
  const [p, setP] = useState<Panorama | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { api<Panorama>('/dashboard/general').then(setP).catch(() => setError('No se pudo cargar el panorama general.')); }, []);
  if (error) return <p className="error-msg">{error}</p>;
  if (!p) return <Spinner label="Calculando panorama…" />;

  const maxEmpresa = Math.max(1, ...p.ventas.por_empresa.map((e) => e.total));
  return <div className="panel-admin overview">
    <div className="overview-head">
      <div><h2>Panorama semanal</h2><p className="muted">Semana {p.periodo.semana} · {fecha(p.periodo.inicia_at)}–{fecha(p.periodo.termina_at)} · {p.periodo.estado}</p></div>
      <span className={`chip ${p.ventas.fuente === 'facturado' ? 'chip--ok' : 'chip--info'}`}>{p.ventas.fuente === 'facturado' ? 'Facturado' : 'Proyección en curso'}</span>
    </div>

    {p.alertas.length > 0 && <div className="overview-alerts">{p.alertas.map((a) => <Link className={`overview-alert overview-alert--${a.tipo}`} to={a.ruta} key={`${a.tipo}-${a.titulo}`}><span><strong>{a.titulo}</strong><small>{a.detalle}</small></span><b>→</b></Link>)}</div>}

    <div className="kpi-grid overview-kpis">
      <div className="kpi-card"><span className="kpi-label">{p.ventas.fuente === 'facturado' ? 'Venta facturada' : 'Venta proyectada'}</span><span className="big-number">{usd(p.ventas.total)}</span><small>Carne {usd(p.ventas.carne)} · desechables {usd(p.ventas.desechables)}</small></div>
      <div className="kpi-card"><span className="kpi-label">Markup de proteína</span><span className="big-number">{usd(p.ventas.markup_proteina)}</span><small>$15 por caja producida vendida</small></div>
      <div className="kpi-card"><span className="kpi-label">Inventario y reservas</span><span className="big-number">{usd(p.inventario.total)}</span><small>Carne, materia prima, desechables y compras en hold</small></div>
      <div className={`kpi-card ${p.cartera.balance_neto < 0 ? 'kpi-card--warn' : ''}`}><span className="kpi-label">Balance operativo</span><span className="big-number">{usd(p.cartera.balance_neto)}</span><small>Inventario + saldo pendiente por cobrar − por pagar</small></div>
    </div>

    <div className="overview-grid">
      <section className="card overview-card">
        <div className="card-head"><div><strong>Venta por empresa</strong><div className="muted">Quién genera la venta de la semana</div></div><Link className="link-btn" to="/semana/ventas">Ver ventas →</Link></div>
        {p.ventas.por_empresa.map((e) => <div className="company-sale" key={e.codigo}><div className="overview-row-head"><span><strong>{e.codigo}</strong> · {e.nombre}</span><strong>{usd(e.total)}</strong></div><div className="company-track"><span className="company-meat" style={{ width: `${(e.carne / maxEmpresa) * 100}%` }} /><span className="company-disposable" style={{ width: `${(e.desechables / maxEmpresa) * 100}%` }} /></div><small>Carne {usd(e.carne)} · Desechables {usd(e.desechables)}</small></div>)}
      </section>

      <section className="card overview-card">
        <div className="card-head"><div><strong>Inventario</strong><div className="muted">Bodega Adison y Carnicería</div></div><Link className="link-btn" to="/semana/inventario">Revisar →</Link></div>
        <Desglose filas={[{ label: 'Materia prima fresca', valor: p.inventario.materia_prima_fresca }, { label: 'Materia prima congelada', valor: p.inventario.materia_prima_congelada, tono: 'bar-frozen' }, { label: 'Carne terminada', valor: p.inventario.carne_terminada, tono: 'bar-meat' }, { label: 'Desechables', valor: p.inventario.desechables, tono: 'bar-disposable' }]} />
      </section>

      <section className="card overview-card">
        <div className="card-head"><div><strong>Cobros y pagos</strong><div className="muted">Saldo pendiente</div></div><Link className="link-btn" to="/semana/cierre">Abrir cierre →</Link></div>
        <div className="cash-grid"><div><small>Por cobrar</small><strong>{usd(p.cartera.por_cobrar)}</strong><span>{p.cartera.facturas_pendientes} facturas</span></div><div className={p.cartera.vencido_cobrar > 0 ? 'cash-warn' : ''}><small>Cobro vencido</small><strong>{usd(p.cartera.vencido_cobrar)}</strong><span>requiere seguimiento</span></div><div><small>Por pagar</small><strong>{usd(p.cartera.por_pagar)}</strong><span>{p.cartera.compras_pendientes} compras</span></div><div className={p.cartera.vencido_pagar > 0 ? 'cash-warn' : ''}><small>Pago vencido</small><strong>{usd(p.cartera.vencido_pagar)}</strong><span>requiere seguimiento</span></div></div>
      </section>

      <section className="card overview-card">
        <div className="card-head"><div><strong>Producción y compras</strong><div className="muted">Acumulado semanal</div></div><Link className="link-btn" to="/semana/compras">Registrar →</Link></div>
        <div className="production-summary"><div><small>Costo procesado</small><strong>{usd(p.produccion.costo)}</strong></div><div><small>Cajas producidas</small><strong>{p.produccion.cajas.toLocaleString('es-MX')}</strong></div><div><small>Yield</small><strong>{p.produccion.yield.toFixed(1)}%</strong></div><div><small>Compras</small><strong>{usd(p.produccion.compras_semana)}</strong></div></div>
      </section>
    </div>

    <section className="card overview-card operation-strip">
      <div><small>Pedidos confirmados</small><strong>{p.operacion.pedidos_confirmados}</strong></div>
      <div className={p.operacion.pedidos_borrador ? 'strip-warn' : ''}><small>Sin confirmar</small><strong>{p.operacion.pedidos_borrador}</strong></div>
      <div><small>Distribuciones abiertas</small><strong>{p.operacion.distribuciones_abiertas}</strong></div>
      <div className={p.operacion.paradas_pendientes ? 'strip-warn' : ''}><small>Paradas pendientes</small><strong>{p.operacion.paradas_pendientes}</strong></div>
      <div className={p.operacion.productos_bajo_minimo ? 'strip-warn' : ''}><small>Bajo mínimo</small><strong>{p.operacion.productos_bajo_minimo}</strong></div>
    </section>
  </div>;
}
