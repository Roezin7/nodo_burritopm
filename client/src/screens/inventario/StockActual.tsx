import { useEffect, useState } from 'react';
import { api, nuevaClaveIdempotencia } from '../../api';
import { mensajeError, useToast } from '../../toast';
import { usd, type ExistResp } from './types';

/** Valor del inventario y stock actual de la ubicación (en vivo, desde existencias). Compacto. */
export default function StockActual({ ubicId, nombre }: { ubicId: string; nombre: string }) {
  const [data, setData] = useState<ExistResp | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [recargando, setRecargando] = useState(0);
  const [moviendo, setMoviendo] = useState<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    let vivo = true;
    setData(null); setError('');
    api<ExistResp>(`/existencias?ubicacion=${ubicId}`)
      .then((r) => { if (vivo) setData(r); })
      .catch(() => { if (vivo) setError('No se pudo cargar el inventario actual'); });
    return () => { vivo = false; };
  }, [ubicId, recargando]);

  async function moverABodega(productId: number, cantidad: number, nombreProducto: string) {
    setMoviendo(productId);
    try {
      await api('/existencias/liberar-hold', {
        method: 'POST',
        body: { product_id: productId, cantidad, idempotency_key: nuevaClaveIdempotencia('liberar-hold') },
      });
      toast.ok(`${nombreProducto}: ${cantidad} movidos a inventario disponible.`);
      setRecargando((v) => v + 1);
    } catch (e) {
      toast.error(mensajeError(e, 'No se pudo mover el inventario a bodega.'));
    } finally {
      setMoviendo(null);
    }
  }

  if (error) return null;
  const conStock = data?.items.filter((i) => i.disponible > 0) ?? [];
  const enHold = data?.items.filter((i) => i.transito > 0) ?? [];
  const t = q.trim().toLowerCase();
  const vis = conStock.filter((i) => !t || i.nombre.toLowerCase().includes(t));

  return (
    <div className="stock-card2">
      <button type="button" className="stock-card2-head" onClick={() => setAbierto((v) => !v)}>
        <span className="stock-card2-meta">
          <span className="stock-card2-name">{nombre}</span>
          <span className="muted">{conStock.length} con stock{enHold.length ? ` · ${enHold.length} en hold` : ''}</span>
        </span>
        <span className="stock-card2-right">
          <span className="stock-card2-valor">{data ? usd(data.valor_total) : '—'}</span>
          <span className={`stock-card2-caret ${abierto ? 'is-open' : ''}`}>▾</span>
        </span>
      </button>
      {enHold.length > 0 && (
        <section className="hold-stock" aria-label="Reservas compradas por adelantado">
          <div className="hold-stock-head">
            <strong>Comprado por adelantado</strong>
            <span>{enHold.length} productos</span>
          </div>
          <p className="muted">Muévelo a Bodega Adison al recibirlo.</p>
          {enHold.map((i) => (
            <div key={`hold-${i.product_id}`} className="hold-stock-row">
              <span><strong>{i.nombre}</strong><small>{i.transito} {i.unidad}</small></span>
              <button type="button" className="btn btn-secondary btn-sm" disabled={moviendo != null}
                onClick={() => void moverABodega(i.product_id, i.transito, i.nombre)}>
                {moviendo === i.product_id ? 'Moviendo…' : 'Mover a bodega'}
              </button>
            </div>
          ))}
        </section>
      )}
      {abierto && (
        <div className="stock-card-body">
          {conStock.length > 10 && (
            <input className="inv-search" type="search" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {vis.length === 0 ? (
            <p className="muted">{conStock.length === 0 ? 'Sin existencias registradas todavía.' : 'Sin coincidencias.'}</p>
          ) : (
            vis.map((i) => (
              <div key={i.product_id} className="stock-row">
                <span className="stock-row-name">{i.nombre} <small className="muted">{i.unidad}</small></span>
                <span className="stock-row-qty">{i.disponible}</span>
                <span className="stock-row-val">{usd(i.valor)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
