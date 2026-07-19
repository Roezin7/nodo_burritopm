import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api';
import Spinner from '../components/Spinner';
import { useToast } from '../toast';

interface FacturaEmitida {
  id: number;
  numero: string;
  version: number;
  empresa: string;
  ubicacion: string;
  linea: string;
  anio: number;
  semana: number;
  emitida_at: string;
  vence_at: string;
  estado: 'emitida' | 'pagada';
  total: number;
  pagado: number;
  saldo: number;
  pagado_at: string | null;
  lineas: { descripcion: string; cantidad: number; precio: number; importe: number }[];
}

interface FacturaRecibida {
  id: number;
  referencia: string | null;
  proveedor: string;
  ubicacion: string;
  recibida_at: string;
  vence_at: string;
  estado: 'pendiente' | 'pagada';
  total: number;
  saldo: number;
  pagado_at: string | null;
  lineas: { producto: string; cantidad: number; unidad: string; peso_lb: number; importe: number }[];
}

interface Cartera {
  resumen: {
    por_cobrar: number;
    vencido_cobrar: number;
    facturas_por_cobrar: number;
    por_pagar: number;
    vencido_pagar: number;
    facturas_por_pagar: number;
  };
  emitidas: FacturaEmitida[];
  recibidas: FacturaRecibida[];
}

