import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';

type Linea = 'carne' | 'desechables';
interface Catalogo {
  ubicaciones: { id: number; nombre: string; tipo: string; empresa: { id: number; nombre: string; codigo: string } | null; entrega_en: { id: number; nombre: string } | null }[];
  productos: { id: number; nombre: string; linea: Linea; tipo: string; unidad: string; precio: number | null; peso_caja_lb: number | null }[];
  semanas: { id: number; anio: number; semana: number; inicia_at: string; termina_at: string; estado: string }[];
}
interface Pedido {
  id: number; linea: Linea; fecha_entrega: string; estado: string; notas?: string | null;
  empresa: { id: number; nombre: string; codigo: string };
  ubicacion: { id: number; nombre: string; entrega_en: { id: number; nombre: string } | null };
  lineas: { id: number; product_id: number; nombre: string; sku: string; cantidad: number; precio: number | null }[];
}

function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
function siguienteMiercoles() {
  const d = new Date(`${hoy()}T12:00:00`);
  let n = (3 - d.getDay() + 7) % 7;
  if (n === 0) n = 7;
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}
const usd = (n: number | null) => n == null ? 'Precio pendiente' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const esPieza = (p: { unidad: string }) => p.unidad.toLowerCase().includes('pieza');
const unidadCorta = (p: { unidad: string }) => esPieza(p) ? 'pzas' : 'cajas';
const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function rangoSemana(valor: string) {
  const d = new Date(`${valor}T12:00:00`);
  const desplazamiento = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + desplazamiento);
  const inicio = d.toLocaleDateString('en-CA');
  d.setDate(d.getDate() + 5);
  return { inicio, fin: d.toLocaleDateString('en-CA') };
}

