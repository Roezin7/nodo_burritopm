import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { EstadoDistChip, FaseChip, FlujoStepper } from '../../flujo';
import BodegaRutaTabs from '../../components/BodegaRutaTabs';
import { indiceEnOrden, nombreEnOrden, type LineaOperacion } from '../../operationOrder';

interface DistResumen { id: number; estado: string; creado_at: string; total_lineas: number }
interface OpItem {
  linea_id: number;
  product_id: number;
  sku: string;
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
  sku: string;
  nombre: string;
  unidad: string;
  categoria: string | null;
  total_aprobada: number;
  total_a_cargar: number;
  bodega_disponible: number;
  faltante: number;
}
interface Operacion {
  id: number;
  estado: string;
  linea: LineaOperacion;
  preparado_por: number | null;
  verificado_por: number | null;
  total_carga: TotalCarga[];
  grupos: { ubicacion: { id: number; nombre: string }; items: OpItem[] }[];
}

// Flujo v2: bodega trabaja distribuciones aprobadas (o verificadas si la verificación está activa).
const ESTADOS_BODEGA = ['aprobada', 'verificada', 'en_transito', 'parcialmente_entregada'];
const ESTADOS_HIST = ['entregada', 'cerrada', 'cerrada_con_incidencias', 'cancelada'];

export default function Bodega({ integrado = false }: { integrado?: boolean }) {
  const [lista, setLista] = useState<DistResumen[]>([]);
  const [op, setOp] = useState<Operacion | null>(null);
  const [verificacionCarga, setVerificacionCarga] = useState(false);
  const [tab, setTab] = useState<'activos' | 'historial'>('activos');
  const [error, setError] = useState('');

  async function cargar() {
    try {
      setLista(await api<DistResumen[]>('/distribuciones'));
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

  if (op) return <OperacionView op={op} verificacionCarga={verificacionCarga} integrado={integrado} onSalir={() => { setOp(null); void cargar(); }} onRecargar={() => abrir(op.id)} />;

  const activos = lista.filter((d) => ESTADOS_BODEGA.includes(d.estado));
  const historial = lista.filter((d) => ESTADOS_HIST.includes(d.estado));
  const mostradas = tab === 'activos' ? activos : historial;

  return (
    <div className={integrado ? 'embedded-operation' : 'page'}>
      {!integrado && <header className="page-head">
        <div><span className="eyebrow">Salida de almacén</span><h1>Despacho</h1><p className="page-sub">Surte la lista aprobada, verifica existencias y confirma la carga.</p></div>
      </header>}
      {!integrado && <FlujoStepper activo="bodega" />}
      {!integrado && <BodegaRutaTabs activo="bodega" />}
      {integrado && <header className="embedded-head"><div><span className="eyebrow">Paso 5</span><h2>Despacho</h2></div></header>}
      {error && <p className="error-msg">{error}</p>}

      <div className="tabs">
        <button className={tab === 'activos' ? 'tab tab--on' : 'tab'} onClick={() => setTab('activos')}>Por surtir ({activos.length})</button>
        <button className={tab === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setTab('historial')}>Historial ({historial.length})</button>
      </div>

      {mostradas.length === 0 ? (
        <p className="muted">{tab === 'activos' ? 'No hay pedidos aprobados por surtir.' : 'Aún no hay pedidos en el historial.'}</p>
      ) : (
        <div className="lista-ubicaciones">
          {mostradas.map((d) => (
            <button key={d.id} className="card card-click" onClick={() => void abrir(d.id)}>
              <div className="ubic-row">
                <div><strong>Pedido #{d.id}</strong> <FaseChip estado={d.estado} />
                  <div className="muted">{new Date(d.creado_at).toLocaleDateString('es-MX', { timeZone: 'America/Chicago', day: '2-digit', month: 'short' })} · {d.total_lineas} líneas</div></div>
                <span className="muted">›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OperacionView({ op, verificacionCarga, integrado, onSalir, onRecargar }: { op: Operacion; verificacionCarga: boolean; integrado: boolean; onSalir: () => void; onRecargar: () => void }) {
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [vista, setVista] = useState<'total' | 'sucursal'>('total');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Editable mientras el pedido no haya salido a ruta.
  const editable = op.estado === 'aprobada' || op.estado === 'verificada';
  const enRuta = op.estado === 'en_transito' || op.estado === 'parcialmente_entregada';
  const campoActual = (it: OpItem): number => it.cantidad_cargada ?? it.cantidad_aprobada;
  const totalFaltante = op.total_carga.filter((t) => t.faltante > 0).length;

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
    <div className={integrado ? 'embedded-operation conteo-page' : 'page conteo-page'}>
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
        <>
          {totalFaltante > 0 && (
            <p className="aviso-falt">⚠ Bodega no alcanza para {totalFaltante} producto{totalFaltante > 1 ? 's' : ''}. Solo se cargará lo disponible; el resto no sale (no se descuadra el inventario).</p>
          )}
          <div className="card">
            <div className="card-head"><strong>Todo lo que sube al camión</strong><span className="muted">{op.total_carga.length} productos</span></div>
            {[...op.total_carga].sort((a, b) => indiceEnOrden(a.sku, op.linea) - indiceEnOrden(b.sku, op.linea)).map((t) => (
              <div key={t.product_id} className={`carga-total-item ${t.faltante > 0 ? 'carga-total-item--falt' : ''}`}>
                <span>
                  <strong>{nombreEnOrden(t.sku, t.nombre, op.linea)}</strong> {t.categoria && <small className="muted"> · {t.categoria}</small>}
                  <small className="muted carga-bodega"> · en bodega {t.bodega_disponible}</small>
                  {t.faltante > 0 && <small className="txt-danger"> · faltan {t.faltante}</small>}
                </span>
                <span className="carga-total-qty">{t.total_a_cargar} <small>{t.unidad}</small></span>
              </div>
            ))}
            {editable && <p className="muted" style={{ marginTop: '0.6rem' }}>Para ajustar cantidades por sucursal, usa la pestaña <strong>Por sucursal</strong>.</p>}
          </div>
        </>
      ) : (
        op.grupos.map((g) => (
          <div key={g.ubicacion.id} className="card">
            <div className="card-head"><strong>{g.ubicacion.nombre}</strong></div>
            {[...g.items].sort((a, b) => indiceEnOrden(a.sku, op.linea) - indiceEnOrden(b.sku, op.linea)).map((it) => (
              <div key={it.linea_id} className="dist-row">
                <div className="conteo-prod">
                  <strong>{nombreEnOrden(it.sku, it.nombre, op.linea)}</strong>
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
