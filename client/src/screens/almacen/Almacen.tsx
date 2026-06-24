import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';

interface Producto { id: number; nombre: string; sku: string; unidad_distribucion: string; activo: boolean }
interface Ubic { id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }
interface Mov { id: number; tipo: 'ingreso' | 'retiro'; fecha: string; producto: string; unidad: string; cantidad: number; destino: string | null; motivo: string | null }

type Modo = 'ingreso' | 'retiro';
const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Chicago', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Almacen() {
  const [modo, setModo] = useState<Modo>('ingreso');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [sucursales, setSucursales] = useState<Ubic[]>([]);
  const [movs, setMovs] = useState<Mov[]>([]);

  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState(''); // solo ingreso
  const [destino, setDestino] = useState<string>('directa'); // solo retiro
  const [motivo, setMotivo] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function cargarMovs(m: Modo) {
    try { setMovs(await api<Mov[]>(`/existencias/movimientos?tipo=${m}`)); }
    catch { /* lista vacía si falla */ }
  }
  async function cargarBase() {
    try {
      const [ps, us] = await Promise.all([api<Producto[]>('/catalogo/productos'), api<Ubic[]>('/ubicaciones')]);
      setProductos(ps.filter((p) => p.activo));
      setSucursales(us.filter((u) => u.activo && u.tipo === 'sucursal'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar');
    }
  }
  useEffect(() => { void cargarBase(); }, []);
  useEffect(() => { void cargarMovs(modo); setOk(''); setError(''); }, [modo]);

  const resultados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return productos.filter((p) => p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 8);
  }, [q, productos]);

  function limpiar() { setSel(null); setQ(''); setCantidad(''); setCosto(''); setMotivo(''); }

  async function registrar() {
    if (!sel) { setError('Elige un producto'); return; }
    const c = Number(cantidad);
    if (!(c > 0)) { setError('Cantidad inválida'); return; }
    setBusy(true); setError(''); setOk('');
    try {
      if (modo === 'ingreso') {
        await api('/existencias/ingreso', { method: 'POST', body: { product_id: sel.id, cantidad: c, costo_unitario: costo ? Number(costo) : null, motivo: motivo.trim() || undefined } });
        setOk('Entrada registrada en bodega.');
      } else {
        const r = await api<{ destino: string | null }>('/existencias/retiro', { method: 'POST', body: { product_id: sel.id, cantidad: c, destino_ubicacion_id: destino === 'directa' ? null : Number(destino), motivo: motivo.trim() || undefined } });
        setOk(`Salida registrada${r.destino ? ` → ${r.destino}` : ' (directa)'}.`);
      }
      limpiar();
      await cargarMovs(modo);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar');
    } finally {
      setBusy(false);
    }
  }

  const esIngreso = modo === 'ingreso';

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <h1>Almacén</h1>
          <p className="page-sub">Entradas y salidas de bodega fuera del envío normal, para no descuadrar el inventario.</p>
        </div>
      </header>

      <div className="tabs">
        <button className={esIngreso ? 'tab tab--on' : 'tab'} onClick={() => setModo('ingreso')}>Entrada</button>
        <button className={!esIngreso ? 'tab tab--on' : 'tab'} onClick={() => setModo('retiro')}>Salida</button>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {ok && <p className="ok-msg">{ok}</p>}

      <div className="card">
        <label className="retiro-label">1 · Producto</label>
        {sel ? (
          <div className="retiro-sel">
            <span><strong>{sel.nombre}</strong> <small className="muted">{sel.unidad_distribucion} · {sel.sku}</small></span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSel(null); setQ(''); }}>Cambiar</button>
          </div>
        ) : (
          <>
            <input className="inv-search" type="search" placeholder="Buscar producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
            {resultados.length > 0 && (
              <div className="retiro-resultados">
                {resultados.map((p) => (
                  <button key={p.id} className="retiro-resultado" onClick={() => { setSel(p); setQ(''); }}>
                    <strong>{p.nombre}</strong> <small className="muted">{p.unidad_distribucion} · {p.sku}</small>
                  </button>
                ))}
              </div>
            )}
            {q.trim() && resultados.length === 0 && <p className="muted">Sin coincidencias.</p>}
          </>
        )}

        <label className="retiro-label">2 · Cantidad{sel ? ` (${sel.unidad_distribucion})` : ''}</label>
        <input className="conteo-input2" inputMode="decimal" value={cantidad} placeholder="0" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCantidad(e.target.value)} />

        {esIngreso ? (
          <>
            <label className="retiro-label">3 · Costo unitario (opcional)</label>
            <input className="conteo-input2" inputMode="decimal" value={costo} placeholder="0.00" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCosto(e.target.value)} />
            <p className="muted" style={{ marginTop: '0.3rem' }}>Sube al inventario de bodega y recalcula el costo promedio.</p>
          </>
        ) : (
          <>
            <label className="retiro-label">3 · ¿A dónde fue?</label>
            <div className="ubic-picker-pills">
              <button className={`ubic-pill ${destino === 'directa' ? 'ubic-pill--on' : ''}`} onClick={() => setDestino('directa')}>Salida directa</button>
              {sucursales.map((s) => (
                <button key={s.id} className={`ubic-pill ${destino === String(s.id) ? 'ubic-pill--on' : ''}`} onClick={() => setDestino(String(s.id))}>{s.nombre}</button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: '0.3rem' }}>
              {destino === 'directa' ? 'Sale de bodega como consumo (no entra a una sucursal).' : 'Baja de bodega y sube al inventario de esa sucursal.'}
            </p>
          </>
        )}

        <label className="retiro-label">4 · Motivo (opcional)</label>
        <input className="inv-search" value={motivo} placeholder={esIngreso ? 'Ej. compra a proveedor…' : 'Ej. emergencia, se acabó en turno…'} onChange={(e) => setMotivo(e.target.value)} />

        <div className="form-actions" style={{ marginTop: '0.9rem' }}>
          <button className="btn btn-primary" disabled={busy || !sel || !(Number(cantidad) > 0)} onClick={() => void registrar()}>
            {esIngreso ? 'Registrar entrada' : 'Registrar salida'}
          </button>
        </div>
      </div>

      <h3 className="seccion-title">{esIngreso ? 'Entradas recientes' : 'Salidas recientes'}</h3>
      {movs.length === 0 ? (
        <p className="muted">Aún no hay {esIngreso ? 'entradas' : 'salidas'} registradas.</p>
      ) : (
        <div className="lista-ubicaciones">
          {movs.map((m) => (
            <div key={m.id} className="card">
              <div className="ubic-row">
                <div>
                  <strong>{m.producto}</strong>{' '}
                  <span className={`chip ${esIngreso ? 'chip--ok' : 'chip--muted'}`}>{esIngreso ? '+' : '−'}{m.cantidad} {m.unidad}</span>
                  <div className="muted">
                    {esIngreso ? 'Entrada a bodega' : m.destino ? `→ ${m.destino}` : 'Salida directa'} · {fechaHora(m.fecha)}
                    {m.motivo ? ` · ${m.motivo}` : ''}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