export default function Pedidos({ integrado = false }: { integrado?: boolean }) {
  const { usuario } = useAuth();
  const toast = useToast();
  const admin = usuario?.rol === 'admin';
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [linea, setLinea] = useState<Linea>('carne');
  const [ubicacionId, setUbicacionId] = useState('');
  const [fecha, setFecha] = useState(siguienteMiercoles());
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [notas, setNotas] = useState('');
  const [buscar, setBuscar] = useState('');
  const [vista, setVista] = useState<'captura' | 'historial'>('captura');
  const [fechaHistorial, setFechaHistorial] = useState(hoy());
  const [historial, setHistorial] = useState<Pedido[]>([]);
  const [historialUbicacion, setHistorialUbicacion] = useState('todas');
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [impresion, setImpresion] = useState<{ linea: Linea; inicio: string; fin: string; pedidos: Pedido[] } | null>(null);
  const [cargandoImpresion, setCargandoImpresion] = useState(false);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Catalogo>('/operacion/catalogo').then((c) => {
      setCatalogo(c);
      if (c.semanas[0]) setFechaHistorial(c.semanas[0].inicia_at);
      const asignada = admin ? c.ubicaciones.find((u) => u.tipo === 'sucursal' && u.empresa) : c.ubicaciones.find((u) => usuario?.ubicaciones?.some((x) => x.id === u.id));
      if (asignada) setUbicacionId(String(asignada.id));
    }).catch(() => setError('No se pudo cargar el catálogo de pedidos.'));
  }, [admin, usuario]);

  const ubicaciones = useMemo(() => {
    if (!catalogo) return [];
    const todas = catalogo.ubicaciones.filter((u) => u.tipo === 'sucursal' && u.empresa);
    return admin ? todas : todas.filter((u) => usuario?.ubicaciones?.some((x) => x.id === u.id));
  }, [catalogo, admin, usuario]);
  const productos = useMemo(() => catalogo?.productos.filter((p) => p.linea === linea && p.tipo !== 'materia_prima') ?? [], [catalogo, linea]);

  useEffect(() => {
    if (vista !== 'captura' || !ubicacionId || !fecha) return;
    setError('');
    api<Pedido[]>(`/operacion/pedidos?ubicacion_id=${ubicacionId}&linea=${linea}&desde=${fecha}&hasta=${fecha}`)
      .then((rows) => {
        const p = rows[0];
        setEstado(p?.estado ?? null);
        setNotas(p?.notas ?? '');
        setCantidades(Object.fromEntries((p?.lineas ?? []).map((l) => [l.product_id, String(l.cantidad)])));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el pedido.'));
  }, [ubicacionId, linea, fecha, vista]);

  useEffect(() => {
    if (!admin || vista !== 'historial') return;
    const rango = rangoSemana(fechaHistorial);
    setCargandoHistorial(true); setError('');
    api<Pedido[]>(`/operacion/pedidos?linea=${linea}&desde=${rango.inicio}&hasta=${rango.fin}`)
      .then(setHistorial)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el historial.'))
      .finally(() => setCargandoHistorial(false));
  }, [admin, vista, fechaHistorial, linea]);

  async function guardar(confirmar: boolean) {
    if (!ubicacionId) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ estado: string }>('/operacion/pedidos', {
        method: 'PUT',
        body: { ubicacion_id: Number(ubicacionId), linea, fecha_entrega: fecha, confirmar, notas: notas.trim() || null, lineas: productos.map((p) => ({ product_id: p.id, cantidad: Number(cantidades[p.id] || 0) })) },
      });
      setEstado(r.estado);
      toast.ok(confirmar ? 'Pedido confirmado.' : 'Avance guardado.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }

  async function crearDistribucion() {
    setBusy(true); setError('');
    try {
      const r = await api<{ id: number; pedidos: number }>('/operacion/distribuciones', { method: 'POST', body: { linea, fecha_entrega: fecha } });
      toast.ok(`Distribución #${r.id} creada con ${r.pedidos} pedidos y sus rutas.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo crear la distribución.'); }
    finally { setBusy(false); }
  }

  async function abrirImpresion(lineaObjetivo: Linea, fechaBase: string) {
    const rango = rangoSemana(fechaBase);
    setCargandoImpresion(true); setError('');
    try {
      const rows = await api<Pedido[]>(`/operacion/pedidos?linea=${lineaObjetivo}&desde=${rango.inicio}&hasta=${rango.fin}`);
      setImpresion({ linea: lineaObjetivo, ...rango, pedidos: rows.filter((p) => !['borrador', 'cancelado'].includes(p.estado)) });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo preparar la orden para imprimir.'); }
    finally { setCargandoImpresion(false); }
  }

  if (!catalogo) return <div className="page"><Spinner /><p className="error-msg">{error}</p></div>;
  const ubic = ubicaciones.find((u) => String(u.id) === ubicacionId);
  const total = productos.reduce((a, p) => a + Number(cantidades[p.id] || 0) * (p.precio ?? 0), 0);
  const unidades = productos.reduce((a, p) => a + Number(cantidades[p.id] || 0), 0);
  const conCantidad = productos.filter((p) => Number(cantidades[p.id] || 0) > 0).length;
  const q = buscar.trim().toLowerCase();
  const visibles = productos.filter((p) => !q || `${p.nombre} ${p.tipo}`.toLowerCase().includes(q));
  return (
    <div className={integrado ? 'order-page order-embedded' : 'page order-page'}>
      {!integrado && <header className="page-head operation-page-head"><div><span className="eyebrow">Pedidos</span><h1>Pedido semanal</h1></div>{vista === 'captura' && estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      {integrado && <header className="embedded-head embedded-head--status"><div><span className="eyebrow">Paso 1</span><h2>Pedidos</h2></div>{vista === 'captura' && estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      <div className="order-switches">
        {admin && <div className="segmented order-view-switch"><button className={vista === 'captura' ? 'tab tab--on' : 'tab'} onClick={() => setVista('captura')}>Capturar</button><button className={vista === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setVista('historial')}>Historial por sucursal</button></div>}
        <div className="segmented order-line-switch">
        <button className={linea === 'carne' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('carne')}>Carne</button>
        <button className={linea === 'desechables' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('desechables')}>Desechables</button>
        </div>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {vista === 'captura' ? <div className="order-workspace">
        <section className="order-capture">
          <div className="workspace-card order-context">
            <label className="field field--wide"><span>Restaurante</span><select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.empresa?.nombre}</option>)}</select></label>
            <label className="field"><span>Fecha de entrega</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          </div>
          {ubic?.entrega_en && <p className="notice">Se factura a <strong>{ubic.nombre}</strong> y se entrega físicamente en <strong>{ubic.entrega_en.nombre}</strong>.</p>}
          <section className="workspace-card product-picker">
            <div className="workspace-card-head"><h2>Productos</h2><input className="compact-search" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar" /></div>
            <div className="order-product-list">{visibles.map((p) => <label key={p.id} className={`order-product ${Number(cantidades[p.id] || 0) > 0 ? 'has-quantity' : ''}`}>
              <span><strong>{p.nombre}</strong><small>{p.peso_caja_lb ? `${p.peso_caja_lb} lb por caja` : p.unidad} · {usd(p.precio)}</small></span>
              <div className="input-suffix input-suffix--compact"><input inputMode="decimal" type="number" min="0" step={esPieza(p) ? '1' : '0.5'} value={cantidades[p.id] ?? ''} placeholder="0" onChange={(e) => setCantidades({ ...cantidades, [p.id]: e.target.value })} /><span>{unidadCorta(p)}</span></div>
            </label>)}</div>
          </section>
          <label className="workspace-card field order-notes"><span>Notas del pedido <em>opcional</em></span><textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Instrucciones especiales, sustituciones o entrega…" /></label>
        </section>
        <aside className="order-summary">
          <span className="eyebrow">Resumen del pedido</span><h2>{ubic?.nombre ?? 'Selecciona restaurante'}</h2><p>{fecha} · {linea}</p>
          <dl><div><dt>Productos</dt><dd>{conCantidad}</dd></div><div><dt>Unidades</dt><dd>{unidades.toLocaleString('es-MX')}</dd></div><div><dt>Total</dt><dd>{usd(total)}</dd></div></dl>
          <div className="order-actions"><button className="btn btn-secondary" disabled={busy || !ubicacionId} onClick={() => void guardar(false)}>Guardar</button><button className="btn btn-primary" disabled={busy || !ubicacionId || unidades <= 0} onClick={() => void guardar(true)}>{busy ? 'Guardando…' : 'Confirmar'}</button></div>
          {admin && <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => void crearDistribucion()}>Crear preparación y rutas</button>}
          {admin && <div className="order-print-actions"><span>Orden semanal consolidada</span><button className="btn btn-secondary btn-block" disabled={cargandoImpresion} onClick={() => void abrirImpresion('carne', fecha)}>Imprimir carne</button><button className="btn btn-secondary btn-block" disabled={cargandoImpresion} onClick={() => void abrirImpresion('desechables', fecha)}>Imprimir desechables</button></div>}
        </aside>
      </div> : <HistorialPedidos pedidos={historial} cargando={cargandoHistorial} linea={linea} fecha={fechaHistorial} setFecha={setFechaHistorial} ubicacion={historialUbicacion} setUbicacion={setHistorialUbicacion} ubicaciones={ubicaciones} semanas={catalogo.semanas} onPrint={() => void abrirImpresion(linea, fechaHistorial)} />}
      {impresion && <OrdenImprimible datos={impresion} catalogo={catalogo} onClose={() => setImpresion(null)} />}
    </div>
  );
}

function HistorialPedidos({ pedidos, cargando, linea, fecha, setFecha, ubicacion, setUbicacion, ubicaciones, semanas, onPrint }: {
  pedidos: Pedido[]; cargando: boolean; linea: Linea; fecha: string; setFecha: (v: string) => void; ubicacion: string; setUbicacion: (v: string) => void;
  ubicaciones: Catalogo['ubicaciones']; semanas: Catalogo['semanas']; onPrint: () => void;
}) {
  const rango = rangoSemana(fecha);
  const indiceSemana = semanas.findIndex((s) => s.inicia_at === fecha);
  const semanaActual = semanas[indiceSemana] ?? semanas[0];
  const anterior = semanas[indiceSemana + 1];
  const siguiente = indiceSemana > 0 ? semanas[indiceSemana - 1] : undefined;
  const filtrados = pedidos.filter((p) => ubicacion === 'todas' || String(p.ubicacion.id) === ubicacion);
  const fechas = [...new Set(filtrados.map((p) => p.fecha_entrega))].sort();
  const unidades = filtrados.flatMap((p) => p.lineas).reduce((a, l) => a + l.cantidad, 0);
  const total = filtrados.flatMap((p) => p.lineas).reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  return <div className="order-history">
    <section className="workspace-card history-toolbar">
      <div><span className="eyebrow">Periodo</span><h2>Semana {semanaActual?.semana ?? '—'}</h2><p>{rango.inicio} al {rango.fin}</p></div>
      <div className="history-week-controls"><button className="icon-btn" disabled={!anterior} aria-label="Semana anterior" onClick={() => anterior && setFecha(anterior.inicia_at)}>←</button><select aria-label="Semana" value={semanaActual?.inicia_at ?? fecha} onChange={(e) => setFecha(e.target.value)}>{semanas.map((s) => <option key={s.id} value={s.inicia_at}>Semana {s.semana} · {s.inicia_at} al {s.termina_at}</option>)}</select><button className="icon-btn" disabled={!siguiente} aria-label="Semana siguiente" onClick={() => siguiente && setFecha(siguiente.inicia_at)}>→</button></div>
      <label className="field"><span>Sucursal</span><select value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}><option value="todas">Todas las sucursales</option>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>
      <button className="btn btn-primary" disabled={cargando || !pedidos.length} onClick={onPrint}>Imprimir orden total</button>
    </section>
    {cargando ? <Spinner label="Cargando pedidos…" /> : <>
      <div className="metric-strip metric-strip--four"><div><span>Sucursales</span><strong>{new Set(filtrados.map((p) => p.ubicacion.id)).size}</strong></div><div><span>Pedidos</span><strong>{filtrados.length}</strong></div><div><span>Unidades</span><strong>{unidades.toLocaleString('es-MX')}</strong></div><div><span>Importe</span><strong>{usd(total)}</strong></div></div>
      {fechas.map((dia) => <section className="history-day" key={dia}><div className="section-heading"><div><span className="eyebrow">Entrega</span><h2>{fechaLarga(dia)}</h2></div><span>{filtrados.filter((p) => p.fecha_entrega === dia).length} sucursales</span></div><div className="history-location-grid">{filtrados.filter((p) => p.fecha_entrega === dia).map((p) => <PedidoHistorico key={p.id} pedido={p} />)}</div></section>)}
      {!filtrados.length && <div className="empty-state"><strong>No hay pedidos de {linea} esta semana</strong><span>Cambia la semana, la línea o la sucursal.</span></div>}
    </>}
  </div>;
}

function PedidoHistorico({ pedido }: { pedido: Pedido }) {
  const total = pedido.lineas.reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  return <article className="history-order-card"><header><div><strong>{pedido.ubicacion.nombre}</strong><small>{pedido.empresa.nombre}</small></div><span className={`order-status order-status--${pedido.estado}`}>{pedido.estado.replaceAll('_', ' ')}</span></header><div>{pedido.lineas.map((l) => <div className="history-order-line" key={l.id}><span><strong>{l.nombre}</strong><small>{l.sku}</small></span><span>{l.cantidad.toLocaleString('es-MX')} × {usd(l.precio)}</span><strong>{usd(l.cantidad * (l.precio ?? 0))}</strong></div>)}</div><footer><span>{pedido.notas ?? ''}</span><strong>{usd(total)}</strong></footer></article>;
}

function OrdenImprimible({ datos, catalogo, onClose }: { datos: { linea: Linea; inicio: string; fin: string; pedidos: Pedido[] }; catalogo: Catalogo; onClose: () => void }) {
  const productos = catalogo.productos.filter((p) => p.linea === datos.linea && p.tipo !== 'materia_prima');
  const totales = productos.map((p) => ({ ...p, cantidad: datos.pedidos.flatMap((o) => o.lineas).filter((l) => l.product_id === p.id).reduce((a, l) => a + l.cantidad, 0) })).filter((p) => p.cantidad > 0);
  const fechas = [...new Set(datos.pedidos.map((p) => p.fecha_entrega))].sort();
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-card invoice-print operation-order-print" onClick={(e) => e.stopPropagation()}>
    <header className="print-order-head"><div><span className="eyebrow">M&amp;G Management and Logistics Inc.</span><h1>Orden total de {datos.linea}</h1><p>{datos.inicio} al {datos.fin}</p></div><button className="icon-btn" aria-label="Cerrar" onClick={onClose}>×</button></header>
    <section className="print-order-totals"><h2>Totales de producción / surtido</h2>{totales.map((p) => <div key={p.id}><span><strong>{p.nombre}</strong><small>{p.peso_caja_lb ? `${p.peso_caja_lb} lb por caja` : p.unidad}</small></span><strong>{p.cantidad.toLocaleString('es-MX')} {unidadCorta(p)}</strong><span>{p.peso_caja_lb ? `${(p.cantidad * p.peso_caja_lb).toLocaleString('es-MX')} lb` : ''}</span></div>)}</section>
    <section className="print-order-detail"><h2>Detalle por sucursal</h2>{fechas.map((dia) => <div className="print-order-day" key={dia}><h3>{fechaLarga(dia)}</h3>{datos.pedidos.filter((p) => p.fecha_entrega === dia).map((p) => <div className="print-location" key={p.id}><strong>{p.ubicacion.nombre}</strong><span>{p.lineas.map((l) => `${l.nombre}: ${l.cantidad.toLocaleString('es-MX')}`).join(' · ')}</span>{p.notas && <small>{p.notas}</small>}</div>)}</div>)}</section>
    {!datos.pedidos.length && <div className="empty-state"><strong>No hay pedidos confirmados en esta semana</strong></div>}
    <button className="btn btn-primary btn-block" disabled={!datos.pedidos.length} onClick={() => window.print()}>Imprimir / guardar PDF</button>
  </div></div>;
}
