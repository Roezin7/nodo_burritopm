import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, getToken } from '../../api';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';

export type OperacionSeccion = 'compras' | 'produccion' | 'rutas' | 'cierre';
interface Catalogo {
  ubicaciones: { id: number; nombre: string; tipo: string; empresa: { nombre: string } | null }[];
  productos: { id: number; nombre: string; sku: string; linea: string; tipo: string; unidad: string; costo: number | null; precio: number | null; peso_caja_lb: number | null; produccion_dias: number[] }[];
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

const meta: Record<OperacionSeccion, { eyebrow: string; titulo: string; descripcion: string }> = {
  compras: { eyebrow: 'Paso 1', titulo: 'Compras', descripcion: 'Registra lo recibido esta semana.' },
  produccion: { eyebrow: 'Paso 2', titulo: 'Producción', descripcion: 'Captura la materia prima usada y las cajas producidas.' },
  rutas: { eyebrow: 'Entregas', titulo: 'Rutas', descripcion: 'Orden de entrega por día.' },
  cierre: { eyebrow: 'Paso 9', titulo: 'Cierre', descripcion: 'Genera facturas y libros semanales.' },
};

export default function OperacionAdmin({ seccion, integrado = false }: { seccion: OperacionSeccion; integrado?: boolean }) {
  const toast = useToast();
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
  if (!catalogo || !resumen) return <div className={integrado ? '' : 'page'}><Spinner /><p className="error-msg">{error}</p></div>;

  return (
    <div className={integrado ? 'operation-embedded' : 'page operation-page'}>
      {!integrado && <header className="page-head operation-page-head"><div><span className="eyebrow">{meta[seccion].eyebrow}</span><h1>{meta[seccion].titulo}</h1><p className="page-sub">{meta[seccion].descripcion}</p></div></header>}
      {integrado && <header className="embedded-head"><span className="eyebrow">{meta[seccion].eyebrow}</span><h2>{meta[seccion].titulo}</h2></header>}
      {error && <p className="error-msg">{error}</p>}
      {seccion === 'compras' && <Compras catalogo={catalogo} resumen={resumen} busy={busy} setBusy={setBusy} onDone={async () => { await cargar(); toast.ok('Compra registrada e inventario actualizado.'); }} setError={setError} />}
      {seccion === 'produccion' && <Produccion catalogo={catalogo} resumen={resumen} busy={busy} setBusy={setBusy} onDone={async () => { await cargar(); toast.ok('Batch calculado y guardado.'); }} setError={setError} />}
      {seccion === 'rutas' && <Rutas catalogo={catalogo} busy={busy} setBusy={setBusy} onDone={async () => { await cargar(); toast.ok('Ruta actualizada.'); }} setError={setError} />}
      {seccion === 'cierre' && <Cierres cierres={cierres} busy={busy} setBusy={setBusy} onDone={cargar} setError={setError} />}
    </div>
  );
}

function Compras({ catalogo, resumen, busy, setBusy, onDone, setError }: { catalogo: Catalogo; resumen: Resumen; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const carniceria = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && u.nombre.toLowerCase().includes('carnicer'));
  const bodega = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && !u.nombre.toLowerCase().includes('carnicer'));
  const [linea, setLinea] = useState<'carne' | 'desechables'>('carne');
  const productosCompra = useMemo(
    () => catalogo.productos
      .filter((p) => p.linea === linea && (linea === 'desechables' || ['materia_prima', 'precio_fijo'].includes(p.tipo)))
      .sort((a, b) => Number(b.tipo === 'materia_prima') - Number(a.tipo === 'materia_prima')),
    [catalogo.productos, linea],
  );
  const [proveedor, setProveedor] = useState(String(catalogo.proveedores[0]?.id ?? ''));
  const [producto, setProducto] = useState(String(catalogo.productos.find((p) => p.tipo === 'materia_prima')?.id ?? ''));
  const [fecha, setFecha] = useState(hoy());
  const [referencia, setReferencia] = useState('');
  const [cajas, setCajas] = useState(''); const [peso, setPeso] = useState(''); const [costo, setCosto] = useState(''); const [congelado, setCongelado] = useState(false);
  useEffect(() => {
    if (!productosCompra.some((p) => String(p.id) === producto)) setProducto(String(productosCompra[0]?.id ?? ''));
  }, [linea, producto, productosCompra]);
  const seleccionado = productosCompra.find((p) => String(p.id) === producto);
  const requierePeso = seleccionado?.tipo === 'materia_prima';
  const almacen = linea === 'carne' ? carniceria : bodega;
  const costoCaja = Number(cajas) > 0 ? Number(costo) / Number(cajas) : 0;
  const costoLibra = Number(peso) > 0 ? Number(costo) / Number(peso) : 0;
  async function guardar() {
    if (!almacen) { setError('Falta configurar el almacén de esta línea.'); return; }
    setBusy(true); setError('');
    try {
      await api('/operacion/compras', { method: 'POST', body: { proveedor_id: Number(proveedor), ubicacion_id: almacen.id, fecha, referencia: referencia || null, lineas: [{ product_id: Number(producto), cajas: Number(cajas), peso_total_lb: requierePeso ? Number(peso) : 0, costo_total: Number(costo), congelado: requierePeso && congelado }] } });
      setCajas(''); setPeso(''); setCosto(''); setReferencia(''); await onDone();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo registrar la compra.'); } finally { setBusy(false); }
  }
  async function cambiarLote(id: number, valor: boolean) { setBusy(true); try { await api(`/operacion/lotes/${id}`, { method: 'PATCH', body: { congelado: valor } }); await onDone(); } finally { setBusy(false); } }
  async function pagarCompra(id: number) { setBusy(true); setError(''); try { await api(`/cierre/compras/${id}/pagar`, { method: 'POST', body: { fecha_pago: hoy() } }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo marcar la compra pagada.'); } finally { setBusy(false); } }
  return <div className="operation-stack">
    <section className="workspace-card form-workspace simple-entry-card">
        <div className="workspace-card-head"><h2>Nueva compra</h2><div className="segmented segmented--small"><button className={linea === 'carne' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setLinea('carne')}>Carne</button><button className={linea === 'desechables' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setLinea('desechables')}>Desechables</button></div></div>
        <div className="form-grid form-grid--purchase">
          <label className="field field--wide"><span>Proveedor</span><select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>{catalogo.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
          <label className="field"><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          <label className="field field--wide"><span>Producto</span><select value={producto} onChange={(e) => setProducto(e.target.value)}>{productosCompra.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
          <label className="field field--number"><span>{seleccionado?.unidad ?? 'Cantidad'} recibida</span><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={cajas} onChange={(e) => setCajas(e.target.value)} /></label>
          {requierePeso && <label className="field field--number"><span>Peso total</span><div className="input-suffix"><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={peso} onChange={(e) => setPeso(e.target.value)} /><span>lb</span></div></label>}
          <label className="field field--number"><span>Costo total</span><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={costo} onChange={(e) => setCosto(e.target.value)} /></div></label>
          <label className="field field--wide"><span>Factura / referencia</span><input value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>
          {requierePeso && <label className="check-card"><input type="checkbox" checked={congelado} onChange={(e) => setCongelado(e.target.checked)} /><span><strong>Congelado</strong></span></label>}
        </div>
        <div className="simple-entry-total"><span>Costo por {seleccionado?.unidad?.toLowerCase() ?? 'unidad'} <strong>{usd(costoCaja)}</strong>{requierePeso && <> · por lb <strong>{usd(costoLibra)}</strong></>}</span><button className="btn btn-primary" disabled={busy || !proveedor || !producto || !cajas || !costo || (requierePeso && !peso)} onClick={() => void guardar()}>{busy ? 'Guardando…' : 'Guardar compra'}</button></div>
    </section>

    {resumen.lotes.length > 0 && <section className="workspace-section"><div className="section-heading"><h2>Materia prima disponible</h2><span>{resumen.lotes.length} lotes</span></div>
      <div className="lot-grid">{resumen.lotes.map((l) => <article className="lot-card" key={l.id}><div className="card-head"><strong>{l.producto}</strong><span className={`chip ${l.congelado ? 'chip--info' : 'chip--ok'}`}>{l.congelado ? 'Congelado' : 'Fresco'}</span></div><div className="lot-value">{l.cajas} <small>cajas</small></div><p>{l.peso_lb.toLocaleString('es-MX')} lb · {usd(l.costo)}</p><footer><span>{l.fecha}</span><button className="link-btn" disabled={busy} onClick={() => void cambiarLote(l.id, !l.congelado)}>{l.congelado ? 'Descongelar' : 'Congelar'}</button></footer></article>)}</div>
    </section>}

    <section className="workspace-card"><div className="workspace-card-head"><h2>Compras registradas</h2></div>
      <div className="record-list">{resumen.compras.map((c) => <article className="record-row" key={c.id}><div className="record-main"><strong>{c.proveedor}</strong><span>{c.fecha} · vence {c.vence_at}</span>{c.lineas.map((l, i) => <small key={i}>{l.producto} · {l.cajas}{l.peso_lb > 0 ? ` · ${l.peso_lb} lb` : ''}{l.congelado ? ' · congelado' : ''}</small>)}</div><div className="record-total"><strong>{usd(c.total)}</strong><span className={`chip ${c.estado === 'pendiente' ? 'chip--warn' : 'chip--ok'}`}>{c.estado}</span>{c.estado === 'pendiente' && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void pagarCompra(c.id)}>Pagada</button>}</div></article>)}</div>
    </section>
  </div>;
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
  const yieldActual = pesoEntradaEstimado > 0 ? (pesoSalida / pesoEntradaEstimado) * 100 : 0;
  return <div className="operation-stack">
    <div className="operation-entry-grid">
      <section className="workspace-card form-workspace">
        <div className="workspace-card-head"><h2>Nueva producción</h2></div>
        <div className="form-grid form-grid--batch">
          <label className="field"><span>Fecha de producción</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          <label className="field field--wide"><span>Materia prima utilizada</span><select value={materia} onChange={(e) => { setMateria(e.target.value); setSalidas({}); }}>{materias.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.peso_caja_lb ?? '?'} lb comprada</option>)}</select></label>
          <label className="field field--number"><span>Cajas de materia prima</span><input type="number" min="0" step="0.5" inputMode="decimal" placeholder="0" value={entrada} onChange={(e) => setEntrada(e.target.value)} /></label>
        </div>
        <div className="production-weight-flow"><span><strong>Entrada</strong>{materiaActual?.peso_caja_lb ?? '?'} lb por caja comprada</span><b>→</b><span><strong>Salida</strong>{terminados.map((p) => `${p.nombre}: ${p.peso_caja_lb ?? '?'} lb`).join(' · ') || 'Selecciona materia prima'}</span></div>
        <div className="form-divider"><span>Cajas terminadas producidas</span></div>
        <div className="production-output-list">{terminados.map((p) => <label className="production-output" key={p.id}><span><strong>{p.nombre}</strong><small>Caja terminada de {p.peso_caja_lb ?? '?'} lb · {p.produccion_dias.map((d) => dias[d]).join(', ') || 'producción especial'}</small></span><div className="input-suffix input-suffix--compact"><input type="number" min="0" step="0.5" inputMode="decimal" value={salidas[p.id] ?? ''} placeholder="0" onChange={(e) => setSalidas({ ...salidas, [p.id]: e.target.value })} /><span>cajas</span></div></label>)}</div>
        {!terminados.length && <div className="empty-state"><strong>Sin receta configurada</strong><span>Selecciona otra materia prima o revisa el catálogo.</span></div>}
        <div className="form-submit"><button className="btn btn-primary" disabled={busy || !entrada || pesoSalida <= 0} onClick={() => void guardar()}>{busy ? 'Guardando…' : 'Guardar producción'}</button></div>
      </section>
      <aside className="calculation-card calculation-card--yield">
        <span className="eyebrow">Resultado</span><h3>Yield</h3>
        <div className={`yield-number ${yieldActual > 100 ? 'is-alert' : ''}`}>{yieldActual.toFixed(1)}<small>%</small></div>
        <div className="yield-bar"><span style={{ width: `${Math.min(100, yieldActual)}%` }} /></div>
        <dl><div><dt>Materia prima</dt><dd>{pesoEntradaEstimado.toFixed(1)} lb</dd></div><div><dt>Producto terminado</dt><dd>{pesoSalida.toFixed(1)} lb</dd></div><div><dt>Desperdicio</dt><dd>{Math.max(0, pesoEntradaEstimado - pesoSalida).toFixed(1)} lb</dd></div></dl>
      </aside>
    </div>

    <section className="workspace-card"><div className="workspace-card-head"><h2>Producción registrada</h2><span>{resumen.producciones.length}</span></div>
      <div className="batch-list">{resumen.producciones.map((p) => <article className="batch-card" key={p.id}><header><div><strong>{p.materia_prima}</strong><span>{p.fecha}</span></div><span className="yield-pill">Yield {p.yield.toFixed(1)}%</span></header><div className="batch-metrics"><span><small>Materia prima</small><strong>{p.cajas_entrada} cajas compradas · {p.peso_entrada_lb} lb</strong></span><span><small>Producto terminado</small><strong>{p.peso_salida_lb} lb</strong></span><span><small>Desperdicio</small><strong>{p.desperdicio_lb} lb</strong></span><span><small>Costo</small><strong>{usd(p.costo)}</strong></span></div><div className="batch-outputs">{p.salidas.map((s, i) => <div key={i}><span><strong>{s.producto}</strong><small>{s.cajas} cajas terminadas</small></span><span>Costo {usd(s.costo_caja)}<small>Venta {usd(s.precio)}</small></span></div>)}</div></article>)}</div>
    </section>
  </div>;
}

function Rutas({ catalogo, busy, setBusy, onDone, setError }: { catalogo: Catalogo; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [edits, setEdits] = useState<Record<number, Catalogo['plantillas'][number]['paradas']>>({});
  const [conductores, setConductores] = useState<Record<number, string>>({});
  function mover(pid: number, i: number, delta: number) { const a = [...(edits[pid] ?? catalogo.plantillas.find((p) => p.id === pid)!.paradas)]; const j = i + delta; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setEdits({ ...edits, [pid]: a }); }
  function quitar(pid: number, ubicacionId: number) { const p = catalogo.plantillas.find((x) => x.id === pid)!; setEdits({ ...edits, [pid]: (edits[pid] ?? p.paradas).filter((x) => x.ubicacion_id !== ubicacionId) }); }
  function alternarOpcional(pid: number, ubicacionId: number) { const p = catalogo.plantillas.find((x) => x.id === pid)!; setEdits({ ...edits, [pid]: (edits[pid] ?? p.paradas).map((x) => x.ubicacion_id === ubicacionId ? { ...x, opcional: !x.opcional } : x) }); }
  function agregar(pid: number, ubicacionId: number) { if (!ubicacionId) return; const p = catalogo.plantillas.find((x) => x.id === pid)!; const a = edits[pid] ?? p.paradas; if (a.some((x) => x.ubicacion_id === ubicacionId)) return; const u = catalogo.ubicaciones.find((x) => x.id === ubicacionId); if (!u) return; setEdits({ ...edits, [pid]: [...a, { ubicacion_id: u.id, nombre: u.nombre, orden: a.length + 1, opcional: false }] }); }
  async function guardar(p: Catalogo['plantillas'][number]) { setBusy(true); setError(''); try { const a = edits[p.id] ?? p.paradas; await api(`/operacion/plantillas/${p.id}`, { method: 'PATCH', body: { conductor: conductores[p.id] ?? p.conductor, paradas: a.map((x, i) => ({ ubicacion_id: x.ubicacion_id, orden: i + 1, opcional: x.opcional })) } }); setEdits({ ...edits, [p.id]: undefined as never }); setConductores({ ...conductores, [p.id]: undefined as never }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la ruta.'); } finally { setBusy(false); } }
  return <div className="route-template-grid">{catalogo.plantillas.map((p) => { const a = edits[p.id] ?? p.paradas; const cambiado = Boolean(edits[p.id]) || conductores[p.id] != null; return <section className={`route-template route-template--${p.linea}`} key={p.id}>
    <header><div><span className="route-line">{p.linea}</span><h2>{p.nombre}</h2><p>{dias[p.dia_semana]} · {a.length} paradas</p></div><button className="btn btn-primary btn-sm" disabled={busy || !cambiado} onClick={() => void guardar(p)}>Guardar cambios</button></header>
    <label className="field route-driver"><span>Responsable de ruta</span><input value={conductores[p.id] ?? p.conductor} onChange={(e) => setConductores({ ...conductores, [p.id]: e.target.value })} /></label>
    <div className="route-stop-list">{a.map((x, i) => <div className="route-stop" key={x.ubicacion_id}><span className="route-stop-number">{i + 1}</span><span className="route-stop-name"><strong>{x.nombre}</strong><button className={x.opcional ? 'optional-toggle is-on' : 'optional-toggle'} onClick={() => alternarOpcional(p.id, x.ubicacion_id)}>{x.opcional ? 'Parada opcional' : 'Parada fija'}</button></span><span className="route-stop-actions"><button className="icon-btn" aria-label="Subir parada" disabled={i === 0} onClick={() => mover(p.id, i, -1)}>↑</button><button className="icon-btn" aria-label="Bajar parada" disabled={i === a.length - 1} onClick={() => mover(p.id, i, 1)}>↓</button><button className="icon-btn btn-peligro" aria-label="Quitar parada" onClick={() => quitar(p.id, x.ubicacion_id)}>×</button></span></div>)}</div>
    <label className="route-add"><span>Agregar restaurante</span><select value="" onChange={(e) => agregar(p.id, Number(e.target.value))}><option value="">Seleccionar…</option>{catalogo.ubicaciones.filter((u) => u.tipo === 'sucursal' && !a.some((x) => x.ubicacion_id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>
  </section>; })}</div>;
}

function Cierres({ cierres, busy, setBusy, onDone, setError }: { cierres: Cierre[]; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [fecha, setFecha] = useState(hoy()); const [factura, setFactura] = useState<Factura | null>(null);
  async function cerrar() { setBusy(true); setError(''); try { await api('/cierre/cerrar', { method: 'POST', body: { fecha_cierre: fecha } }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo cerrar la semana.'); } finally { setBusy(false); } }
  const nombresExcel: Record<string, string> = { 'weekly-order': '1. Weekly Order 2026 3Q.xlsx', disposables: '2. Disposables 2026 3Q.xlsx', production: '3. Production 2026 3Q.xlsx', billing: '4. Billing 2026 3Q.xlsx', lbt: '5. LBT 2026 3Q.xlsx', aurora: '6. Taqueria Aurora 2026 3Q.xlsx' };
  async function descargar(id: number, tipo: string) { const res = await fetch(`/api/cierre/${id}/excel/${tipo}`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (!res.ok) { setError('No se pudo generar el Excel.'); return; } const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = nombresExcel[tipo] ?? `${tipo}.xlsx`; a.click(); URL.revokeObjectURL(url); }
  async function pagar(f: Factura) { setBusy(true); try { await api(`/cierre/facturas/${f.id}/pagar`, { method: 'POST', body: { fecha_pago: hoy() } }); await onDone(); } finally { setBusy(false); } }
  async function reabrir(id: number) { if (!window.confirm('Se anularán las facturas emitidas de esta semana para poder corregir y volver a cerrar. ¿Continuar?')) return; setBusy(true); setError(''); try { await api(`/cierre/${id}/reabrir`, { method: 'POST' }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo reabrir la semana.'); } finally { setBusy(false); } }
  const libros = [['weekly-order', 'Weekly Order'], ['disposables', 'Disposables'], ['production', 'Production'], ['billing', 'Billing'], ['lbt', 'LBT'], ['aurora', 'Aurora']] as const;
  return <div className="operation-stack">
    <section className="close-week-card"><div><span className="eyebrow">Semana actual</span><h2>Cerrar y facturar</h2></div><div className="close-week-action"><label className="field"><span>Sábado</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label><button className="btn btn-primary" disabled={busy} onClick={() => void cerrar()}>{busy ? 'Procesando…' : 'Cerrar semana'}</button></div></section>

    <div className="week-list">{cierres.map((s) => <section className="week-card" key={s.id}><header><div><span className={`status-dot status-dot--${s.estado}`} /> <strong>Semana {s.semana} · {s.anio}</strong><p>{s.inicia_at} al {s.termina_at}</p></div><div className="week-balance"><span>Balance</span><strong>{usd(s.balance_neto)}</strong></div></header>
      <div className="metric-strip metric-strip--five"><div><span>Carne</span><strong>{usd(s.valor_carne)}</strong></div><div><span>Congelado</span><strong>{usd(s.valor_congelado)}</strong></div><div><span>Desechables</span><strong>{usd(s.valor_desechables)}</strong></div><div><span>Por cobrar</span><strong>{usd(s.cuentas_por_cobrar)}</strong></div><div><span>Por pagar</span><strong>{usd(s.cuentas_por_pagar)}</strong></div></div>
      <div className="week-toolbar"><div className="export-menu">{libros.map(([tipo, label]) => <button className="export-chip" key={tipo} onClick={() => void descargar(s.id, tipo)}>{label}<small>.xlsx</small></button>)}</div>{s.estado === 'cerrada' && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void reabrir(s.id)}>Reabrir semana</button>}</div>
      <div className="invoice-list"><div className="invoice-row invoice-row--head"><span>Factura</span><span>Empresa / ubicación</span><span>Vencimiento</span><span>Estado</span><span>Total</span><span /></div>{s.facturas.map((f) => <div className="invoice-row" key={f.id}><button className="invoice-number" onClick={() => setFactura(f)}>{f.numero}<small>v{f.version} · {f.linea}</small></button><span data-label="Ubicación"><strong>{f.ubicacion}</strong><small>{f.empresa}</small></span><span data-label="Vence">{f.vence_at}</span><span data-label="Estado"><span className={`chip ${f.estado === 'pagada' ? 'chip--ok' : 'chip--warn'}`}>{f.estado}</span></span><span data-label="Total"><strong>{usd(f.total)}</strong></span><span>{f.estado === 'emitida' && <button className="link-btn" disabled={busy} onClick={() => void pagar(f)}>Marcar pagada</button>}</span></div>)}</div>
    </section>)}</div>
    {factura && <div className="modal-backdrop" onClick={() => setFactura(null)}><div className="modal-card invoice-print" onClick={(e) => e.stopPropagation()}><div className="card-head"><div><span className="eyebrow">Factura</span><strong>M&amp;G Management and Logistics Inc.</strong></div><button className="icon-btn" aria-label="Cerrar" onClick={() => setFactura(null)}>×</button></div><h2>{factura.ubicacion}</h2><p>{factura.empresa} · {factura.numero} · vence {factura.vence_at}</p><div className="invoice-detail">{factura.lineas.map((l, i) => <div key={i}><span><strong>{l.descripcion}</strong><small>{l.cantidad} × {usd(l.precio)}</small></span><strong>{usd(l.importe)}</strong></div>)}</div><div className="invoice-grand-total"><span>Total</span><strong>{usd(factura.total)}</strong></div><button className="btn btn-primary btn-block" onClick={() => window.print()}>Imprimir / guardar PDF</button></div></div>}
  </div>;
}
