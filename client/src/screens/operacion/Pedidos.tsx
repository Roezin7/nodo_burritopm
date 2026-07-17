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
  id: number; linea: Linea; fecha_entrega: string; estado: string; ubicacion: { id: number; nombre: string }; lineas: { product_id: number; cantidad: number }[];
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

export default function Pedidos() {
  const { usuario } = useAuth();
  const toast = useToast();
  const admin = usuario?.rol === 'admin';
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [linea, setLinea] = useState<Linea>('carne');
  const [ubicacionId, setUbicacionId] = useState('');
  const [fecha, setFecha] = useState(siguienteMiercoles());
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
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
        body: { ubicacion_id: Number(ubicacionId), linea, fecha_entrega: fecha, confirmar, lineas: productos.map((p) => ({ product_id: p.id, cantidad: Number(cantidades[p.id] || 0) })) },
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
  return (
    <div className="page conteo-page">
      <header className="page-head"><div><h1>Pedidos</h1><p className="page-sub">Carne y desechables por fecha de entrega. El precio de proteína se congela al cerrar la semana.</p></div></header>
      <div className="tabs">
        <button className={linea === 'carne' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('carne')}>Carne</button>
        <button className={linea === 'desechables' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('desechables')}>Desechables</button>
      </div>
      <div className="card form-grid">
        <label className="field"><span>Restaurante</span><select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.empresa?.nombre}</option>)}</select></label>
        <label className="field"><span>Entrega</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      </div>
      {ubic?.entrega_en && <p className="notice">Este pedido se factura a {ubic.nombre} y se entrega físicamente en {ubic.entrega_en.nombre}.</p>}
      {estado && <p className="muted">Estado actual: <strong>{estado.replaceAll('_', ' ')}</strong></p>}
      {error && <p className="error-msg">{error}</p>}
      <div className="card">
        {productos.map((p) => (
          <label key={p.id} className="conteo-row">
            <span className="conteo-prod"><strong>{p.nombre}</strong><small>{p.unidad} · {usd(p.precio)}{p.peso_caja_lb ? ` · ${p.peso_caja_lb} lb` : ''}</small></span>
            <input className="conteo-input2" inputMode="decimal" type="number" min="0" step="0.5" value={cantidades[p.id] ?? ''} placeholder="0" onChange={(e) => setCantidades({ ...cantidades, [p.id]: e.target.value })} />
          </label>
        ))}
      </div>
      <div className="card-head"><strong>Estimado</strong><strong>{usd(total)}</strong></div>
      <div className="action-bar">
        <button className="btn btn-secondary" disabled={busy} onClick={() => void guardar(false)}>Guardar</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void guardar(true)}>{busy ? 'Guardando…' : 'Confirmar pedido'}</button>
        {admin && <button className="btn btn-secondary" disabled={busy} onClick={() => void crearDistribucion()}>Crear distribución y rutas</button>}
      </div>
    </div>
  );
}
