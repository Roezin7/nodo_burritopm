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

const ESTADOS_BODEGA = ['aprobada', 'en_preparacion', 'preparada', 'verificada', 'en_carga', 'cargada', 'en_transito'];

export default function Bodega() {
  const [lista, setLista] = useState<DistResumen[]>([]);
  const [op, setOp] = useState<Operacion | null>(null);
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

  async function abrir(id: number) {
    setError('');
    try { setOp(await api<Operacion>(`/distribuciones/${id}/operacion`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  if (op) return <OperacionView op={op} onSalir={() => { setOp(null); void cargar(); }} onRecargar={() => abrir(op.id)} />;

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Bodega 📦</h1><p className="page-sub">Surte, verifica y carga el camión.</p></div>
      </header>
      <FlujoStepper activo="bodega" />
      {error && <p className="error-msg">{error}</p>}
      {lista.length === 0 ? (
        <p className="muted">No hay distribuciones aprobadas pendientes de preparar.</p>
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

function OperacionView({ op, onSalir, onRecargar }: { op: Operacion; onSalir: () => void; onRecargar: () => void }) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [vista, setVista] = useState<'total' | 'sucursal'>('total');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Etapa activa según estado.
  const etapa =
    op.estado === 'en_preparacion' ? 'preparacion' :
    op.estado === 'preparada' ? 'verificacion' :
    op.estado === 'verificada' ? 'carga' : null;

  const campoActual = (it: OpItem): number =>
    etapa === 'preparacion' ? (it.cantidad_preparada ?? it.cantidad_aprobada)
    : etapa === 'verificacion' ? (it.cantidad_verificada ?? it.cantidad_preparada ?? it.cantidad_aprobada)
    : etapa === 'carga' ? (it.cantidad_cargada ?? it.cantidad_verificada ?? it.cantidad_aprobada)
    : it.cantidad_aprobada;

  async function accion(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await fn(); onRecargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); setBusy(false); }
  }

  async function guardar() {
    const items = Object.entries(edits).map(([linea_id, v]) => ({ linea_id: Number(linea_id), cantidad: Number(v) }))
      .filter((i) => !Number.isNaN(i.cantidad));
    if (items.length === 0) return;
    const url =
      etapa === 'preparacion' ? `/distribuciones/${op.id}/preparacion`
      : etapa === 'verificacion' ? `/distribuciones/${op.id}/verificacion`
      : `/distribuciones/${op.id}/carga`;
    setBusy(true); setError('');
    try { await api(url, { method: 'PATCH', body: { items } }); setEdits({}); onRecargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); setBusy(false); }
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <button className="link-btn" onClick={onSalir}>← Bodega</button>
          <h1>Distribución #{op.id} <EstadoDistChip estado={op.estado} /></h1>
          {etapa === 'verificacion' && <p className="page-sub">Verificación: la hace una persona distinta a quien preparó.</p>}
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
          {etapa && <p className="muted" style={{ marginTop: '0.6rem' }}>Para capturar cantidades por etapa, usa la pestaña <strong>Por sucursal</strong>.</p>}
        </div>
      ) : (
        op.grupos.map((g) => (
          <div key={g.ubicacion.id} className="card">
            <div className="card-head"><strong>{g.ubicacion.nombre}</strong></div>
            {g.items.map((it) => (
              <div key={it.linea_id} className="dist-row">
                <div className="conteo-prod">
                  <strong>{it.nombre}</strong>
                  <small className="muted">
                    {it.unidad} · pedido {it.cantidad_aprobada}
                    {it.cantidad_preparada != null && ` · surtido ${it.cantidad_preparada}`}
                    {it.cantidad_verificada != null && ` · verificado ${it.cantidad_verificada}`}
                  </small>
                </div>
                {etapa ? (
                  <input className="conteo-input2 dist-input" inputMode="decimal"
                    value={edits[it.linea_id] ?? String(campoActual(it))}
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
        {op.estado === 'aprobada' && (
          <button className="btn btn-primary" disabled={busy} onClick={() => void accion(() => api(`/distribuciones/${op.id}/preparar`, { method: 'POST' }))}>
            Iniciar preparación
          </button>
        )}
        {op.estado === 'en_preparacion' && (
          <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void guardar()}>Guardar surtido</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void accion(() => api(`/distribuciones/${op.id}/preparada`, { method: 'POST' }))}>Marcar preparada</button>
          </>
        )}
        {op.estado === 'preparada' && (
          <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void guardar()}>Guardar verificación</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void accion(() => api(`/distribuciones/${op.id}/verificada`, { method: 'POST' }))}>Marcar verificada</button>
          </>
        )}
        {op.estado === 'verificada' && (
          <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => void guardar()}>Guardar carga</button>
            <button className="btn btn-primary" disabled={busy} onClick={() => void accion(() => api(`/distribuciones/${op.id}/cargar`, { method: 'POST' }))}>Confirmar carga</button>
          </>
        )}
        {(op.estado === 'en_transito' || op.estado === 'parcialmente_entregada') && (
          <span className="muted">En tránsito — pendiente de recepción en sucursal.</span>
        )}
      </div>
    </div>
  );
}
