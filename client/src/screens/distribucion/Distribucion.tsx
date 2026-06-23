import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';

interface DistResumen {
  id: number;
  estado: string;
  creado_at: string;
  aprobado_at: string | null;
  total_lineas: number;
}

const usd = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);

export default function Distribucion() {
  const [lista, setLista] = useState<DistResumen[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cargando, setCargando] = useState(true);
  const [calculando, setCalculando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      setLista(await api<DistResumen[]>('/distribuciones'));
    } catch {
      setError('No se pudieron cargar las distribuciones');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); }, []);

  async function calcular() {
    setCalculando(true); setError(''); setInfo('');
    try {
      const r = await api<{ id: number; lineas: number; sin_conteo: string[] }>('/distribuciones', { method: 'POST', body: {} });
      if (r.sin_conteo.length) setInfo(`Sucursales sin conteo cerrado (excluidas): ${r.sin_conteo.join(', ')}`);
      await cargar();
      setAbierta(r.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo calcular');
    } finally {
      setCalculando(false);
    }
  }

  if (abierta != null) {
    return <Consolidado id={abierta} onSalir={() => { setAbierta(null); void cargar(); }} />;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Distribución</h1>
          <p className="page-sub">Calcula el pedido maestro a partir de los conteos cerrados.</p>
        </div>
      </header>

      {error && <p className="error-msg">{error}</p>}
      {info && <p className="muted">{info}</p>}

      <button className="btn btn-primary btn-grande" onClick={() => void calcular()} disabled={calculando}>
        {calculando ? 'Calculando…' : '+ Calcular distribución'}
      </button>

      <h3 className="seccion-title">Distribuciones</h3>
      {cargando ? (
        <p className="muted">Cargando…</p>
      ) : lista.length === 0 ? (
        <p className="muted">Aún no hay distribuciones.</p>
      ) : (
        <div className="lista-ubicaciones">
          {lista.map((d) => (
            <button key={d.id} className="card card-click" onClick={() => setAbierta(d.id)}>
              <div className="ubic-row">
                <div>
                  <strong>Distribución #{d.id}</strong> <EstadoChip estado={d.estado} />
                  <div className="muted">
                    {new Date(d.creado_at).toLocaleString('es-MX', { timeZone: 'America/Chicago' })} · {d.total_lineas} líneas
                  </div>
                </div>
                <span className="muted">›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function EstadoChip({ estado }: { estado: string }) {
  const cls: Record<string, string> = { aprobada: 'chip chip--ok', calculada: 'chip chip--info', en_revision: 'chip chip--warn' };
  const label: Record<string, string> = { aprobada: 'Aprobada', calculada: 'Calculada', en_revision: 'En revisión' };
  return <span className={cls[estado] ?? 'chip'}>{label[estado] ?? estado}</span>;
}

// ───────────────────────── Consolidado ─────────────────────────────────────

interface SucItem {
  linea_id: number;
  product_id: number;
  nombre: string;
  unidad: string;
  categoria: string | null;
  disponible: number;
  stock_objetivo: number;
  cantidad_sugerida: number;
  cantidad_aprobada: number | null;
  costo_unitario: number | null;
  valor: number;
}
interface VistaSucursal {
  estado: string;
  vista: 'sucursal';
  grupos: { ubicacion: { id: number; nombre: string }; items: SucItem[]; subtotal: number }[];
  total: number;
}
interface ProdItem {
  product_id: number;
  nombre: string;
  unidad: string;
  costo_unitario: number | null;
  bodega_disponible: number;
  total_sugerida: number;
  total_aprobada: number;
  surtible: number;
  faltante: number;
  valor: number;
  sucursales: { ubicacion: string; cantidad_sugerida: number; cantidad_aprobada: number | null }[];
}
interface VistaProducto {
  estado: string;
  vista: 'producto';
  items: ProdItem[];
  total_valor: number;
  total_faltante_valor: number;
}

function Consolidado({ id, onSalir }: { id: number; onSalir: () => void }) {
  const [vista, setVista] = useState<'producto' | 'sucursal'>('producto');
  const [prod, setProd] = useState<VistaProducto | null>(null);
  const [suc, setSuc] = useState<VistaSucursal | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const estado = vista === 'producto' ? prod?.estado : suc?.estado;
  const editable = estado === 'calculada' || estado === 'en_revision';

  async function cargar() {
    setError('');
    try {
      if (vista === 'producto') setProd(await api<VistaProducto>(`/distribuciones/${id}/consolidado?vista=producto`));
      else setSuc(await api<VistaSucursal>(`/distribuciones/${id}/consolidado?vista=sucursal`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al cargar el consolidado');
    }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [vista, id]);

  async function guardarAjustes() {
    const ajustes = Object.entries(edits)
      .map(([linea_id, v]) => ({ linea_id: Number(linea_id), cantidad_aprobada: Number(v) }))
      .filter((a) => !Number.isNaN(a.cantidad_aprobada));
    if (ajustes.length === 0) return;
    setBusy(true); setError('');
    try {
      await api(`/distribuciones/${id}/lineas`, { method: 'PATCH', body: { ajustes } });
      setEdits({});
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al guardar ajustes');
    } finally {
      setBusy(false);
    }
  }

  async function aprobar() {
    if (!window.confirm('Al aprobar, la distribución queda lista para preparación en bodega. ¿Continuar?')) return;
    setBusy(true); setError('');
    try {
      if (Object.keys(edits).length) await guardarAjustes();
      await api(`/distribuciones/${id}/aprobar`, { method: 'POST' });
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al aprobar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <button className="link-btn" onClick={onSalir}>← Distribuciones</button>
          <h1>Distribución #{id} {estado && <EstadoChip estado={estado} />}</h1>
        </div>
      </header>

      <div className="tabs">
        <button className={vista === 'producto' ? 'tab tab--on' : 'tab'} onClick={() => setVista('producto')}>Por producto</button>
        <button className={vista === 'sucursal' ? 'tab tab--on' : 'tab'} onClick={() => setVista('sucursal')}>Por sucursal</button>
      </div>

      {error && <p className="error-msg">{error}</p>}

      {vista === 'producto' && prod && (
        <>
          <p className="muted">
            Valor total: <strong>{usd(prod.total_valor)}</strong>
            {prod.total_faltante_valor > 0 && <> · Faltante en bodega: <strong>{usd(prod.total_faltante_valor)}</strong></>}
          </p>
          {prod.items.map((it) => (
            <div key={it.product_id} className={`card ${it.faltante > 0 ? 'card--falt' : ''}`}>
              <div className="ubic-row">
                <div>
                  <strong>{it.nombre}</strong> <span className="chip chip--info">{it.unidad}</span>
                  <div className="muted">
                    Pedido: {it.total_aprobada} · Bodega: {it.bodega_disponible} · Surtible: {it.surtible}
                    {it.faltante > 0 && <> · <span className="txt-danger">Faltan {it.faltante}</span></>}
                  </div>
                  <div className="dist-suc-mini">
                    {it.sucursales.map((s, i) => (
                      <span key={i}>{s.ubicacion}: {s.cantidad_aprobada ?? s.cantidad_sugerida}</span>
                    ))}
                  </div>
                </div>
                <div className="dist-valor">{usd(it.valor)}</div>
              </div>
            </div>
          ))}
        </>
      )}

      {vista === 'sucursal' && suc && (
        <>
          <p className="muted">Valor total: <strong>{usd(suc.total)}</strong></p>
          {suc.grupos.map((g) => (
            <div key={g.ubicacion.id} className="card">
              <div className="card-head"><strong>{g.ubicacion.nombre}</strong><span className="muted">{usd(g.subtotal)}</span></div>
              {g.items.map((it) => (
                <div key={it.linea_id} className="dist-row">
                  <div className="conteo-prod">
                    <strong>{it.nombre}</strong>
                    <small className="muted">{it.unidad} · tiene {it.disponible} · objetivo {it.stock_objetivo} · sugerido {it.cantidad_sugerida}</small>
                  </div>
                  {editable ? (
                    <input
                      className="conteo-input2 dist-input"
                      inputMode="decimal"
                      value={edits[it.linea_id] ?? String(it.cantidad_aprobada ?? it.cantidad_sugerida)}
                      onChange={(e) => setEdits({ ...edits, [it.linea_id]: e.target.value })}
                    />
                  ) : (
                    <span className="dist-aprob">{it.cantidad_aprobada ?? it.cantidad_sugerida}</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {editable && (
        <div className="action-bar">
          {vista === 'sucursal' && (
            <button className="btn btn-secondary" onClick={() => void guardarAjustes()} disabled={busy || Object.keys(edits).length === 0}>
              Guardar ajustes
            </button>
          )}
          <button className="btn btn-primary" onClick={() => void aprobar()} disabled={busy}>Aprobar distribución</button>
        </div>
      )}
    </div>
  );
}
