import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
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

type Sub = 'manual' | 'motor' | 'historial';

export default function StockObjetivo() {
  const [sub, setSub] = useState<Sub>('manual');
  return (
    <div>
      <div className="tabs">
        <button className={sub === 'manual' ? 'tab tab--on' : 'tab'} onClick={() => setSub('manual')}>Manual</button>
        <button className={sub === 'motor' ? 'tab tab--on' : 'tab'} onClick={() => setSub('motor')}>Sugerencia (motor)</button>
        <button className={sub === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setSub('historial')}>Historial (PDFs)</button>
      </div>
      {sub === 'manual' && <Manual />}
      {sub === 'motor' && <Motor />}
      {sub === 'historial' && <Historial />}
    </div>
  );
}

// ───────────────────────── Manual (edición directa de niveles) ─────────────
function Manual() {
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [ubicId, setUbicId] = useState<string>('');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

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
      .catch(() => setError('No se pudo cargar el stock objetivo'))
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
      setOk('Stock objetivo guardado');
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
        <p className="muted">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="muted">No hay productos activos. Crea productos en la pestaña Productos.</p>
      ) : (
        <>
          <p className="muted">
            Habilita los productos que usa esta ubicación y fija sus niveles (en <strong>unidad de distribución</strong>). El abastecimiento se calcula a partir del objetivo.
          </p>
          <div className="so-grid-head">
            <span>Producto</span><span>Usa</span><span>Objetivo</span><span>Mín</span><span>Seguridad</span><span>Múltiplo</span><span>Mín. envío</span>
          </div>
          <div className="so-rows">
            {items.map((it, idx) => (
              <div key={it.product_id} className={`so-row ${it.habilitado ? '' : 'so-row--off'}`}>
                <div className="so-prod"><strong>{it.nombre}</strong><small className="muted">{it.unidad_distribucion}{it.categoria ? ` · ${it.categoria}` : ''}</small></div>
                <label className="so-check"><input type="checkbox" checked={it.habilitado} onChange={(e) => set(idx, 'habilitado', e.target.checked)} /></label>
                <input className="so-num" inputMode="decimal" value={it.stock_objetivo} onChange={(e) => set(idx, 'stock_objetivo', Number(e.target.value) || 0)} disabled={!it.habilitado} />
                <input className="so-num" inputMode="decimal" value={it.stock_min} onChange={(e) => set(idx, 'stock_min', Number(e.target.value) || 0)} disabled={!it.habilitado} />
                <input className="so-num" inputMode="decimal" value={it.stock_seguridad} onChange={(e) => set(idx, 'stock_seguridad', Number(e.target.value) || 0)} disabled={!it.habilitado} />
                <input className="so-num" inputMode="decimal" value={it.multiplo_distribucion} onChange={(e) => set(idx, 'multiplo_distribucion', Number(e.target.value) || 1)} disabled={!it.habilitado} />
                <input className="so-num" inputMode="decimal" value={it.minimo_envio} onChange={(e) => set(idx, 'minimo_envio', Number(e.target.value) || 0)} disabled={!it.habilitado} />
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar stock objetivo'}</button>
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────── Motor (sugerencia automática) ───────────────────
type Confianza = 'alta' | 'media' | 'baja' | 'sin_datos';
type Fuente = 'consumo' | 'historico' | 'sin_datos';
interface Sugerencia {
  product_id: number;
  nombre: string;
  categoria: string | null;
  unidad: string;
  habilitado: boolean;
  fuente: Fuente;
  ciclos: number;
  anomalias: number;
  confianza: Confianza;
  consumo_diario: number;
  variabilidad: number;
  cobertura_dias: number;
  actual: { stock_objetivo: number; stock_seguridad: number };
  sugerido: { stock_objetivo: number; stock_seguridad: number; nivel_s: number };
}
interface RespSugerencia {
  ubicacion: { id: number; nombre: string };
  resumen: { total: number; con_consumo: number; con_historico: number; sin_datos: number; confianza_alta: number };
  items: Sugerencia[];
}

const NIVELES = [90, 95, 97.5, 99];
const CONF_META: Record<Confianza, { label: string; chip: string }> = {
  alta: { label: 'Confianza alta', chip: 'chip--ok' },
  media: { label: 'Confianza media', chip: 'chip--info' },
  baja: { label: 'Confianza baja', chip: 'chip--warn' },
  sin_datos: { label: 'Sin datos', chip: 'chip--muted' },
};
const FUENTE_LABEL: Record<Fuente, string> = { consumo: 'consumo real', historico: 'histórico de pedidos', sin_datos: '—' };
const n3 = (n: number) => (Math.round(n * 1000) / 1000).toString();

function Motor() {
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [ubicId, setUbicId] = useState('');
  const [nivel, setNivel] = useState(97.5);
  const [lead, setLead] = useState(1);
  const [data, setData] = useState<RespSugerencia | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [soloCambios, setSoloCambios] = useState(true);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [cargando, setCargando] = useState(false);
  const [aplicando, setAplicando] = useState(false);

  useEffect(() => {
    api<Ubicacion[]>('/ubicaciones').then((us) => {
      const suc = us.filter((u) => u.activo && u.tipo === 'sucursal');
      setUbicaciones(suc);
      if (suc[0]) setUbicId(String(suc[0].id));
    }).catch(() => setError('No se pudieron cargar las sucursales'));
  }, []);

  async function calcular() {
    if (!ubicId) return;
    setCargando(true); setError(''); setOk(''); setData(null);
    try {
      const r = await api<RespSugerencia>(`/inventario/stock-objetivo/sugerencia?ubicacion=${ubicId}&nivel_servicio=${nivel}&lead_time=${lead}`);
      setData(r);
      // Preselecciona los cambios con confianza suficiente.
      const pre = new Set<number>();
      for (const it of r.items) {
        const cambia = it.sugerido.stock_objetivo !== it.actual.stock_objetivo || it.sugerido.stock_seguridad !== it.actual.stock_seguridad;
        if (cambia && (it.confianza === 'alta' || it.confianza === 'media')) pre.add(it.product_id);
      }
      setSel(pre);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo calcular la sugerencia');
    } finally {
      setCargando(false);
    }
  }

  const visibles = useMemo(() => {
    if (!data) return [];
    return data.items.filter((it) => {
      if (q && !it.nombre.toLowerCase().includes(q.trim().toLowerCase())) return false;
      if (soloCambios) {
        const cambia = it.sugerido.stock_objetivo !== it.actual.stock_objetivo || it.sugerido.stock_seguridad !== it.actual.stock_seguridad;
        if (!cambia || it.fuente === 'sin_datos') return false;
      }
      return true;
    });
  }, [data, q, soloCambios]);

  const toggle = (id: number) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const todosVisibles = visibles.length > 0 && visibles.every((it) => sel.has(it.product_id));
  const toggleTodos = () => setSel((s) => {
    const n = new Set(s);
    if (todosVisibles) visibles.forEach((it) => n.delete(it.product_id));
    else visibles.forEach((it) => n.add(it.product_id));
    return n;
  });

  async function aplicar() {
    if (!data || sel.size === 0) return;
    setAplicando(true); setError(''); setOk('');
    try {
      const items = data.items.filter((it) => sel.has(it.product_id)).map((it) => ({
        product_id: it.product_id,
        habilitado: true,
        stock_objetivo: it.sugerido.stock_objetivo,
        stock_seguridad: it.sugerido.stock_seguridad,
        origen_calculo: it.fuente === 'consumo' ? 'automatico' : 'historico',
        consumo_promedio: it.consumo_diario,
        dias_cobertura: Math.round(it.cobertura_dias),
      }));
      await api('/catalogo/producto-ubicacion', { method: 'PUT', body: { ubicacion_id: Number(ubicId), items } });
      setOk(`Aplicado a ${items.length} producto${items.length > 1 ? 's' : ''}.`);
      await calcular();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo aplicar');
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div>
      <p className="muted">
        El motor estima el <strong>consumo diario</strong> y su variabilidad por producto (del consumo real reconstruido de los conteos, o del histórico de pedidos) y propone un
        <strong> stock objetivo + seguridad</strong> que cubre la demanda hasta el siguiente reabasto con el nivel de servicio elegido.
      </p>

      <div className="card motor-controls">
        <UbicacionPicker label="Sucursal" opciones={ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo }))} value={ubicId} onChange={setUbicId} />
        <label className="so-ubic">Nivel de servicio
          <select value={nivel} onChange={(e) => setNivel(Number(e.target.value))}>
            {NIVELES.map((n) => <option key={n} value={n}>{n}%{n >= 99 ? ' (máx. seguridad)' : n <= 90 ? ' (ajustado)' : ''}</option>)}
          </select>
        </label>
        <label className="so-ubic">Lead time (días)
          <input className="so-num" inputMode="numeric" value={lead} onChange={(e) => setLead(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <button className="btn btn-primary" onClick={() => void calcular()} disabled={cargando || !ubicId}>{cargando ? 'Calculando…' : 'Calcular sugerencia'}</button>
      </div>

      {error && <p className="error-msg">{error}</p>}
      {ok && <p className="ok-msg">{ok}</p>}

      {data && (
        <>
          <p className="muted">
            {data.resumen.total} productos · {data.resumen.con_consumo} con consumo real · {data.resumen.con_historico} con histórico · {data.resumen.sin_datos} sin datos.
            {data.resumen.con_consumo + data.resumen.con_historico === 0 && ' Carga el historial de pedidos para alimentar el motor.'}
          </p>

          <div className="dist-filtros">
            <input className="inv-search" type="search" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="button" className={`chip ${soloCambios ? 'chip--info' : 'chip--muted'}`} style={{ cursor: 'pointer', border: 0 }} onClick={() => setSoloCambios((v) => !v)}>
              {soloCambios ? 'Solo cambios' : 'Todos'}
            </button>
          </div>

          {visibles.length === 0 ? (
            <p className="muted">Sin productos que mostrar con este filtro.</p>
          ) : (
            <>
              <div className="form-actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="so-check" style={{ gap: '0.4rem' }}><input type="checkbox" checked={todosVisibles} onChange={toggleTodos} /> <span className="muted">Seleccionar visibles ({visibles.length})</span></label>
                <button className="btn btn-primary" disabled={aplicando || sel.size === 0} onClick={() => void aplicar()}>{aplicando ? 'Aplicando…' : `Aplicar ${sel.size} seleccionados`}</button>
              </div>

              <div className="motor-list">
                {visibles.map((it) => {
                  const sube = it.sugerido.nivel_s > it.actual.stock_objetivo + it.actual.stock_seguridad;
                  const baja = it.sugerido.nivel_s < it.actual.stock_objetivo + it.actual.stock_seguridad;
                  return (
                    <div key={it.product_id} className="card motor-row">
                      <label className="so-check"><input type="checkbox" checked={sel.has(it.product_id)} onChange={() => toggle(it.product_id)} /></label>
                      <div className="motor-info">
                        <div className="motor-prod"><strong>{it.nombre}</strong> <small className="muted">{it.unidad}</small></div>
                        <div className="motor-chips">
                          <span className={`chip ${CONF_META[it.confianza].chip}`}>{CONF_META[it.confianza].label}</span>
                          <small className="muted">{FUENTE_LABEL[it.fuente]} · {it.ciclos} ciclos{it.anomalias > 0 ? ` · ${it.anomalias} atípicos` : ''}</small>
                        </div>
                        <div className="motor-base muted">
                          {it.fuente === 'sin_datos' ? 'Sin historial suficiente para estimar.' : <>~{n3(it.consumo_diario)}/día · variab. ±{n3(it.variabilidad)} · cobertura {n3(it.cobertura_dias)} d</>}
                        </div>
                      </div>
                      <div className="motor-nums">
                        <div className="motor-actual"><small className="muted">actual</small><span>{n3(it.actual.stock_objetivo)} + {n3(it.actual.stock_seguridad)}</span></div>
                        <span className={`motor-arrow ${sube ? 'up' : baja ? 'down' : ''}`}>{sube ? '↑' : baja ? '↓' : '='}</span>
                        <div className="motor-sug"><small className="muted">sugerido</small><strong>{n3(it.sugerido.stock_objetivo)} + {n3(it.sugerido.stock_seguridad)}</strong></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────── Historial (importar PDFs migrados) ──────────────
interface ResumenHist {
  total: number;
  sucursales: { ubicacion_id: number; nombre: string; pedidos: number; desde: string; hasta: string }[];
}
interface RespImport {
  insertados: number;
  descartados: number;
  errores: { fila: number; motivo: string }[];
  sucursales_no_encontradas: string[];
  productos_no_encontrados: string[];
}

// Detecta separador y parsea CSV con encabezado (fecha, sucursal|ubicacion_id, producto|sku|product_id, cantidad).
function parseCSV(texto: string): Record<string, string>[] {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2) return [];
  const sep = [',', ';', '\t'].sort((a, b) => (lineas[0]!.split(b).length - lineas[0]!.split(a).length))[0]!;
  const cols = lineas[0]!.split(sep).map((c) => c.trim().toLowerCase());
  return lineas.slice(1).map((l) => {
    const celdas = l.split(sep);
    const o: Record<string, string> = {};
    cols.forEach((c, i) => { o[c] = (celdas[i] ?? '').trim(); });
    return o;
  });
}

function Historial() {
  const [resumen, setResumen] = useState<ResumenHist | null>(null);
  const [texto, setTexto] = useState('');
  const [reemplazar, setReemplazar] = useState(false);
  const [resultado, setResultado] = useState<RespImport | null>(null);
  const [error, setError] = useState('');
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function cargarResumen() {
    try { setResumen(await api<ResumenHist>('/inventario/historial/resumen')); } catch { /* noop */ }
  }
  useEffect(() => { void cargarResumen(); }, []);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setTexto(String(reader.result ?? ''));
    reader.readAsText(f);
  }

  async function importar() {
    setImportando(true); setError(''); setResultado(null);
    try {
      const filas = parseCSV(texto);
      if (filas.length === 0) { setError('No se detectaron filas. Usa un encabezado con: fecha, sucursal, producto, cantidad.'); return; }
      const items = filas.map((f) => ({
        fecha: f['fecha'] ?? '',
        sucursal: f['sucursal'] ?? f['ubicacion'] ?? undefined,
        ubicacion_id: f['ubicacion_id'] ? Number(f['ubicacion_id']) : undefined,
        producto: f['producto'] ?? f['nombre'] ?? undefined,
        sku: f['sku'] ?? undefined,
        product_id: f['product_id'] ? Number(f['product_id']) : undefined,
        cantidad: Number(f['cantidad'] ?? f['qty'] ?? 0),
      }));
      const r = await api<RespImport>('/inventario/historial/import', { method: 'POST', body: { items, reemplazar } });
      setResultado(r);
      await cargarResumen();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo importar');
    } finally {
      setImportando(false);
    }
  }

  return (
    <div>
      <p className="muted">
        Carga aquí los <strong>pedidos históricos</strong> (los de tus PDFs) para alimentar el motor mientras se acumulan conteos. Es solo señal de demanda: <strong>no toca el inventario</strong>.
      </p>

      <div className="card">
        <strong>Historial cargado</strong>
        {resumen && resumen.total > 0 ? (
          <>
            <p className="muted" style={{ margin: '0.2rem 0 0.6rem' }}>{resumen.total} pedidos en total.</p>
            <div className="so-rows">
              {resumen.sucursales.map((s) => (
                <div key={s.ubicacion_id} className="ubic-row">
                  <span>{s.nombre}</span>
                  <span className="muted">{s.pedidos} pedidos · {s.desde} → {s.hasta}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted" style={{ margin: '0.2rem 0 0' }}>Aún no hay historial cargado.</p>
        )}
      </div>

      <div className="card">
        <strong>Importar CSV</strong>
        <p className="muted" style={{ margin: '0.2rem 0 0.5rem' }}>
          Columnas: <code>fecha</code> (YYYY-MM-DD), <code>sucursal</code> (o <code>ubicacion_id</code>), <code>producto</code> (o <code>sku</code>/<code>product_id</code>), <code>cantidad</code>. Separador coma, punto y coma o tab.
        </p>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={onFile} style={{ marginBottom: '0.5rem' }} />
        <textarea
          className="hist-textarea"
          rows={8}
          placeholder={'fecha,sucursal,producto,cantidad\n2026-01-05,Sucursal Centro,Tortilla de maíz,40\n2026-01-12,Sucursal Centro,Tortilla de maíz,55'}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <label className="so-check" style={{ gap: '0.4rem', margin: '0.5rem 0' }}>
          <input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} />
          <span className="muted">Reemplazar todo el historial previo (re-importación limpia)</span>
        </label>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={importando || !texto.trim()} onClick={() => void importar()}>{importando ? 'Importando…' : 'Importar'}</button>
        </div>
      </div>

      {resultado && (
        <div className="card">
          <strong>Resultado</strong>
          <p className="muted" style={{ margin: '0.3rem 0' }}>Insertados: <strong>{resultado.insertados}</strong> · Descartados: {resultado.descartados}</p>
          {resultado.sucursales_no_encontradas.length > 0 && <p className="txt-danger" style={{ margin: '0.2rem 0' }}>Sucursales no encontradas: {resultado.sucursales_no_encontradas.join(', ')}</p>}
          {resultado.productos_no_encontrados.length > 0 && <p className="txt-danger" style={{ margin: '0.2rem 0' }}>Productos no encontrados: {resultado.productos_no_encontrados.join(', ')}</p>}
          {resultado.errores.length > 0 && (
            <details style={{ marginTop: '0.4rem' }}>
              <summary className="muted">Ver primeros errores ({resultado.errores.length})</summary>
              <ul className="muted">{resultado.errores.map((e, i) => <li key={i}>Fila {e.fila}: {e.motivo}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
