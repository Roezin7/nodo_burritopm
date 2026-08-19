import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, nuevaClaveIdempotencia } from '../api';
import Spinner from '../components/Spinner';
import CollapsibleSection from '../components/CollapsibleSection';
import HistoryToggle from '../components/HistoryToggle';
import { crearSemana, etiquetaRango, semanasAlrededor } from '../semana';
import { useToast } from '../toast';
import { useDialog } from '../dialog';
import Modal from '../components/Modal';
import { Icono } from '../icons';

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
  en_ciclo: boolean;
  estado_cartera: 'en_ciclo' | 'cobrada_automatica';
  sale_ciclo_at: string;
  credito_aplicado: number;
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
  pagado: number;
  saldo: number;
  pagado_at: string | null;
  lineas: { producto: string; cantidad: number; unidad: string; peso_lb: number; importe: number }[];
}

interface Cartera {
  resumen: {
    por_cobrar: number;
    por_cobrar_proyectado: number;
    documentos_proyectados: number;
    proyeccion_pendiente_produccion: boolean;
    vencido_cobrar: number;
    facturas_por_cobrar: number;
    por_pagar: number;
    vencido_pagar: number;
    facturas_por_pagar: number;
    credito_lisle_disponible: number;
  };
  emitidas: FacturaEmitida[];
  recibidas: FacturaRecibida[];
  excepciones: { tipo: string; titulo: string; detalle: string; compra_id: number; proveedor: string }[];
  creditos: {
    id: number;
    anio: number;
    semana: number;
    semana_estado: string;
    ubicacion: string;
    descripcion: string;
    monto: number;
    estado: string;
    factura: string | null;
    creado_at: string;
  }[];
}

