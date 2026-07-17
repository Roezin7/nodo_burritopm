import { useEffect, useState } from 'react';
import { api, ApiError, getToken } from '../../api';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';

type Tab = 'compras' | 'produccion' | 'rutas' | 'cierre';
interface Catalogo {
  ubicaciones: { id: number; nombre: string; tipo: string; empresa: { nombre: string } | null }[];
  productos: { id: number; nombre: string; sku: string; linea: string; tipo: string; costo: number | null; precio: number | null; peso_caja_lb: number | null; produccion_dias: number[] }[];
  proveedores: { id: number; nombre: string }[];
  plantillas: { id: number; nombre: string; codigo: string; linea: string; dia_semana: number; conductor: string; paradas: { ubicacion_id: number; nombre: string; orden: number; opcional: boolean }[] }[];
}
interface Resumen {
  compras: { id: number; fecha: string; vence_at: string; proveedor: string; total: number; estado: string; lineas: { producto: string; cajas: number; peso_lb: number; costo: number; congelado: boolean }[] }[];
  producciones: { id: number; fecha: string; materia_prima: string; cajas_entrada: number; peso_entrada_lb: number; peso_salida_lb: number; desperdicio_lb: number; yield: number; costo: number; salidas: { producto: string; cajas: number; costo_caja: number; precio: number }[] }[];
  lotes: { id: number; fecha: string; producto: string; product_id: number; cajas: number; peso_lb: number; costo: number; congelado: boolean }[];
}
interface Cierre {
  id: number; anio: number; semana: number; inicia_at: string; termina_at: string; estado: string;
  valor_carne: number; valor_congelado: number; valor_desechables: number; cuentas_por_cobrar: number; cuentas_por_pagar: number; balance_neto: number;
  facturas: Factura[];
}
interface Factura { id: number; numero: string; version: number; empresa: string; ubicacion: string; linea: string; emitida_at: string; vence_at: string; estado: string; total: number; pagado: number; lineas: { descripcion: string; cantidad: number; precio: number; importe: number }[] }
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default function OperacionAdmin() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('compras');
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cierres, setCierres] = useState<Cierre[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function cargar() {
    setError('');
    try {
      const [c, r, s] = await Promise.all([api<Catalogo>('/operacion/catalogo'), api<Resumen>('/operacion/produccion'), api<Cierre[]>('/cierre')]);
      setCatalogo(c); setResumen(r); setCierres(s);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo cargar la operación.'); }
  }
  useEffect(() => { void cargar(); }, []);
  if (!catalogo || !resumen) return <div className="page"><Spinner /><p className="error-msg">{error}</p></div>;

  return (
    <div className="page">
      <header className="page-head"><div><h1>Operación semanal</h1><p className="page-sub">Compras, producción, rutas, costo, facturación y cierre en un solo lugar.</p></div></header>
      <div className="tabs tabs-scroll">
        {([['compras', 'Compras'], ['produccion', 'Producción'], ['rutas', 'Rutas'], ['cierre', 'Cierre y facturas']] as [Tab, string][]).map(([k, label]) => <button key={k} className={tab === k ? 'tab tab--on' : 'tab'} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {error && <p className="error-msg">{error}</p>}
      {tab === 'compras' && <Compras catalogo={catalogo} resumen={resumen} busy={busy} setBusy={setBusy} onDone={async () => { await cargar(); toast.ok('Compra registrada e inventario actualizado.'); }} setError={setError} />}
      {tab === 'produccion' && <Produccion catalogo={catalogo} resumen={resumen} busy={busy} setBusy={setBusy} onDone={async () => { await cargar(); toast.ok('Batch calculado y guardado.'); }} setError={setError} />}
      {tab === 'rutas' && <Rutas catalogo={catalogo} busy={busy} setBusy={setBusy} onDone={async () => { await cargar(); toast.ok('Ruta actualizada.'); }} setError={setError} />}
      {tab === 'cierre' && <Cierres cierres={cierres} busy={busy} setBusy={setBusy} onDone={cargar} setError={setError} />}
    </div>
  );
}

function Compras({ catalogo, resumen, busy, setBusy, onDone, setError }: { catalogo: Catalogo; resumen: Resumen; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const carniceria = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && u.nombre.toLowerCase().includes('carnicer'));
  const materias = catalogo.productos.filter((p) => p.tipo === 'materia_prima');
  const [proveedor, setProveedor] = useState(String(catalogo.proveedores[0]?.id ?? ''));
  const [producto, setProducto] = useState(String(materias[0]?.id ?? ''));
  const [fecha, setFecha] = useState(hoy());
  const [referencia, setReferencia] = useState('');
  const [cajas, setCajas] = useState(''); const [peso, setPeso] = useState(''); const [costo, setCosto] = useState(''); const [congelado, setCongelado] = useState(false);
  async function guardar() {
    if (!carniceria) { setError('Falta crear la ubicación Carnicería.'); return; }
    setBusy(true); setError('');
    try {
      await api('/operacion/compras', { method: 'POST', body: { proveedor_id: Number(proveedor), ubicacion_id: carniceria.id, fecha, referencia: referencia || null, lineas: [{ product_id: Number(producto), cajas: Number(cajas), peso_total_lb: Number(peso), costo_total: Number(costo), congelado }] } });
      setCajas(''); setPeso(''); setCosto(''); setReferencia(''); await onDone();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo registrar la compra.'); } finally { setBusy(false); }
  }
  async function cambiarLote(id: number, valor: boolean) { setBusy(true); try { await api(`/operacion/lotes/${id}`, { method: 'PATCH', body: { congelado: valor } }); await onDone(); } finally { setBusy(false); } }
  async function pagarCompra(id: number) { setBusy(true); setError(''); try { await api(`/cierre/compras/${id}/pagar`, { method: 'POST', body: { fecha_pago: hoy() } }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo marcar la compra pagada.'); } finally { setBusy(false); } }
  return <>
    <div className="card"><h3>Registrar compra</h3><div className="form-grid">
      <label className="field"><span>Proveedor</span><select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>{catalogo.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label className="field"><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      <label className="field"><span>Materia prima</span><select value={producto} onChange={(e) => setProducto(e.target.value)}>{materias.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
      <label className="field"><span>Cajas</span><input type="number" step="0.01" value={cajas} onChange={(e) => setCajas(e.target.value)} /></label>
      <label className="field"><span>Peso total (lb)</span><input type="number" step="0.01" value={peso} onChange={(e) => setPeso(e.target.value)} /></label>
      <label className="field"><span>Costo total</span><input type="number" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} /></label>
      <label className="field"><span>Factura / referencia</span><input value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>
      <label className="check-row"><input type="checkbox" checked={congelado} onChange={(e) => setCongelado(e.target.checked)} /> Compra congelada</label>
    </div><button className="btn btn-primary" disabled={busy || !proveedor || !producto || !cajas || !peso || !costo} onClick={() => void guardar()}>Registrar compra</button></div>
    <h3 className="seccion-title">Materia prima disponible</h3>
    <div className="grid-cards">{resumen.lotes.map((l) => <div className="card" key={l.id}><div className="card-head"><strong>{l.producto}</strong><span className={`chip ${l.congelado ? 'chip--info' : 'chip--ok'}`}>{l.congelado ? 'Congelado' : 'Fresco'}</span></div><p>{l.cajas} cajas · {l.peso_lb} lb · {usd(l.costo)}</p><small>{l.fecha}</small><button className="btn btn-secondary btn-block" disabled={busy} onClick={() => void cambiarLote(l.id, !l.congelado)}>{l.congelado ? 'Descongelar' : 'Congelar'}</button></div>)}</div>
    <h3 className="seccion-title">Compras recientes</h3>{resumen.compras.map((c) => <div className="card" key={c.id}><div className="card-head"><strong>{c.proveedor} · {usd(c.total)}</strong><span className="chip">{c.estado}</span></div><p className="muted">{c.fecha} · vence {c.vence_at}</p>{c.lineas.map((l, i) => <div className="dist-row" key={i}><span>{l.producto}{l.congelado ? ' · congelado' : ''}</span><span>{l.cajas} cajas · {l.peso_lb} lb</span></div>)}{c.estado === 'pendiente' && <button className="btn btn-secondary" disabled={busy} onClick={() => void pagarCompra(c.id)}>Marcar pagada completa</button>}</div>)}
  </>;
}

function Produccion({ catalogo, resumen, busy, setBusy, onDone, setError }: { catalogo: Catalogo; resumen: Resumen; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const carniceria = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && u.nombre.toLowerCase().includes('carnicer'));
  const materias = catalogo.productos.filter((p) => p.tipo === 'materia_prima');
  const [materia, setMateria] = useState(String(materias[0]?.id ?? '')); const [fecha, setFecha] = useState(hoy()); const [entrada, setEntrada] = useState(''); const [salidas, setSalidas] = useState<Record<number, string>>({});
  const recetas: Record<string, string[]> = { 'RAW-INSIDE-SKIRT': ['MEAT-STEAK'], 'RAW-CHICKEN': ['MEAT-CHICKEN'], 'RAW-PORK-BUTT': ['MEAT-PASTOR-BPM', 'MEAT-PASTOR-TAP'], 'RAW-OUTSIDE-SKIRT': ['MEAT-ASADA', 'MEAT-FAJITAS'], 'RAW-INSIDE-ROUND': ['MEAT-MILANESA'], 'RAW-TAPATIOS-TACO': ['MEAT-TAPATIOS-TACO'] };
  const materiaActual = materias.find((p) => String(p.id) === materia);
  const terminados = catalogo.productos.filter((p) => p.linea === 'carne' && p.tipo === 'proteina' && (recetas[materiaActual?.sku ?? ''] ?? []).includes(p.sku));
  const pesoEntradaEstimado = Number(entrada || 0) * (materias.find((p) => String(p.id) === materia)?.peso_caja_lb ?? 0);
  const pesoSalida = terminados.reduce((a, p) => a + Number(salidas[p.id] || 0) * (p.peso_caja_lb ?? 0), 0);
  async function guardar() {
    if (!carniceria) { setError('Falta crear la ubicación Carnicería.'); return; }
    setBusy(true); setError('');
    try {
      await api('/operacion/produccion', { method: 'POST', body: { ubicacion_id: carniceria.id, materia_prima_id: Number(materia), fecha, cajas_materia_prima: Number(entrada), salidas: terminados.filter((p) => Number(salidas[p.id] || 0) > 0).map((p) => ({ product_id: p.id, cajas: Number(salidas[p.id]) })) } });
      setEntrada(''); setSalidas({}); await onDone();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la producción.'); } finally { setBusy(false); }
  }
  return <>
    <div className="card"><h3>Registrar batch</h3><div className="form-grid">
      <label className="field"><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      <label className="field"><span>Materia prima</span><select value={materia} onChange={(e) => setMateria(e.target.value)}>{materias.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.peso_caja_lb ?? '?'} lb/caja</option>)}</select></label>
      <label className="field"><span>Cajas utilizadas</span><input type="number" step="0.5" value={entrada} onChange={(e) => setEntrada(e.target.value)} /></label>
    </div><h4>Cajas que reportó el carnicero</h4>{terminados.map((p) => <label className="conteo-row" key={p.id}><span className="conteo-prod"><strong>{p.nombre}</strong><small>{p.peso_caja_lb ?? '?'} lb/caja · programa {p.produccion_dias.map((d) => dias[d]).join(', ') || 'especial'}</small></span><input className="conteo-input2" type="number" min="0" step="0.5" value={salidas[p.id] ?? ''} placeholder="0" onChange={(e) => setSalidas({ ...salidas, [p.id]: e.target.value })} /></label>)}
    <div className="card-head"><span>Entrada estimada: {pesoEntradaEstimado.toFixed(1)} lb</span><span>Salida: {pesoSalida.toFixed(1)} lb · Yield {pesoEntradaEstimado ? ((pesoSalida / pesoEntradaEstimado) * 100).toFixed(1) : '0'}%</span></div><button className="btn btn-primary" disabled={busy || !entrada || pesoSalida <= 0} onClick={() => void guardar()}>Calcular y registrar</button></div>
    <h3 className="seccion-title">Producción reciente</h3>{resumen.producciones.map((p) => <div className="card" key={p.id}><div className="card-head"><strong>{p.fecha} · {p.materia_prima}</strong><span className="chip chip--info">Yield {p.yield.toFixed(1)}%</span></div><p>{p.cajas_entrada} cajas / {p.peso_entrada_lb} lb → {p.peso_salida_lb} lb · desperdicio {p.desperdicio_lb} lb · costo {usd(p.costo)}</p>{p.salidas.map((s, i) => <div className="dist-row" key={i}><span>{s.producto} · {s.cajas} cajas</span><span>Costo {usd(s.costo_caja)} · Venta {usd(s.precio)}</span></div>)}</div>)}
  </>;
}

function Rutas({ catalogo, busy, setBusy, onDone, setError }: { catalogo: Catalogo; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [edits, setEdits] = useState<Record<number, Catalogo['plantillas'][number]['paradas']>>({});
  function mover(pid: number, i: number, delta: number) { const a = [...(edits[pid] ?? catalogo.plantillas.find((p) => p.id === pid)!.paradas)]; const j = i + delta; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setEdits({ ...edits, [pid]: a }); }
  async function guardar(p: Catalogo['plantillas'][number]) { setBusy(true); setError(''); try { const a = edits[p.id] ?? p.paradas; await api(`/operacion/plantillas/${p.id}`, { method: 'PATCH', body: { paradas: a.map((x, i) => ({ ubicacion_id: x.ubicacion_id, orden: i + 1, opcional: x.opcional })) } }); setEdits({ ...edits, [p.id]: undefined as never }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la ruta.'); } finally { setBusy(false); } }
  return <>{catalogo.plantillas.map((p) => { const a = edits[p.id] ?? p.paradas; return <div className="card" key={p.id}><div className="card-head"><div><strong>{p.nombre}</strong><div className="muted">{p.linea} · {dias[p.dia_semana]} · {p.conductor}</div></div><button className="btn btn-primary" disabled={busy || !edits[p.id]} onClick={() => void guardar(p)}>Guardar orden</button></div>{a.map((x, i) => <div className="ruta-parada-fila" key={x.ubicacion_id}><span><strong>{i + 1}.</strong> {x.nombre}</span><span><button className="icon-btn" disabled={i === 0} onClick={() => mover(p.id, i, -1)}>↑</button><button className="icon-btn" disabled={i === a.length - 1} onClick={() => mover(p.id, i, 1)}>↓</button></span></div>)}</div>; })}</>;
}

function Cierres({ cierres, busy, setBusy, onDone, setError }: { cierres: Cierre[]; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [fecha, setFecha] = useState(hoy()); const [factura, setFactura] = useState<Factura | null>(null);
  async function cerrar() { setBusy(true); setError(''); try { await api('/cierre/cerrar', { method: 'POST', body: { fecha_cierre: fecha } }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo cerrar la semana.'); } finally { setBusy(false); } }
  async function descargar(id: number, tipo: string) { const res = await fetch(`/api/cierre/${id}/excel/${tipo}`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (!res.ok) { setError('No se pudo generar el Excel.'); return; } const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${tipo}-week-${id}.xlsx`; a.click(); URL.revokeObjectURL(url); }
  async function pagar(f: Factura) { setBusy(true); try { await api(`/cierre/facturas/${f.id}/pagar`, { method: 'POST', body: { fecha_pago: hoy() } }); await onDone(); } finally { setBusy(false); } }
  async function reabrir(id: number) { if (!window.confirm('Se anularán las facturas emitidas de esta semana para poder corregir y volver a cerrar. ¿Continuar?')) return; setBusy(true); setError(''); try { await api(`/cierre/${id}/reabrir`, { method: 'POST' }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo reabrir la semana.'); } finally { setBusy(false); } }
  return <>
    <div className="card"><div className="form-grid"><label className="field"><span>Sábado de cierre</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label></div><p className="muted">Genera facturas por restaurante y por línea, congela precios y calcula inventario + 3 semanas por cobrar − compras pendientes.</p><button className="btn btn-primary" disabled={busy} onClick={() => void cerrar()}>Cerrar semana y facturar</button></div>
    {cierres.map((s) => <div className="card" key={s.id}><div className="card-head"><div><strong>Semana {s.semana} · {s.anio}</strong><div className="muted">{s.inicia_at} a {s.termina_at} · {s.estado}</div></div><div><strong>{usd(s.balance_neto)}</strong>{s.estado === 'cerrada' && <button className="btn btn-secondary" disabled={busy} onClick={() => void reabrir(s.id)}>Reabrir para corregir</button>}</div></div>
      <div className="grid-kpis"><div><small>Carne</small><strong>{usd(s.valor_carne)}</strong></div><div><small>Congelado</small><strong>{usd(s.valor_congelado)}</strong></div><div><small>Desechables</small><strong>{usd(s.valor_desechables)}</strong></div><div><small>Por cobrar</small><strong>{usd(s.cuentas_por_cobrar)}</strong></div><div><small>Por pagar</small><strong>{usd(s.cuentas_por_pagar)}</strong></div></div>
      <div className="action-bar">{['weekly-order', 'disposables', 'production', 'billing', 'lbt', 'aurora'].map((t) => <button className="btn btn-secondary" key={t} onClick={() => void descargar(s.id, t)}>{t}.xlsx</button>)}</div>
      {s.facturas.map((f) => <div className="dist-row" key={f.id}><button className="link-btn" onClick={() => setFactura(f)}>{f.numero} v{f.version} · {f.ubicacion} · {f.linea}</button><span>{usd(f.total)} · {f.estado} {f.estado === 'emitida' && <button className="btn btn-secondary" disabled={busy} onClick={() => void pagar(f)}>Marcar pagada</button>}</span></div>)}
    </div>)}
    {factura && <div className="modal-backdrop" onClick={() => setFactura(null)}><div className="modal-card invoice-print" onClick={(e) => e.stopPropagation()}><div className="card-head"><strong>M&G Management and Logistics Inc.</strong><button className="icon-btn" onClick={() => setFactura(null)}>×</button></div><h2>{factura.ubicacion}</h2><p>{factura.empresa} · {factura.numero} · vence {factura.vence_at}</p>{factura.lineas.map((l, i) => <div className="dist-row" key={i}><span>{l.descripcion} · {l.cantidad}</span><span>{usd(l.precio)} · {usd(l.importe)}</span></div>)}<div className="card-head"><strong>Total</strong><strong>{usd(factura.total)}</strong></div><button className="btn btn-primary btn-block" onClick={() => window.print()}>Imprimir / guardar PDF</button></div></div>}
  </>;
}
