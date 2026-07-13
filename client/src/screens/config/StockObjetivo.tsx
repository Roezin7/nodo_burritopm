import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';
import type { Ubicacion } from './Ubicaciones';
import UbicacionPicker from '../../components/UbicacionPicker';

interface Item {
  product_id: number;
  nombre: string;
  sku: string;
  categoria: string | null;
  unidad_distribucion: string;
  configurado: boolean;
  habilitado: boolean;
  stock_objetivo: number;
  stock_min: number;
  stock_max: number | null;
  stock_seguridad: number;
  multiplo_distribucion: number;
  minimo_envio: number;
}

/** Productos por ubicación: qué puede pedir cada sucursal y mínimos operativos de bodega. */
export default function StockObjetivo() {
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [ubicId, setUbicId] = useState<string>('');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const ubicActual = ubicaciones.find((u) => String(u.id) === ubicId);
  const esBodega = ubicActual?.tipo === 'bodega';

  useEffect(() => {
    api<Ubicacion[]>('/ubicaciones')
      .then((us) => {
        const activas = us.filter((u) => u.activo);
        setUbicaciones(activas);
        const primera = activas.find((u) => u.tipo === 'sucursal') ?? activas[0];
        if (primera) setUbicId(String(primera.id));
      })
      .catch(() => setError('No se pudieron cargar las ubicaciones'));
  }, []);

  useEffect(() => {
    if (!ubicId) return;
    setCargando(true);
    setOk('');
    api<{ items: Item[] }>(`/catalogo/producto-ubicacion?ubicacion=${ubicId}`)
      .then((r) => setItems(r.items))
      .catch(() => setError('No se pudieron cargar los productos de la ubicación'))
      .finally(() => setCargando(false));
  }, [ubicId]);

  function set(idx: number, campo: keyof Item, valor: number | boolean) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)));
  }

  async function guardar() {
    setGuardando(true);
    setError('');
    setOk('');
    try {
      await api('/catalogo/producto-ubicacion', {
        method: 'PUT',
        body: {
          ubicacion_id: Number(ubicId),
          items: items.map((it) => ({
            product_id: it.product_id,
            habilitado: it.habilitado,
            stock_objetivo: it.stock_objetivo,
            stock_min: it.stock_min,
            stock_max: it.stock_max,
            stock_seguridad: it.stock_seguridad,
            multiplo_distribucion: it.multiplo_distribucion,
            minimo_envio: it.minimo_envio,
          })),
        },
      });
      setOk('Configuración guardada');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <UbicacionPicker label="Ubicación" opciones={ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo }))} value={ubicId} onChange={setUbicId} />
      {error && <p className="error-msg">{error}</p>}
      {ok && <p className="ok-msg">{ok}</p>}

      {cargando ? (
        <Spinner />
      ) : items.length === 0 ? (
        <p className="muted">No hay productos activos. Crea productos en la pestaña Productos.</p>
      ) : (
        <>
          <p className="muted">
            {esBodega
              ? <>Habilita los productos de bodega y, si aplica, define mínimos operativos.</>
              : <>Habilita los productos que esta sucursal puede pedir. Las cantidades las elige el restaurante al hacer su pedido.</>}
          </p>
          <div className={`so-grid-head ${esBodega ? 'so-grid-head--bodega' : 'so-grid-head--simple'}`}>
            <span>Producto</span><span>Usa</span>{esBodega && <><span>Mín</span><span>Seguridad</span></>}
          </div>
          <div className="so-rows">
            {items.map((it, idx) => (
              <div key={it.product_id} className={`so-row ${esBodega ? 'so-row--bodega' : 'so-row--simple'} ${it.habilitado ? '' : 'so-row--off'}`}>
                <div className="so-prod"><strong>{it.nombre}</strong><small className="muted">{it.unidad_distribucion}{it.categoria ? ` · ${it.categoria}` : ''}</small></div>
                <label className="so-check"><input type="checkbox" checked={it.habilitado} onChange={(e) => set(idx, 'habilitado', e.target.checked)} /></label>
                {esBodega && (
                  <>
                    <input className="so-num" inputMode="decimal" value={it.stock_min} onChange={(e) => set(idx, 'stock_min', Number(e.target.value) || 0)} disabled={!it.habilitado} />
                    <input className="so-num" inputMode="decimal" value={it.stock_seguridad} onChange={(e) => set(idx, 'stock_seguridad', Number(e.target.value) || 0)} disabled={!it.habilitado} />
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar configuración'}</button>
          </div>
        </>
      )}
    </div>
  );
}