type Detalle = { tipo: 'cobrar'; factura: FacturaEmitida } | { tipo: 'pagar'; factura: FacturaRecibida };
type Movimiento = { tipo: 'cobrar' | 'pagar'; id: number; titulo: string; monto: number };

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fechaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
const texto = (valor: string | null | undefined) => (valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function Facturacion() {
  const toast = useToast();
  const [datos, setDatos] = useState<Cartera | null>(null);
  const [vista, setVista] = useState<'pendientes' | 'historial'>('pendientes');
  const [tipo, setTipo] = useState<'todas' | 'cobrar' | 'pagar'>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [movimiento, setMovimiento] = useState<Movimiento | null>(null);
  const [fechaPago, setFechaPago] = useState(hoy());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function cargar() {
    setError('');
    try { setDatos(await api<Cartera>('/cierre/cartera')); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo cargar la facturación.'); }
  }

  useEffect(() => { void cargar(); }, []);

  const consulta = texto(busqueda.trim());
  const emitidas = useMemo(() => (datos?.emitidas ?? []).filter((factura) => {
    const coincideEstado = vista === 'pendientes' ? factura.estado === 'emitida' : factura.estado === 'pagada';
    const coincideTexto = !consulta || texto(`${factura.numero} ${factura.empresa} ${factura.ubicacion} ${factura.linea} ${factura.semana}`).includes(consulta);
    return coincideEstado && coincideTexto;
  }), [datos, vista, consulta]);
  const recibidas = useMemo(() => (datos?.recibidas ?? []).filter((factura) => {
    const coincideEstado = vista === 'pendientes' ? factura.estado === 'pendiente' : factura.estado === 'pagada';
    const coincideTexto = !consulta || texto(`${factura.referencia ?? ''} ${factura.proveedor} ${factura.ubicacion}`).includes(consulta);
    return coincideEstado && coincideTexto;
  }), [datos, vista, consulta]);

  async function registrarMovimiento() {
    if (!movimiento) return;
    setBusy(true); setError('');
    try {
      const ruta = movimiento.tipo === 'cobrar' ? `/cierre/facturas/${movimiento.id}/pagar` : `/cierre/compras/${movimiento.id}/pagar`;
      await api(ruta, { method: 'POST', body: { fecha_pago: fechaPago } });
      const etiqueta = movimiento.tipo === 'cobrar' ? 'Cobro registrado.' : 'Pago registrado.';
      setMovimiento(null); setDetalle(null);
      await cargar();
      toast.ok(etiqueta);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo registrar el movimiento.'); }
    finally { setBusy(false); }
  }

  function prepararMovimiento(tipoMovimiento: 'cobrar' | 'pagar', id: number, titulo: string, monto: number) {
    setFechaPago(hoy());
    setMovimiento({ tipo: tipoMovimiento, id, titulo, monto });
  }

  if (!datos) return <div className="page billing-page"><header className="page-head"><div><span className="eyebrow">Control</span><h1>Facturación</h1></div></header><Spinner label="Cargando cartera…" />{error && <p className="error-msg">{error}</p>}</div>;

  return <div className="page billing-page">
    <header className="page-head billing-page-head"><div><span className="eyebrow">Control</span><h1>Facturación</h1><p className="page-sub">Cobros a restaurantes y pagos a proveedores.</p></div></header>
    {error && <p className="notice notice--error">{error}</p>}

    <section className="billing-kpis" aria-label="Resumen de cartera">
      <div><span>Por cobrar</span><strong>{usd(datos.resumen.por_cobrar)}</strong><small>{datos.resumen.facturas_por_cobrar} factura{datos.resumen.facturas_por_cobrar === 1 ? '' : 's'} pendiente{datos.resumen.facturas_por_cobrar === 1 ? '' : 's'}</small></div>
      <div className={datos.resumen.vencido_cobrar > 0 ? 'is-overdue' : ''}><span>Cobro vencido</span><strong>{usd(datos.resumen.vencido_cobrar)}</strong><small>Restaurantes</small></div>
      <div><span>Por pagar</span><strong>{usd(datos.resumen.por_pagar)}</strong><small>{datos.resumen.facturas_por_pagar} factura{datos.resumen.facturas_por_pagar === 1 ? '' : 's'} pendiente{datos.resumen.facturas_por_pagar === 1 ? '' : 's'}</small></div>
      <div className={datos.resumen.vencido_pagar > 0 ? 'is-overdue' : ''}><span>Pago vencido</span><strong>{usd(datos.resumen.vencido_pagar)}</strong><small>Proveedores</small></div>
    </section>

    <section className="workspace-card billing-toolbar">
      <div className="segmented" aria-label="Estado de facturas"><button className={vista === 'pendientes' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setVista('pendientes')}>Pendientes</button><button className={vista === 'historial' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setVista('historial')}>Pagadas</button></div>
      <div className="segmented" aria-label="Tipo de factura"><button className={tipo === 'todas' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setTipo('todas')}>Todas</button><button className={tipo === 'cobrar' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setTipo('cobrar')}>Por cobrar</button><button className={tipo === 'pagar' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setTipo('pagar')}>Por pagar</button></div>
      <input type="search" aria-label="Buscar factura" placeholder="Buscar folio, empresa o proveedor" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
    </section>

    <div className={`billing-ledgers ${tipo !== 'todas' ? 'billing-ledgers--single' : ''}`}>
      {tipo !== 'pagar' && <section className="workspace-card billing-ledger">
        <div className="workspace-card-head"><div><span className="eyebrow">Ingresos</span><h2>Facturas emitidas</h2><p>Restaurantes que pagan a BPM.</p></div><span>{emitidas.length}</span></div>
        <div className="billing-list">{emitidas.map((factura) => {
          const vencida = factura.estado === 'emitida' && factura.vence_at < hoy();
          return <article className={`billing-row ${vencida ? 'is-overdue' : ''}`} key={factura.id}>
            <button className="billing-row-main" onClick={() => setDetalle({ tipo: 'cobrar', factura })}><strong>{factura.numero}</strong><span>{factura.ubicacion}</span><small>{factura.empresa} · {factura.linea} · semana {factura.semana}</small></button>
            <div className="billing-row-dates"><span><small>Emitida</small>{fechaCorta(factura.emitida_at)}</span><span><small>{factura.estado === 'pagada' ? 'Pagada' : 'Vence'}</small>{fechaCorta(factura.pagado_at ?? factura.vence_at)}</span></div>
            <div className="billing-row-balance"><span className={`chip ${factura.estado === 'pagada' ? 'chip--ok' : vencida ? 'chip--danger' : 'chip--warn'}`}>{factura.estado === 'pagada' ? 'Pagada' : vencida ? 'Vencida' : 'Pendiente'}</span><strong>{usd(factura.estado === 'emitida' ? factura.saldo : factura.total)}</strong><small>{factura.estado === 'emitida' ? 'saldo' : 'total'}</small></div>
            <div className="billing-row-actions"><button className="btn btn-secondary btn-sm" onClick={() => setDetalle({ tipo: 'cobrar', factura })}>Ver</button>{factura.estado === 'emitida' && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => prepararMovimiento('cobrar', factura.id, factura.numero, factura.saldo)}>Registrar cobro</button>}</div>
          </article>;
        })}{emitidas.length === 0 && <div className="empty-state"><strong>Sin facturas {vista === 'pendientes' ? 'pendientes' : 'pagadas'}</strong><span>No hay resultados con estos filtros.</span></div>}</div>
      </section>}

      {tipo !== 'cobrar' && <section className="workspace-card billing-ledger">
        <div className="workspace-card-head"><div><span className="eyebrow">Egresos</span><h2>Facturas recibidas</h2><p>Compras pendientes de pagar.</p></div><span>{recibidas.length}</span></div>
        <div className="billing-list">{recibidas.map((factura) => {
          const vencida = factura.estado === 'pendiente' && factura.vence_at < hoy();
          return <article className={`billing-row ${vencida ? 'is-overdue' : ''}`} key={factura.id}>
            <button className="billing-row-main" onClick={() => setDetalle({ tipo: 'pagar', factura })}><strong>{factura.referencia || `Compra #${factura.id}`}</strong><span>{factura.proveedor}</span><small>{factura.ubicacion}</small></button>
            <div className="billing-row-dates"><span><small>Recibida</small>{fechaCorta(factura.recibida_at)}</span><span><small>{factura.estado === 'pagada' ? 'Pagada' : 'Vence'}</small>{fechaCorta(factura.pagado_at ?? factura.vence_at)}</span></div>
            <div className="billing-row-balance"><span className={`chip ${factura.estado === 'pagada' ? 'chip--ok' : vencida ? 'chip--danger' : 'chip--warn'}`}>{factura.estado === 'pagada' ? 'Pagada' : vencida ? 'Vencida' : 'Pendiente'}</span><strong>{usd(factura.estado === 'pendiente' ? factura.saldo : factura.total)}</strong><small>{factura.estado === 'pendiente' ? 'saldo' : 'total'}</small></div>
            <div className="billing-row-actions"><button className="btn btn-secondary btn-sm" onClick={() => setDetalle({ tipo: 'pagar', factura })}>Ver</button>{factura.estado === 'pendiente' && <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => prepararMovimiento('pagar', factura.id, factura.referencia || `Compra #${factura.id}`, factura.saldo)}>Registrar pago</button>}</div>
          </article>;
        })}{recibidas.length === 0 && <div className="empty-state"><strong>Sin facturas {vista === 'pendientes' ? 'pendientes' : 'pagadas'}</strong><span>No hay resultados con estos filtros.</span></div>}</div>
      </section>}
    </div>

    {detalle && <div className="modal-backdrop" onClick={() => setDetalle(null)}><div className={`modal-card billing-detail ${detalle.tipo === 'cobrar' ? 'invoice-print' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="card-head"><div><span className="eyebrow">{detalle.tipo === 'cobrar' ? 'Factura emitida' : 'Factura recibida'}</span><strong>{detalle.tipo === 'cobrar' ? detalle.factura.numero : detalle.factura.referencia || `Compra #${detalle.factura.id}`}</strong></div><button className="icon-btn" aria-label="Cerrar" onClick={() => setDetalle(null)}>×</button></div>
      {detalle.tipo === 'cobrar' ? <>
        <div className="billing-detail-context"><div><small>Cliente</small><strong>{detalle.factura.ubicacion}</strong><span>{detalle.factura.empresa}</span></div><div><small>Periodo</small><strong>Semana {detalle.factura.semana} · {detalle.factura.anio}</strong><span>Vence {fechaCorta(detalle.factura.vence_at)}</span></div></div>
        <div className="invoice-detail">{detalle.factura.lineas.map((linea, indice) => <div key={indice}><span><strong>{linea.descripcion}</strong><small>{linea.cantidad} × {usd(linea.precio)}</small></span><strong>{usd(linea.importe)}</strong></div>)}</div>
      </> : <>
        <div className="billing-detail-context"><div><small>Proveedor</small><strong>{detalle.factura.proveedor}</strong><span>{detalle.factura.ubicacion}</span></div><div><small>Fechas</small><strong>Recibida {fechaCorta(detalle.factura.recibida_at)}</strong><span>Vence {fechaCorta(detalle.factura.vence_at)}</span></div></div>
        <div className="invoice-detail">{detalle.factura.lineas.map((linea, indice) => <div key={indice}><span><strong>{linea.producto}</strong><small>{linea.cantidad} {linea.unidad.toLowerCase()}{linea.peso_lb > 0 ? ` · ${linea.peso_lb.toLocaleString('es-MX')} lb` : ''}</small></span><strong>{usd(linea.importe)}</strong></div>)}</div>
      </>}
      <div className="invoice-grand-total"><span>{detalle.factura.estado === 'pagada' ? 'Total pagado' : 'Saldo pendiente'}</span><strong>{usd(detalle.factura.estado === 'pagada' ? detalle.factura.total : detalle.factura.saldo)}</strong></div>
      <div className="form-actions">{detalle.tipo === 'cobrar' && <button className="btn btn-secondary" onClick={() => window.print()}>Imprimir / PDF</button>}{((detalle.tipo === 'cobrar' && detalle.factura.estado === 'emitida') || (detalle.tipo === 'pagar' && detalle.factura.estado === 'pendiente')) && <button className="btn btn-primary" onClick={() => prepararMovimiento(detalle.tipo, detalle.factura.id, detalle.tipo === 'cobrar' ? detalle.factura.numero : detalle.factura.referencia || `Compra #${detalle.factura.id}`, detalle.factura.saldo)}>{detalle.tipo === 'cobrar' ? 'Registrar cobro' : 'Registrar pago'}</button>}</div>
    </div></div>}

    {movimiento && <div className="modal-backdrop" onClick={() => !busy && setMovimiento(null)}><div className="modal-card payment-dialog" onClick={(e) => e.stopPropagation()}>
      <div className="card-head"><div><span className="eyebrow">{movimiento.tipo === 'cobrar' ? 'Cobro recibido' : 'Pago a proveedor'}</span><strong>{movimiento.titulo}</strong></div><button className="icon-btn" aria-label="Cerrar" disabled={busy} onClick={() => setMovimiento(null)}>×</button></div>
      <div className="payment-dialog-amount"><span>Monto total</span><strong>{usd(movimiento.monto)}</strong></div>
      <label className="field"><span>Fecha del {movimiento.tipo === 'cobrar' ? 'cobro' : 'pago'}</span><input type="date" max={hoy()} value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} /></label>
      <div className="form-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setMovimiento(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy || !fechaPago} onClick={() => void registrarMovimiento()}>{busy ? 'Guardando…' : movimiento.tipo === 'cobrar' ? 'Confirmar cobro' : 'Confirmar pago'}</button></div>
    </div></div>}
  </div>;
}
