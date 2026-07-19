import { useEffect, useMemo, useState } from 'react';
import { api, nuevaClaveIdempotencia } from '../../api';
import { useToast, mensajeError } from '../../toast';
import type { ProdCat } from './types';

/** Panel "Registrar entrada" a la bodega (compra/recepción): sube stock y recalcula costo. */
export default function AgregarEntrada({ abierto, onClose, onHecho }: { abierto: boolean; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [productos, setProductos] = useState<ProdCat[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ProdCat | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => nuevaClaveIdempotencia('ingreso'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!abierto || productos.length) return;
    api<ProdCat[]>('/catalogo/productos').then((ps) => setProductos(ps.filter((p) => p.activo && !p.es_cargo_compra)))
      .catch((e) => toast.error(mensajeError(e, 'No se pudo cargar el catálogo de productos.')));
  }, [abierto, productos.length, toast]);

  const resultados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return productos.filter((p) => p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 8);
  }, [q, productos]);

  function limpiar() { setSel(null); setQ(''); setCantidad(''); setCosto(''); setIdempotencyKey(nuevaClaveIdempotencia('ingreso')); }
  function cerrar() { onClose(); limpiar(); setError(''); }

  async function registrar() {
    const c = Number(cantidad);
    if (!sel || !(c > 0)) { setError('Elige producto y cantidad'); return; }
    setBusy(true); setError('');
    try {
      await api('/existencias/ingreso', { method: 'POST', body: { product_id: sel.id, cantidad: c, costo_unitario: costo ? Number(costo) : null, idempotency_key: idempotencyKey } });
      toast.ok(`+${c} ${sel.unidad_distribucion} de ${sel.nombre} a bodega.`);
      limpiar();
      onHecho();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo registrar la entrada.'));
    } finally {
      setBusy(false);
    }
  }

  if (!abierto) return null;

  return (
    <div className="card form-pro entrada-card">
      <div className="form-pro-head">
        <div className="form-pro-title">
          <strong>Registrar entrada a bodega</strong>
          <small className="muted">Compra o recepción de proveedor</small>
        </div>
        <button className="link-btn" onClick={cerrar}>Cerrar</button>
      </div>
      {error && <p className="error-msg">{error}</p>}

      <div className="field">
        <span className="field-cap">Producto</span>
        {sel ? (
          <div className="retiro-sel">
            <span><strong>{sel.nombre}</strong> <small className="muted">{sel.unidad_distribucion} · {sel.sku}</small></span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSel(null); setQ(''); }}>Cambiar</button>
          </div>
        ) : (
          <>
            <input className="field-input" type="search" placeholder="Buscar producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
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
      </div>

      <div className="field-grid">
        <label className="field">
          <span className="field-cap">Cantidad{sel ? ` · ${sel.unidad_distribucion}` : ''}</span>
          <input className="field-num" inputMode="decimal" value={cantidad} placeholder="0" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCantidad(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-cap">Costo unitario <span className="field-opt">opcional</span></span>
          <input className="field-num" inputMode="decimal" value={costo} placeholder={sel?.ultimo_costo != null ? sel.ultimo_costo.toFixed(2) : '0.00'} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCosto(e.target.value)} />
          {sel?.ultimo_costo != null && (
            <small className="field-hint">Último costo: ${sel.ultimo_costo.toFixed(2)}. Si compraste a otro precio, escríbelo y se actualiza.</small>
          )}
        </label>
      </div>

      <div className="form-pro-foot">
        <button className="btn btn-primary btn-block" disabled={busy || !sel || !(Number(cantidad) > 0)} onClick={() => void registrar()}>Registrar entrada</button>
        <p className="muted">Para fijar cantidades exactas usa <strong>Tomar inventario</strong> (concilia el stock).</p>
      </div>
    </div>
  );
}
