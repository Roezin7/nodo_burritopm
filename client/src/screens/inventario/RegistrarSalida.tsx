import { useEffect, useMemo, useState } from 'react';
import { api, nuevaClaveIdempotencia } from '../../api';
import type { UbicacionAsignada } from '../../auth';
import { useToast, mensajeError } from '../../toast';
import type { ProdCat } from './types';

/** Panel "Registrar salida" de la bodega (retiro directo o transferencia a una sucursal). */
export default function RegistrarSalida({ abierto, sucursales, onClose, onHecho }: {
  abierto: boolean; sucursales: UbicacionAsignada[]; onClose: () => void; onHecho: () => void;
}) {
  const toast = useToast();
  const [productos, setProductos] = useState<ProdCat[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ProdCat | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [destino, setDestino] = useState<string>('directa');
  const [motivo, setMotivo] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => nuevaClaveIdempotencia('retiro'));
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

  function limpiar() { setSel(null); setQ(''); setCantidad(''); setMotivo(''); setDestino('directa'); setIdempotencyKey(nuevaClaveIdempotencia('retiro')); }
  function cerrar() { onClose(); limpiar(); setError(''); }

  async function registrar() {
    const c = Number(cantidad);
    if (!sel || !(c > 0)) { setError('Elige producto y cantidad'); return; }
    setBusy(true); setError('');
    try {
      const r = await api<{ destino: string | null }>('/existencias/retiro', {
        method: 'POST',
        body: { product_id: sel.id, cantidad: c, destino_ubicacion_id: destino === 'directa' ? null : Number(destino), motivo: motivo.trim() || undefined, idempotency_key: idempotencyKey },
      });
      toast.ok(`−${c} ${sel.unidad_distribucion} de ${sel.nombre}${r.destino ? ` → ${r.destino}` : ' (salida directa)'}.`);
      limpiar();
      onHecho();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo registrar la salida.'));
    } finally {
      setBusy(false);
    }
  }

  if (!abierto) return null;

  return (
    <div className="card form-pro entrada-card">
      <div className="form-pro-head">
        <div className="form-pro-title">
          <strong>Registrar salida de bodega</strong>
          <small className="muted">Retiro directo o envío a una sucursal fuera del reparto</small>
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

      <label className="field">
        <span className="field-cap">Cantidad{sel ? ` · ${sel.unidad_distribucion}` : ''}</span>
        <input className="field-num" inputMode="decimal" value={cantidad} placeholder="0" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCantidad(e.target.value)} />
      </label>

      <div className="field">
        <span className="field-cap">¿A dónde fue?</span>
        <div className="ubic-picker-pills">
          <button type="button" className={`ubic-pill ${destino === 'directa' ? 'ubic-pill--on' : ''}`} onClick={() => setDestino('directa')}>Salida directa</button>
          {sucursales.map((s) => (
            <button type="button" key={s.id} className={`ubic-pill ${destino === String(s.id) ? 'ubic-pill--on' : ''}`} onClick={() => setDestino(String(s.id))}>{s.nombre}</button>
          ))}
        </div>
        <small className="field-hint">
          {destino === 'directa' ? 'Sale de bodega como consumo (no entra a una sucursal).' : 'Baja de bodega y sube al inventario de esa sucursal.'}
        </small>
      </div>

      <label className="field">
        <span className="field-cap">Motivo <span className="field-opt">opcional</span></span>
        <input className="field-input" value={motivo} placeholder="Ej. emergencia, merma, se acabó en turno…" onChange={(e) => setMotivo(e.target.value)} />
      </label>

      <div className="form-pro-foot">
        <button className="btn btn-primary btn-block" disabled={busy || !sel || !(Number(cantidad) > 0)} onClick={() => void registrar()}>Registrar salida</button>
      </div>
    </div>
  );
}
