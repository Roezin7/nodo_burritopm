import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';

interface Producto { id: number; nombre: string; sku: string; unidad_distribucion: string; activo: boolean }
interface Ubic { id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }
interface Retiro { id: number; fecha: string; producto: string; unidad: string; cantidad: number; destino: string | null; motivo: string | null }

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Chicago', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Retiros() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [sucursales, setSucursales] = useState<Ubic[]>([]);
  const [retiros, setRetiros] = useState<Retiro[]>([]);

  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [destino, setDestino] = useState<string>('directa'); // 'directa' | id de sucursal
  const [motivo, setMotivo] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function cargar() {
    try {
      const [ps, us, rs] = await Promise.all([
        api<Producto[]>('/catalogo/productos'),
        api<Ubic[]>('/ubicaciones'),
        api<Retiro[]>('/existencias/retiros'),
      ]);
      setProductos(ps.filter((p) => p.activo));
      setSucursales(us.filter((u) => u.activo && u.tipo === 'sucursal'));
      setRetiros(rs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cargar');
    }
  }
  useEffect(() => { void cargar(); }, []);

  const resultados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return productos.filter((p) => p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 8);
  }, [q, productos]);

  async function registrar() {
    if (!sel) { setError('Elige un producto'); return; }
    const c = Number(cantidad);
    if (!(c > 0)) { setError('Cantidad inválida'); return; }
    setBusy(true); setError(''); setOk('');
    try {
      const body = {
        product_id: sel.id,
        cantidad: c,
        destino_ubicacion_id: destino === 'directa' ? null : Number(destino),
        motivo: motivo.trim() || undefined,
      };
      const r = await api<{ ok: true; destino: string | null }>('/existencias/retiro', { method: 'POST', body });
      setOk(`Retiro registrado${r.destino ? ` → ${r.destino}` : ' (salida directa)'}.`);
      setSel(null); setQ(''); setCantidad(''); setMotivo('');
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar el retiro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <h1>Retiro de bodega</h1>
          <p className="page-sub">Registra lo que sale de la bodega fuera del envío normal (emergencias), para no descuadrar el inventario.</p>
        </div>
      </header>

      {error && <p className="error-msg">{error}</p>}
      {ok && <p className="ok-msg">{ok}</p>}

      <div className="card">
        {/* 1. Producto */}
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

        {/* 2. Cantidad */}
        <label className="retiro-label">2 · Cantidad{sel ? ` (${sel.unidad_distribucion})` : ''}</label>
        <input className="conteo-input2" inputMode="decimal" value={cantidad} placeholder="0" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCantidad(e.target.value)} />

        {/* 3. Destino */}
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

        {/* 4. Motivo */}
        <label className="retiro-label">4 · Motivo (opcional)</label>
        <input className="inv-search" value={motivo} placeholder="Ej. emergencia, se acabó en turno…" onChange={(e) => setMotivo(e.target.value)} />

        <div className="form-actions" style={{ marginTop: '0.9rem' }}>
          <button className="btn btn-primary" disabled={busy || !sel || !(Number(cantidad) > 0)} onClick={() => void registrar()}>Registrar retiro</button>
        </div>
      </div>

      <h3 className="seccion-title">Retiros recientes</h3>
      {retiros.length === 0 ? (
        <p className="muted">Aún no hay retiros registrados.</p>
      ) : (
        <div className="lista-ubicaciones">
          {retiros.map((r) => (
            <div key={r.id} className="card">
              <div className="ubic-row">
                <div>
                  <strong>{r.producto}</strong> <span className="chip chip--muted">{r.cantidad} {r.unidad}</span>
                  <div className="muted">
                    {r.destino ? `→ ${r.destino}` : 'Salida directa'} · {fechaHora(r.fecha)}
                    {r.motivo ? ` · ${r.motivo}` : ''}
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
