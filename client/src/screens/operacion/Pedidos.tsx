import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';

type Linea = 'carne' | 'desechables';
interface Catalogo {
  ubicaciones: { id: number; nombre: string; tipo: string; empresa: { id: number; nombre: string; codigo: string } | null; entrega_en: { id: number; nombre: string } | null }[];
  productos: { id: number; nombre: string; linea: Linea; tipo: string; unidad: string; precio: number | null; peso_caja_lb: number | null }[];
}
interface Pedido {
  id: number; linea: Linea; fecha_entrega: string; estado: string; notas?: string | null; ubicacion: { id: number; nombre: string }; lineas: { product_id: number; cantidad: number }[];
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
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Catalogo>('/operacion/catalogo').then((c) => {
      setCatalogo(c);
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
    if (!ubicacionId || !fecha) return;
    setError('');
    api<Pedido[]>(`/operacion/pedidos?ubicacion_id=${ubicacionId}&linea=${linea}&desde=${fecha}&hasta=${fecha}`)
      .then((rows) => {
        const p = rows[0];
        setEstado(p?.estado ?? null);
        setNotas(p?.notas ?? '');
        setCantidades(Object.fromEntries((p?.lineas ?? []).map((l) => [l.product_id, String(l.cantidad)])));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el pedido.'));
  }, [ubicacionId, linea, fecha]);

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

  if (!catalogo) return <div className="page"><Spinner /><p className="error-msg">{error}</p></div>;
  const ubic = ubicaciones.find((u) => String(u.id) === ubicacionId);
  const total = productos.reduce((a, p) => a + Number(cantidades[p.id] || 0) * (p.precio ?? 0), 0);
  const unidades = productos.reduce((a, p) => a + Number(cantidades[p.id] || 0), 0);
  const conCantidad = productos.filter((p) => Number(cantidades[p.id] || 0) > 0).length;
  const q = buscar.trim().toLowerCase();
  const visibles = productos.filter((p) => !q || `${p.nombre} ${p.tipo}`.toLowerCase().includes(q));
  return (
    <div className={integrado ? 'order-page order-embedded' : 'page order-page'}>
      {!integrado && <header className="page-head operation-page-head"><div><span className="eyebrow">Pedidos</span><h1>Pedido semanal</h1></div>{estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      {integrado && <header className="embedded-head embedded-head--status"><div><span className="eyebrow">Paso 1</span><h2>Pedidos</h2></div>{estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      <div className="segmented order-line-switch">
        <button className={linea === 'carne' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('carne')}>Carne</button>
        <button className={linea === 'desechables' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('desechables')}>Desechables</button>
      </div>
      {error && <p className="error-msg">{error}</p>}
      <div className="order-workspace">
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
              <div className="input-suffix input-suffix--compact"><input inputMode="decimal" type="number" min="0" step={p.peso_caja_lb ? '0.5' : '1'} value={cantidades[p.id] ?? ''} placeholder="0" onChange={(e) => setCantidades({ ...cantidades, [p.id]: e.target.value })} /><span>{p.peso_caja_lb ? 'cajas' : 'pzas'}</span></div>
            </label>)}</div>
          </section>
          <label className="workspace-card field order-notes"><span>Notas del pedido <em>opcional</em></span><textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Instrucciones especiales, sustituciones o entrega…" /></label>
        </section>
        <aside className="order-summary">
          <span className="eyebrow">Resumen del pedido</span><h2>{ubic?.nombre ?? 'Selecciona restaurante'}</h2><p>{fecha} · {linea}</p>
          <dl><div><dt>Productos</dt><dd>{conCantidad}</dd></div><div><dt>Unidades</dt><dd>{unidades.toLocaleString('es-MX')}</dd></div><div><dt>Total</dt><dd>{usd(total)}</dd></div></dl>
          <div className="order-actions"><button className="btn btn-secondary" disabled={busy || !ubicacionId} onClick={() => void guardar(false)}>Guardar</button><button className="btn btn-primary" disabled={busy || !ubicacionId || unidades <= 0} onClick={() => void guardar(true)}>{busy ? 'Guardando…' : 'Confirmar'}</button></div>
          {admin && <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => void crearDistribucion()}>Crear preparación y rutas</button>}
        </aside>
      </div>
    </div>
  );
}
