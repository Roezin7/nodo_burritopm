import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { EstadoDistChip, FlujoStepper } from '../../flujo';

interface DistResumen { id: number; estado: string; creado_at: string; total_lineas: number }
interface OpItem {
  linea_id: number;
  product_id: number;
  nombre: string;
  unidad: string;
  categoria: string | null;
  cantidad_aprobada: number;
  cantidad_preparada: number | null;
  cantidad_verificada: number | null;
  cantidad_cargada: number | null;
  cantidad_recibida: number | null;
  estado_linea: string | null;
}
interface TotalCarga {
  product_id: number;
  nombre: string;
  unidad: string;
  categoria: string | null;
  total_aprobada: number;
  total_a_cargar: number;
}
interface Operacion {
  id: number;
  estado: string;
  preparado_por: number | null;
  verificado_por: number | null;
  total_carga: TotalCarga[];
  grupos: { ubicacion: { id: number; nombre: string }; items: OpItem[] }[];
}

// Flujo v2: bodega trabaja distribuciones aprobadas (o verificadas si la verificación está activa).
const ESTADOS_BODEGA = ['aprobada', 'verificada', 'en_transito', 'parcialmente_entregada'];

export default function Bodega() {
  const [lista, setLista] = useState<DistResumen[]>([]);
  const [op, setOp] = useState<Operacion | null>(null);
  const [verificacionCarga, setVerificacionCarga] = useState(false);
  const [error, setError] = useState('');

  async function cargar() {
    try {
      const ds = await api<DistResumen[]>('/distribuciones');
      setLista(ds.filter((d) => ESTADOS_BODEGA.includes(d.estado)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al cargar');
    }
  }
  useEffect(() => { void cargar(); }, []);
  useEffect(() => {
    api<{ verificacion_carga: boolean }>('/negocio').then((n) => setVerificacionCarga(n.verificacion_carga)).catch(() => {});
  }, []);

  async function abrir(id: number) {
    setError('');
    try { setOp(await api<Operacion>(`/distribuciones/${id}/operacion`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  if (op) return <OperacionView op={op} verificacionCarga={verificacionCarga} onSalir={() => { setOp(null); void cargar(); }} onRecargar={() => abrir(op.id)} />;

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Bodega y reparto</h1><p className="page-sub">Surte la lista total y carga el camión.</p></div>
      </header>
      <FlujoStepper activo="bodega" />
      {error && <p className="error-msg">{error}</p>}
      {lista.length === 0 ? (
        <p className="muted">No hay pedidos aprobados por surtir.</p>
      ) : (
        <div className="lista-ubicaciones">
          {lista.map((d) => (
            <button key={d.id} className="card card-click" onClick={() => void abrir(d.id)}>
              <div className="ubic-row">
                <div><strong>Distribución #{d.id}</strong> <EstadoDistChip estado={d.estado} />
                  <div className="muted">{d.total_lineas} líneas</div></div>
                <span className="muted">›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OperacionView({ op, verificacionCarga, onSalir, onRecargar }: { op: Operacion; verificacionCarga: boolean; onSalir: () => void; onRecargar: () => void }) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [vista, setVista] = useState<'total' | 'sucursal'>('total');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Editable mientras el pedido no haya salido a ruta.
  const editable = op.estado === 'aprobada' || op.estado === 'verificada';
  const enRuta = op.estado === 'en_transito' || op.estado === 'parcialmente_entregada';
  const campoActual = (it: OpItem): number => it.cantidad_cargada ?? it.cantidad_aprobada;

  function editsAItems() {
    return Object.entries(edits)
      .map(([linea_id, v]) => ({ linea_id: Number(linea_id), cantidad: Number(v) }))
      .filter((i) => !Number.isNaN(i.cantidad));
  }

  async function guardarSurtido(): Promise<boolean> {
    const items = editsAItems();
    if (items.length === 0) return true;
    await api(`/distribuciones/${op.id}/carga`, { method: 'PATCH', body: { items } });
    setEdits({});
    return true;
  }

  // Guarda el surtido pendiente y luego ejecuta una acción (verificar o cargar).
  async function guardarY(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await guardarSurtido(); await fn(); onRecargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); setBusy(false); }
  }

  async function soloGuardar() {
    setBusy(true); setError('');
    try { await guardarSurtido(); onRecargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); setBusy(false); }
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <button className="link-btn" onClick={onSalir}>← Bodega y reparto</button>
          <h1>Pedido #{op.id} <EstadoDistChip estado={op.estado} /></h1>
          <p className="page-sub">Ajusta cantidades si algo cambió y confirma la carga.</p>
        </div>
      </header>
      {error && <p className="error-msg">{error}</p>}

      <div className="tabs">
        <button className={vista === 'total' ? 'tab tab--on' : 'tab'} onClick={() => setVista('total')}>Lista total a cargar</button>
        <button className={vista === 'sucursal' ? 'tab tab--on' : 'tab'} onClick={() => setVista('sucursal')}>Por sucursal</button>
      </div>

      {vista === 'total' ? (
        <div className="card">
          <div className="card-head"><strong>Todo lo que sube al camión</strong><span className="muted">{op.total_carga.length} productos</span></div>
          {op.total_carga.map((t) => (
            <div key={t.product_id} className="carga-total-item">
              <span><strong>{t.nombre}</strong> {t.categoria && <small className="muted"> · {t.categoria}</small>}</span>
              <span className="carga-total-qty">{t.total_a_cargar} <small>{t.unidad}</small></span>
            </div>
          ))}
          {editable && <p className="muted" style={{ marginTop: '0.6rem' }}>Para ajustar cantidades por sucursal, usa la pestaña <strong>Por sucursal</strong>.</p>}
        </div>
      ) : (
        op.grupos.map((g) => (
          <div key={g.ubicacion.id} className="card">
            <div className="card-head"><strong>{g.ubicacion.nombre}</strong></div>
            {g.items.map((it) => (
              <div key={it.linea_id} className="dist-row">
                <div className="conteo-prod">
                  <strong>{it.nombre}</strong>
                  <small className="muted">{it.unidad} · pedido {it.cantidad_aprobada}</small>
                </div>
                {editable ? (
                  <input className="conteo-input2 dist-input" inputMode="decimal"
                    value={edits[it.linea_id] ?? String(campoActual(it))}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setEdits({ ...edits, [it.linea_id]: e.target.value })} />
                ) : (
                  <span className="dist-aprob">{campoActual(it)}</span>
                )}
              </div>
            ))}
          </div>
        ))
      )}

      <div className="action-bar">
        {editable && <button className="btn btn-secondary" disabled={busy} onClick={() => void soloGuardar()}>Guardar surtido</button>}
        {op.estado === 'aprobada' && verificacionCarga && (
          <button className="btn btn-primary" disabled={busy} onClick={() => void guardarY(() => api(`/distribuciones/${op.id}/verificada`, { method: 'POST' }))}>
            Revisar y verificar
          </button>
        )}
        {(op.estado === 'verificada' || (op.estado === 'aprobada' && !verificacionCarga)) && (
          <button className="btn btn-primary" disabled={busy} onClick={() => void guardarY(() => api(`/distribuciones/${op.id}/cargar`, { method: 'POST' }))}>
            Confirmar carga →
          </button>
        )}
        {enRuta && <span className="muted">En ruta — pendiente de entrega y recepción.</span>}
      </div>
    </div>
  );
}