type Detalle = { tipo: 'cobrar'; factura: FacturaEmitida } | { tipo: 'pagar'; factura: FacturaRecibida };
type Movimiento = { ids: number[]; titulo: string; saldo: number; permiteParcial: boolean };

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fechaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
const texto = (valor: string | null | undefined) => (valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function agruparPor<T>(filas: T[], clave: (fila: T) => string) {
  return [...filas.reduce((grupos, fila) => {
    const nombre = clave(fila);
    grupos.set(nombre, [...(grupos.get(nombre) ?? []), fila]);
    return grupos;
  }, new Map<string, T[]>())];
}

export default function Facturacion() {
  const toast = useToast();
  const dialog = useDialog();
  const [datos, setDatos] = useState<Cartera | null>(null);
  const [vista, setVista] = useState<'pendientes' | 'historial'>('pendientes');
  const [tipo, setTipo] = useState<'cobrar' | 'pagar'>('pagar');
  const [busqueda, setBusqueda] = useState('');
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [movimiento, setMovimiento] = useState<Movimiento | null>(null);
  const [fechaPago, setFechaPago] = useState(hoy());
  const [montoPago, setMontoPago] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [seleccionPagar, setSeleccionPagar] = useState<Set<number>>(() => new Set());
  const [mostrarCredito, setMostrarCredito] = useState(false);
  const [fechaCredito, setFechaCredito] = useState(crearSemana().inicio);
  const [montoCredito, setMontoCredito] = useState('');
  const [descripcionCredito, setDescripcionCredito] = useState('Producción de tacos dorados, tamales y otros productos');
  const [claveCredito, setClaveCredito] = useState('');
  const semanasCredito = useMemo(() => semanasAlrededor(crearSemana(), 12, 12), []);

  async function cargar() {
    setError('');
    try { setDatos(await api<Cartera>('/cierre/cartera')); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo cargar la facturación.'); }
  }

  useEffect(() => { void cargar(); }, []);

  const consulta = texto(busqueda.trim());
  const emitidas = useMemo(() => (datos?.emitidas ?? []).filter((factura) => {
    const coincideEstado = vista === 'pendientes' ? factura.en_ciclo && factura.saldo > 0 : !factura.en_ciclo;
    const coincideTexto = !consulta || texto(`${factura.numero} ${factura.empresa} ${factura.ubicacion} ${factura.linea} ${factura.semana}`).includes(consulta);
    return coincideEstado && coincideTexto;
  }), [datos, vista, consulta]);
  const recibidas = useMemo(() => (datos?.recibidas ?? []).filter((factura) => {
    const coincideEstado = vista === 'pendientes' ? factura.estado === 'pendiente' : factura.estado === 'pagada';
    const coincideTexto = !consulta || texto(`${factura.referencia ?? ''} ${factura.proveedor} ${factura.ubicacion}`).includes(consulta);
    return coincideEstado && coincideTexto;
  }), [datos, vista, consulta]);
  const recibidasPorProveedor = useMemo(() => agruparPor(recibidas, (factura) => factura.proveedor)
    .sort(([a], [b]) => a.localeCompare(b, 'es')), [recibidas]);
  // Las cuentas por cobrar se muestran por restaurante, no por empresa matriz.
  // Una empresa puede tener varias sucursales y cada sucursal puede tener una
  // factura de carne y otra de desechables; agrupar sólo por empresa hacía
  // parecer que todo era una sola factura.
  const emitidasPorRestaurante = useMemo(() => agruparPor(emitidas, (factura) => `${factura.empresa} · ${factura.ubicacion}`)
    .sort(([a], [b]) => a.localeCompare(b, 'es')), [emitidas]);

  async function registrarMovimiento() {
    if (!movimiento) return;
    setBusy(true); setError('');
    try {
      const lote = movimiento.ids.length > 1;
      const ruta = lote ? '/cierre/compras/pagar-lote' : `/cierre/compras/${movimiento.ids[0]}/pagar`;
      const monto = Number(montoPago);
      await api(ruta, {
        method: 'POST',
        body: lote ? { ids: movimiento.ids, fecha_pago: fechaPago } : { fecha_pago: fechaPago, monto },
      });
      setMovimiento(null); setDetalle(null);
      setSeleccionPagar(new Set());
      await cargar();
      toast.ok('Pago registrado.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo registrar el movimiento.'); }
    finally { setBusy(false); }
  }

  function prepararMovimiento(id: number, titulo: string, monto: number) {
    setFechaPago(hoy());
    setMontoPago(monto.toFixed(2));
    setMovimiento({ ids: [id], titulo, saldo: monto, permiteParcial: true });
  }

  function prepararLote() {
    const ids = [...seleccionPagar];
    const documentos = recibidas.filter((f) => ids.includes(f.id));
    const monto = documentos.reduce((suma, documento) => suma + documento.saldo, 0);
    setFechaPago(hoy());
    setMontoPago(monto.toFixed(2));
    setMovimiento({ ids, titulo: `${ids.length} documentos seleccionados`, saldo: monto, permiteParcial: false });
  }

  async function revertirMovimiento(id: number) {
    if (!await dialog.confirm({ title: 'Revertir pago', description: 'El documento volverá a pendientes y su saldo se restaurará.', confirmLabel: 'Revertir pago', tone: 'danger' })) return;
    setBusy(true); setError('');
    try {
      await api(`/cierre/compras/${id}/pago`, { method: 'DELETE' });
      await cargar(); toast.ok('Pago revertido.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo revertir el movimiento.'); }
    finally { setBusy(false); }
  }

  function alternarSeleccion(id: number) {
    setSeleccionPagar((actual) => { const siguiente = new Set(actual); if (siguiente.has(id)) siguiente.delete(id); else siguiente.add(id); return siguiente; });
  }

  function abrirCredito() {
    setFechaCredito(crearSemana().inicio);
    setMontoCredito('');
    setDescripcionCredito('Producción de tacos dorados, tamales y otros productos');
    setClaveCredito(nuevaClaveIdempotencia('credito-lisle'));
    setMostrarCredito(true);
  }

  async function registrarCredito() {
    const monto = Number(montoCredito);
    if (!fechaCredito || !Number.isFinite(monto) || monto <= 0 || descripcionCredito.trim().length < 3) return;
    setBusy(true); setError('');
    try {
      await api('/cierre/creditos-lisle', {
        method: 'POST',
        body: { fecha_semana: fechaCredito, monto, descripcion: descripcionCredito.trim(), idempotency_key: claveCredito },
      });
      setMostrarCredito(false);
      await cargar();
      toast.ok('Crédito de Lisle guardado para el cierre semanal.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar el crédito de Lisle.'); }
    finally { setBusy(false); }
  }

  async function eliminarCredito(id: number) {
    if (!await dialog.confirm({ title: 'Eliminar crédito de Lisle', description: 'El crédito abierto dejará de aplicarse al cierre semanal.', confirmLabel: 'Eliminar crédito', tone: 'danger' })) return;
    setBusy(true); setError('');
    try {
      await api(`/cierre/creditos-lisle/${id}`, { method: 'DELETE' });
      await cargar(); toast.ok('Crédito eliminado.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo eliminar el crédito.'); }
    finally { setBusy(false); }
  }

  function filaEmitida(factura: FacturaEmitida) {
    const vencida = factura.en_ciclo && factura.vence_at < hoy();
    return <article className={`billing-row ${vencida ? 'is-overdue' : ''}`} key={factura.id}>
      <button className="billing-row-main" onClick={() => setDetalle({ tipo: 'cobrar', factura })}><strong>{factura.numero}</strong><span>{factura.ubicacion}</span><small>{factura.empresa} · {factura.linea} · semana {factura.semana}</small></button>
      <div className="billing-row-dates"><span><small>Emitida</small>{fechaCorta(factura.emitida_at)}</span><span><small>{factura.en_ciclo ? 'Sale del ciclo' : 'Salió del ciclo'}</small>{fechaCorta(factura.sale_ciclo_at)}</span></div>
      <div className="billing-row-balance"><span className={`chip ${factura.en_ciclo ? vencida ? 'chip--danger' : 'chip--warn' : 'chip--ok'}`}>{factura.en_ciclo ? vencida ? 'En ventana · vencida' : 'En ventana' : 'Fuera de ventana'}</span><strong>{usd(factura.en_ciclo ? factura.saldo : factura.total)}</strong><small>{factura.credito_aplicado > 0 ? `${usd(factura.credito_aplicado)} crédito Lisle` : factura.en_ciclo ? 'incluido en el balance' : 'total histórico'}</small></div>
    </article>;
  }

  function filaRecibida(factura: FacturaRecibida) {
    const vencida = factura.estado === 'pendiente' && factura.vence_at < hoy();
    const abonada = factura.estado === 'pendiente' && factura.pagado > 0;
    return <article className={`billing-row ${vencida ? 'is-overdue' : ''}`} key={factura.id}>
      {factura.estado === 'pendiente' && <input className="billing-row-check" type="checkbox" aria-label={`Seleccionar compra ${factura.referencia ?? factura.id}`} checked={seleccionPagar.has(factura.id)} onChange={() => alternarSeleccion(factura.id)} />}
      <button className="billing-row-main" onClick={() => setDetalle({ tipo: 'pagar', factura })}><strong>{factura.referencia || `Compra #${factura.id}`}</strong><span>{factura.proveedor}</span><small>{factura.ubicacion}</small></button>
      <div className="billing-row-dates"><span><small>Recibida</small>{fechaCorta(factura.recibida_at)}</span><span><small>{factura.estado === 'pagada' ? 'Pagada' : 'Vence'}</small>{fechaCorta(factura.pagado_at ?? factura.vence_at)}</span></div>
      <div className="billing-row-balance"><span className={`chip ${factura.estado === 'pagada' ? 'chip--ok' : vencida ? 'chip--danger' : 'chip--warn'}`}>{factura.estado === 'pagada' ? 'Pagada' : abonada ? 'Pago parcial' : vencida ? 'Vencida' : 'Pendiente'}</span><strong>{usd(factura.estado === 'pendiente' ? factura.saldo : factura.total)}</strong><small>{abonada ? `${usd(factura.pagado)} abonado` : factura.estado === 'pendiente' ? 'saldo' : 'total'}</small></div>
      <div className="billing-row-actions">{factura.estado === 'pendiente' ? <><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => prepararMovimiento(factura.id, factura.referencia || `Compra #${factura.id}`, factura.saldo)}>Registrar pago</button>{abonada && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void revertirMovimiento(factura.id)}>Revertir pagos</button>}</> : <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void revertirMovimiento(factura.id)}>Revertir</button>}</div>
    </article>;
  }

  if (!datos) return <div className="page billing-page"><header className="page-head"><div><span className="eyebrow">Control</span><h1>Facturación</h1></div></header><Spinner label="Cargando cartera…" />{error && <p className="error-msg">{error}</p>}</div>;

  return <div className="page billing-page">
    <header className="page-head billing-page-head"><div><span className="eyebrow">Finanzas</span><h1>{tipo === 'pagar' ? 'Cuentas por pagar' : 'Facturación a restaurantes'}</h1><p className="page-sub">{tipo === 'pagar' ? 'Documentos y pagos agrupados por proveedor.' : 'Facturas generadas por el cierre y ventana operativa de tres semanas.'}</p></div></header>
    {error && <p className="notice notice--error">{error}</p>}

    {tipo === 'pagar' && datos.excepciones.length > 0 && <details className="billing-help billing-exceptions">
      <summary>{datos.excepciones.length} excepción{datos.excepciones.length === 1 ? '' : 'es'} por revisar</summary>
      <div>{datos.excepciones.map((excepcion, indice) => <button type="button" key={`${excepcion.tipo}:${excepcion.compra_id}:${indice}`} onClick={() => { const factura = datos.recibidas.find((item) => item.id === excepcion.compra_id); if (factura) setDetalle({ tipo: 'pagar', factura }); }}><span><strong>{excepcion.titulo}</strong><small>{excepcion.detalle}</small></span><Icono name="chevron" size={16} /></button>)}</div>
    </details>}

    <section className="billing-kpis" aria-label="Resumen de cartera">
      <div><span>Por cobrar · ciclo 3 semanas</span><strong>{usd(datos.resumen.por_cobrar)}</strong><small>{datos.resumen.proyeccion_pendiente_produccion ? 'Proyección pendiente: registrar producción semanal' : datos.resumen.documentos_proyectados > 0 ? `Incluye proyección actual: ${usd(datos.resumen.por_cobrar_proyectado)}` : 'Semana actual + las 2 anteriores'}</small></div>
      <div className={datos.resumen.vencido_cobrar > 0 ? 'is-overdue' : ''}><span>Con fecha vencida</span><strong>{usd(datos.resumen.vencido_cobrar)}</strong><small>Informativo dentro de la ventana</small></div>
      <div><span>Total por pagar</span><strong>{usd(datos.resumen.por_pagar)}</strong><small>Incluye {usd(datos.resumen.vencido_pagar)} ya vencidos</small></div>
      <div className={datos.resumen.vencido_pagar > 0 ? 'is-overdue' : ''}><span>De ese total, vencido</span><strong>{usd(datos.resumen.vencido_pagar)}</strong><small>No se suma otra vez · proveedores</small></div>
    </section>

    <details className="billing-help">
      <summary>Cómo funciona la cartera</summary>
      <p>Las facturas emitidas forman parte del balance durante su semana y las dos siguientes. Si la semana actual sigue abierta, sus pedidos confirmados se muestran como proyección y se reemplazan por la factura al cerrar. Después quedan fuera de esa ventana; esto no registra un cobro ni un movimiento bancario. Los pagos a proveedores sí se confirman manualmente y los créditos de producción reducen exclusivamente la cuenta de Lisle.</p>
    </details>

    <CollapsibleSection className="lisle-credit-panel" title="Créditos de Lisle" count={datos.creditos.filter((credito) => credito.estado === 'abierto').length} summary={datos.resumen.credito_lisle_disponible > 0 ? `${usd(datos.resumen.credito_lisle_disponible)} disponible` : 'Saldo a favor por producción'}>
      <div className="workspace-card-head"><div><p>Producción hecha por Lisle que BPM debe reconocer al cierre.</p></div><button className="btn btn-secondary" onClick={abrirCredito}>Agregar crédito</button></div>
      {datos.resumen.credito_lisle_disponible > 0 && <div className="lisle-credit-available"><span>Crédito disponible después de compensar facturas</span><strong>{usd(datos.resumen.credito_lisle_disponible)}</strong></div>}
      <div className="lisle-credit-list">{datos.creditos.slice(0, 6).map((credito) => <div key={credito.id}><span><strong>{credito.descripcion}</strong><small>Semana {credito.semana} · {credito.anio} · {credito.estado === 'abierto' ? 'se aplicará al cierre' : `aplicado en ${credito.factura ?? 'factura semanal'}`}</small></span><strong>{usd(credito.monto)}</strong>{credito.estado === 'abierto' && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void eliminarCredito(credito.id)}>Eliminar</button>}</div>)}{datos.creditos.length === 0 && <p className="muted">Todavía no hay créditos registrados.</p>}</div>
    </CollapsibleSection>

    <section className="workspace-card billing-toolbar">
      <HistoryToggle active={vista === 'historial'} onToggle={() => setVista(vista === 'historial' ? 'pendientes' : 'historial')} />
      <div className="segmented" aria-label="Libro financiero"><button className={tipo === 'pagar' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setTipo('pagar')}>Cuentas por pagar</button><button className={tipo === 'cobrar' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setTipo('cobrar')}>Facturación a restaurantes</button></div>
      <input type="search" aria-label="Buscar factura" placeholder="Buscar folio, empresa o proveedor" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
    </section>
    {vista === 'pendientes' && seleccionPagar.size > 0 && <section className="billing-bulkbar">
      <span>{seleccionPagar.size} documento{seleccionPagar.size === 1 ? '' : 's'} seleccionado{seleccionPagar.size === 1 ? '' : 's'}</span>
      <div><button className="btn btn-primary btn-sm" disabled={busy} onClick={prepararLote}>Registrar {seleccionPagar.size} pagos</button><button className="btn btn-ghost btn-sm" onClick={() => setSeleccionPagar(new Set())}>Limpiar selección</button></div>
    </section>}

    <div className="billing-ledgers billing-ledgers--single">
      {tipo === 'cobrar' && <section className="workspace-card billing-ledger">
        <div className="workspace-card-head"><div><span className="eyebrow">Ingresos</span><h2>Facturas emitidas</h2><p>Entran durante tres semanas y después pasan solas al historial.</p></div><div className="billing-select-head"><span>{emitidas.length}</span></div></div>
        <div className="billing-groups">
          {emitidasPorRestaurante.map(([restaurante, facturas]) => <details className="billing-group" open key={restaurante}><summary><span><strong>{restaurante}</strong><small>{facturas.length} factura{facturas.length === 1 ? '' : 's'} separadas por línea</small></span><strong>{usd(facturas.reduce((total, factura) => total + (factura.en_ciclo ? factura.saldo : factura.total), 0))}</strong></summary><div className="billing-list">{facturas.map(filaEmitida)}</div></details>)}
          {emitidas.length === 0 && <div className="empty-state"><strong>Sin facturas {vista === 'pendientes' ? 'pendientes' : 'pagadas'}</strong><span>No hay resultados con estos filtros.</span></div>}
        </div>
      </section>}

      {tipo === 'pagar' && <section className="workspace-card billing-ledger">
        <div className="workspace-card-head"><div><span className="eyebrow">Egresos</span><h2>Facturas recibidas</h2><p>Compras pendientes de pagar.</p></div><div className="billing-select-head"><span>{recibidas.length}</span>{vista === 'pendientes' && recibidas.length > 0 && <button className="link-btn" onClick={() => setSeleccionPagar(seleccionPagar.size === recibidas.length ? new Set() : new Set(recibidas.map((factura) => factura.id)))}>{seleccionPagar.size === recibidas.length ? 'Quitar todas' : 'Seleccionar todas'}</button>}</div></div>
        <div className="billing-groups">
          {recibidasPorProveedor.map(([proveedor, facturas]) => <details className="billing-group" open key={proveedor}><summary><span><strong>{proveedor}</strong><small>{facturas.length} documento{facturas.length === 1 ? '' : 's'}</small></span><strong>{usd(facturas.reduce((total, factura) => total + (factura.estado === 'pendiente' ? factura.saldo : factura.total), 0))}</strong></summary><div className="billing-list">{facturas.map(filaRecibida)}</div></details>)}
          {recibidas.length === 0 && <div className="empty-state"><strong>Sin facturas {vista === 'pendientes' ? 'pendientes' : 'pagadas'}</strong><span>No hay resultados con estos filtros.</span></div>}
        </div>
      </section>}
    </div>

    {detalle && <Modal className={`billing-detail ${detalle.tipo === 'cobrar' ? 'invoice-print' : ''}`} ariaLabelledBy="billing-detail-title" onClose={() => setDetalle(null)}>
      <div className="card-head"><div><span className="eyebrow">{detalle.tipo === 'cobrar' ? 'Factura emitida' : 'Factura recibida'}</span><strong id="billing-detail-title">{detalle.tipo === 'cobrar' ? detalle.factura.numero : detalle.factura.referencia || `Compra #${detalle.factura.id}`}</strong></div><button className="icon-btn" aria-label="Cerrar" onClick={() => setDetalle(null)}><Icono name="x" /></button></div>
      {detalle.tipo === 'cobrar' ? <>
        <div className="billing-detail-context"><div><small>Cliente</small><strong>{detalle.factura.ubicacion}</strong><span>{detalle.factura.empresa}</span></div><div><small>Periodo</small><strong>Semana {detalle.factura.semana} · {detalle.factura.anio}</strong><span>Vence {fechaCorta(detalle.factura.vence_at)}</span></div></div>
        <div className="invoice-detail">{detalle.factura.lineas.map((linea, indice) => <div key={indice}><span><strong>{linea.descripcion}</strong><small>{linea.cantidad} × {usd(linea.precio)}</small></span><strong>{usd(linea.importe)}</strong></div>)}</div>
      </> : <>
        <div className="billing-detail-context"><div><small>Proveedor</small><strong>{detalle.factura.proveedor}</strong><span>{detalle.factura.ubicacion}</span></div><div><small>Fechas</small><strong>Recibida {fechaCorta(detalle.factura.recibida_at)}</strong><span>Vence {fechaCorta(detalle.factura.vence_at)}</span></div></div>
        <div className="invoice-detail">{detalle.factura.lineas.map((linea, indice) => <div key={indice}><span><strong>{linea.producto}</strong><small>{linea.cantidad} {linea.unidad.toLowerCase()}{linea.peso_lb > 0 ? ` · ${linea.peso_lb.toLocaleString('es-MX')} lb` : ''}</small></span><strong>{usd(linea.importe)}</strong></div>)}</div>
      </>}
      <div className="invoice-grand-total"><span>{detalle.tipo === 'cobrar' ? detalle.factura.en_ciclo ? 'Saldo del ciclo' : 'Total histórico' : detalle.factura.estado === 'pagada' ? 'Total pagado' : 'Saldo pendiente'}</span><strong>{usd(detalle.tipo === 'cobrar' ? detalle.factura.en_ciclo ? detalle.factura.saldo : detalle.factura.total : detalle.factura.estado === 'pagada' ? detalle.factura.total : detalle.factura.saldo)}</strong></div>
      {detalle.tipo === 'cobrar' && detalle.factura.credito_aplicado > 0 && <p className="billing-credit-note">Este saldo ya descuenta {usd(detalle.factura.credito_aplicado)} del crédito de producción de Lisle.</p>}
      <div className="form-actions">{detalle.tipo === 'cobrar' && <button className="btn btn-secondary" onClick={() => window.print()}>Imprimir / PDF</button>}{detalle.tipo === 'pagar' && detalle.factura.estado === 'pendiente' && <button className="btn btn-primary" onClick={() => prepararMovimiento(detalle.factura.id, detalle.factura.referencia || `Compra #${detalle.factura.id}`, detalle.factura.saldo)}>Registrar pago</button>}</div>
    </Modal>}

    {movimiento && <Modal className="payment-dialog" ariaLabelledBy="payment-dialog-title" closeOnBackdrop={!busy} closeOnEscape={!busy} onClose={() => setMovimiento(null)}>
      <div className="card-head"><div><span className="eyebrow">Pago a proveedor</span><strong id="payment-dialog-title">{movimiento.titulo}</strong></div><button className="icon-btn" aria-label="Cerrar" disabled={busy} onClick={() => setMovimiento(null)}><Icono name="x" /></button></div>
      <div className="payment-dialog-amount"><span>{movimiento.permiteParcial ? 'Saldo pendiente' : 'Monto total'}</span><strong>{usd(movimiento.saldo)}</strong></div>
      <label className="field"><span>Monto del pago</span><input type="number" min="0.01" max={movimiento.saldo} step="0.01" inputMode="decimal" value={montoPago} disabled={!movimiento.permiteParcial} onChange={(e) => setMontoPago(e.target.value)} />{movimiento.permiteParcial && <small>Puedes registrar un abono o liquidar el saldo completo.</small>}</label>
      <label className="field"><span>Fecha del pago</span><input type="date" max={hoy()} value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} /></label>
      <div className="form-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setMovimiento(null)}>Cancelar</button><button className="btn btn-primary" disabled={busy || !fechaPago || Number(montoPago) <= 0 || Number(montoPago) > movimiento.saldo} onClick={() => void registrarMovimiento()}>{busy ? 'Guardando…' : Number(montoPago) < movimiento.saldo ? 'Registrar abono' : 'Confirmar pago'}</button></div>
    </Modal>}

    {mostrarCredito && <Modal className="payment-dialog" ariaLabelledBy="credit-dialog-title" closeOnBackdrop={!busy} closeOnEscape={!busy} onClose={() => setMostrarCredito(false)}>
      <div className="card-head"><div><span className="eyebrow">Ajuste de facturación</span><strong id="credit-dialog-title">Nuevo crédito de Lisle</strong></div><button className="icon-btn" aria-label="Cerrar" disabled={busy} onClick={() => setMostrarCredito(false)}><Icono name="x" /></button></div>
      <p className="muted">La ubicación está fija en Lisle. El crédito no modifica ventas ni inventario; reduce su cuenta al cerrar la semana seleccionada.</p>
      <label className="field"><span>Semana del crédito</span><select value={fechaCredito} onChange={(e) => setFechaCredito(e.target.value)}>{semanasCredito.map((semana) => <option key={semana.inicio} value={semana.inicio}>Semana {semana.numero} · {semana.anio} · {etiquetaRango(semana)}</option>)}</select><small>El crédito se aplicará cuando cierres esta semana.</small></label>
      <label className="field"><span>Monto del crédito</span><input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={montoCredito} onChange={(e) => setMontoCredito(e.target.value)} /></label>
      <label className="field"><span>Concepto</span><input value={descripcionCredito} maxLength={180} onChange={(e) => setDescripcionCredito(e.target.value)} /></label>
      <div className="form-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setMostrarCredito(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy || !fechaCredito || Number(montoCredito) <= 0 || descripcionCredito.trim().length < 3} onClick={() => void registrarCredito()}>{busy ? 'Guardando…' : 'Guardar crédito'}</button></div>
    </Modal>}
  </div>;
}
