import { useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { useToast, mensajeError } from '../../toast';
import EstadoChip from './EstadoChip';
import { fechaLarga, type InventarioDetalle, type LineaInventario } from './types';

export default function Editor({ detalle, onSalir, onRecargar }: { detalle: InventarioDetalle; onSalir: () => void; onRecargar: () => void }) {
  const { usuario } = useAuth();
  const toast = useToast();
  const [lineas, setLineas] = useState<LineaInventario[]>(detalle.lineas);
  const [guardando, setGuardando] = useState(false);
  const [armado, setArmado] = useState(false); // confirmar cierre en 2 toques (sin diálogo)
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [q, setQ] = useState('');
  const [colapsadas, setColapsadas] = useState<Set<string>>(
    () => new Set(detalle.lineas.map((linea) => linea.categoria ?? 'Sin categoría')),
  );
  const editable = detalle.editable;
  const esAdmin = usuario?.rol === 'admin';
  const esPedido = detalle.ubicacion.tipo === 'sucursal';

  // Filtro por búsqueda (nombre / SKU) y agrupado por categoría.
  const grupos = useMemo(() => {
    const t = q.trim().toLowerCase();
    const m = new Map<string, LineaInventario[]>();
    for (const l of lineas) {
      if (t && !l.nombre.toLowerCase().includes(t) && !l.sku.toLowerCase().includes(t)) continue;
      const k = l.categoria ?? 'Sin categoría';
      (m.get(k) ?? m.set(k, []).get(k)!).push(l);
    }
    return [...m.entries()];
  }, [lineas, q]);

  const pendientes = lineas.filter((l) => !l.contado).length;
  const total = lineas.length;
  const pct = total ? Math.round(((total - pendientes) / total) * 100) : 0;

  function set(pid: number, campo: keyof LineaInventario, valor: number | boolean) {
    setLineas((prev) => prev.map((l) => (l.product_id === pid ? { ...l, [campo]: valor } : l)));
    setOk('');
  }

  // +/− y captura directa: cualquier cambio marca el producto como contado (menos toques).
  function inc(pid: number, delta: number) {
    setLineas((prev) => prev.map((l) => (l.product_id === pid ? { ...l, qty: Math.max(0, Math.round((l.qty + delta) * 1000) / 1000), contado: true } : l)));
    setOk('');
  }
  function setQty(pid: number, raw: string) {
    const v = Math.max(0, Number(raw) || 0);
    setLineas((prev) => prev.map((l) => (l.product_id === pid ? { ...l, qty: v, contado: true } : l)));
    setOk('');
  }

  function marcarGrupo(items: LineaInventario[], contado: boolean) {
    const ids = new Set(items.map((i) => i.product_id));
    setLineas((prev) => prev.map((l) => (ids.has(l.product_id) ? { ...l, contado } : l)));
    setOk('');
  }

  function toggleColapsar(cat: string) {
    setColapsadas((prev) => {
      const n = new Set(prev);
      n.has(cat) ? n.delete(cat) : n.add(cat);
      return n;
    });
  }

  const payload = () => ({ lineas: lineas.map((l) => ({ product_id: l.product_id, qty: l.qty, contado: l.contado })) });

  async function guardar() {
    setGuardando(true); setError(''); setOk('');
    try {
      await api(`/conteos/${detalle.id}/lineas`, { method: 'PATCH', body: payload() });
      setOk('Avance guardado');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function cerrar() {
    setGuardando(true); setError('');
    try {
      await api(`/conteos/${detalle.id}/lineas`, { method: 'PATCH', body: payload() });
      await api(`/conteos/${detalle.id}/cerrar`, { method: 'POST' });
      setArmado(false);
      // El admin puede deshacer (reabrir); la sucursal pide al admin si se equivocó.
      toast.ok(esPedido ? 'Pedido cerrado.' : 'Inventario cerrado.', esAdmin ? { label: 'Deshacer', onClick: () => void reabrir() } : undefined);
      onRecargar();
    } catch (e) {
      setError(mensajeError(e, esPedido ? 'No se pudo cerrar el pedido. Reintenta.' : 'No se pudo cerrar el inventario. Reintenta.'));
      setGuardando(false);
    }
  }

  async function reabrir() {
    try {
      await api(`/conteos/${detalle.id}/reabrir`, { method: 'POST' });
      toast.ok(esPedido ? 'Pedido reabierto.' : 'Inventario reabierto.');
      onRecargar();
    } catch (e) {
      toast.error(mensajeError(e, 'No se pudo reabrir.'));
    }
  }

  async function eliminar() {
    const cerrado = detalle.estado === 'cerrado' || detalle.estado === 'reabierto';
    const msg = cerrado
      ? (esPedido ? '¿Eliminar este pedido cerrado? No se podrá recuperar.' : 'Eliminar este inventario revertirá el stock a como estaba antes de cerrarlo y borrará la sesión. ¿Continuar?')
      : `¿Eliminar este ${esPedido ? 'pedido' : 'inventario'}? No se podrá recuperar.`;
    if (!window.confirm(msg)) return;
    setGuardando(true);
    try {
      await api(`/conteos/${detalle.id}`, { method: 'DELETE' });
      toast.ok(esPedido ? 'Pedido eliminado.' : cerrado ? 'Inventario eliminado · stock revertido.' : 'Inventario eliminado.');
      onSalir();
    } catch (e) {
      toast.error(mensajeError(e, 'No se pudo eliminar.'));
      setGuardando(false);
    }
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <button className="link-btn" onClick={onSalir}>← {esPedido ? 'Pedidos' : 'Inventarios'}</button>
          <h1 className="inv-fecha-titulo">{esPedido ? 'Pedido' : 'Inventario'} {fechaLarga(detalle.fecha)} <EstadoChip estado={detalle.estado} /></h1>
          <p className="page-sub">{detalle.ubicacion.nombre}</p>
        </div>
      </header>

      {error && <p className="error-msg">{error}</p>}
      {ok && <p className="ok-msg">{ok}</p>}

      {editable && (
        <div className="inv-progress">
          <div className="inv-progress-bar"><div className="inv-progress-fill" style={{ width: `${pct}%` }} /></div>
          <span className="inv-progress-num">{total - pendientes}/{total}</span>
        </div>
      )}

      {total > 12 && (
        <input className="inv-search" type="search" placeholder="Buscar producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
      )}

      {grupos.map(([cat, items]) => {
        const cerrada = colapsadas.has(cat);
        const faltan = items.filter((i) => !i.contado).length;
        return (
          <div key={cat} className="conteo-grupo">
            <div className="conteo-grupo-head">
              <button type="button" className="conteo-grupo-toggle" onClick={() => toggleColapsar(cat)}>
                <span className={`conteo-grupo-caret ${cerrada ? 'is-cerrada' : ''}`}>▾</span>
                {cat} <span className="muted">({items.length}{faltan ? ` · faltan ${faltan}` : ''})</span>
              </button>
              {editable && (
                <button type="button" className="link-btn" onClick={() => marcarGrupo(items, faltan > 0)}>
                  {faltan > 0 ? 'Marcar todos' : 'Desmarcar'}
                </button>
              )}
            </div>
            {!cerrada && items.map((l) => (
              <div key={l.product_id} className={`conteo-row2 ${l.contado ? 'conteo-row2--ok' : ''} ${l.atipico ? 'conteo-row2--atip' : ''}`}>
                <div className="conteo-prod">
                  <strong>{l.nombre}</strong>
                  <small className="muted">{l.unidad}{!esPedido && l.stock_objetivo > 0 ? ` · objetivo ${l.stock_objetivo}` : ''}{l.atipico ? ' · atípico' : ''}</small>
                </div>
                <div className="qty-stepper">
                  <button type="button" className="qty-btn" disabled={!editable} aria-label="menos" onClick={() => inc(l.product_id, -1)}>−</button>
                  <input
                    className="qty-input"
                    inputMode="decimal"
                    value={l.qty}
                    disabled={!editable}
                    onChange={(e) => setQty(l.product_id, e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="button" className="qty-btn" disabled={!editable} aria-label="más" onClick={() => inc(l.product_id, 1)}>+</button>
                </div>
                <button
                  type="button"
                  className={`chip ${l.contado ? 'chip--ok' : ''} conteo-check2`}
                  disabled={!editable}
                  onClick={() => set(l.product_id, 'contado', !l.contado)}
                >
                  {l.contado ? '✓' : '○'}
                </button>
              </div>
            ))}
          </div>
        );
      })}

      {editable ? (
        <div className="action-bar action-bar--col">
          {armado && <p className="armar-aviso">{esPedido ? 'Queda como el pedido oficial de hoy para aprobación' : 'Queda como la foto oficial de hoy'}{pendientes > 0 ? ` · ${pendientes} sin revisar` : ''}. Toca de nuevo para confirmar.</p>}
          <div className="action-bar-row">
            <button className="btn btn-secondary" onClick={() => void guardar()} disabled={guardando}>Guardar avance</button>
            {armado ? (
              <button className="btn btn-primary" onClick={() => void cerrar()} disabled={guardando}>Confirmar cierre</button>
            ) : (
              <button className="btn btn-primary" onClick={() => { setArmado(true); setTimeout(() => setArmado(false), 5000); }} disabled={guardando}>{esPedido ? 'Cerrar pedido' : 'Cerrar inventario'}</button>
            )}
          </div>
          {esAdmin && (
            <button className="btn btn-danger-ghost btn-sm" onClick={() => void eliminar()} disabled={guardando}>Eliminar {esPedido ? 'pedido' : 'inventario'}</button>
          )}
        </div>
      ) : (
        esAdmin && (
          <div className="action-bar action-bar-row">
            <button className="btn btn-ghost" onClick={() => void reabrir()} disabled={guardando}>Reabrir {esPedido ? 'pedido' : 'inventario'}</button>
            <button className="btn btn-danger-ghost" onClick={() => void eliminar()} disabled={guardando}>Eliminar {esPedido ? 'pedido' : 'inventario'}</button>
          </div>
        )
      )}
    </div>
  );
}
