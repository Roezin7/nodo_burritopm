import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { useToast, mensajeError } from '../../toast';
import { EstadoDistChip, FaseChip, ParadaChip, FlujoStepper } from '../../flujo';

interface DistResumen {
  id: number;
  nombre: string | null;
  estado: string;
  creado_at: string;
  aprobado_at: string | null;
  total_lineas: number;
}

const tituloDist = (d: { id: number; nombre: string | null }) => d.nombre?.trim() || `Pedido #${d.id}`;

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
      setError('No se pudieron cargar los pedidos');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); }, []);

  async function calcular() {
    setCalculando(true); setError(''); setInfo('');
    try {
      const r = await api<{ id: number; lineas: number; sin_conteo: string[] }>('/distribuciones', { method: 'POST', body: {} });
      if (r.sin_conteo.length) setInfo(`Sucursales sin pedido cerrado (excluidas): ${r.sin_conteo.join(', ')}`);
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
          <p className="page-sub">Crea el pedido maestro a partir de los pedidos cerrados por cada sucursal.</p>
        </div>
      </header>

      <FlujoStepper activo="plan" />

      {error && <p className="error-msg">{error}</p>}
      {info && <p className="muted">{info}</p>}

      <button className="btn btn-primary btn-grande" onClick={() => void calcular()} disabled={calculando}>
        {calculando ? 'Creando…' : '+ Crear pedido'}
      </button>

      <h3 className="seccion-title">Pedidos</h3>
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
                  <strong>{tituloDist(d)}</strong> <FaseChip estado={d.estado} />
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

// ───────────────────────── Consolidado ─────────────────────────────────────

interface SucItem {
  linea_id: number;
  product_id: number;
  nombre: string;
  unidad: string;
  categoria: string | null;
  cantidad_sugerida: number;
  cantidad_aprobada: number | null;
  costo_unitario: number | null;
  valor: number;
}
interface VistaSucursal {
  estado: string;
  nombre: string | null;
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
  nombre: string | null;
  vista: 'producto';
  items: ProdItem[];
  total_valor: number;
  total_faltante_valor: number;
}

function Consolidado({ id, onSalir }: { id: number; onSalir: () => void }) {
  const toast = useToast();
  const [vista, setVista] = useState<'producto' | 'sucursal' | 'ruta'>('producto');
  const [prod, setProd] = useState<VistaProducto | null>(null);
  const [suc, setSuc] = useState<VistaSucursal | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [q, setQ] = useState('');
  const [soloFaltante, setSoloFaltante] = useState(false);
  const [agregables, setAgregables] = useState<{ id: number; nombre: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // El estado y el nombre los conocemos de cualquier vista ya cargada.
  const estado = prod?.estado ?? suc?.estado;
  const nombre = prod?.nombre ?? suc?.nombre ?? null;
  const editable = estado === 'calculada' || estado === 'en_revision';
  const puedeRuta = estado != null && !['calculada', 'en_revision'].includes(estado);

  // Sucursales rezagadas que aún se pueden sumar (solo mientras el pedido es editable).
  useEffect(() => {
    if (!editable) { setAgregables([]); return; }
    api<{ id: number; nombre: string }[]>(`/distribuciones/${id}/agregables`).then(setAgregables).catch(() => setAgregables([]));
  }, [id, editable]);

  async function agregarSucursal(sucId: number) {
    setBusy(true); setError('');
    try {
      const r = await api<{ agregadas: string[]; lineas: number }>(
        `/distribuciones/${id}/sucursales`, { method: 'POST', body: { ubicacion_ids: [sucId] } });
      setAgregables((a) => a.filter((s) => s.id !== sucId));
      await cargar();
      toast.ok(`${r.agregadas.join(', ')} agregada · ${r.lineas} líneas`);
    } catch (e) {
      setError(mensajeError(e, 'No se pudo agregar la sucursal.'));
    } finally {
      setBusy(false);
    }
  }

  async function cargar() {
    setError('');
    try {
      if (vista === 'producto') setProd(await api<VistaProducto>(`/distribuciones/${id}/consolidado?vista=producto`));
      else if (vista === 'sucursal') setSuc(await api<VistaSucursal>(`/distribuciones/${id}/consolidado?vista=sucursal`));
      else if (!prod && !suc) setProd(await api<VistaProducto>(`/distribuciones/${id}/consolidado?vista=producto`));
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

  async function renombrar() {
    const actual = nombre ?? '';
    const nuevo = window.prompt('Nombre del pedido (vacío para quitar):', actual);
    if (nuevo == null || nuevo.trim() === actual) return;
    setBusy(true); setError('');
    try {
      await api(`/distribuciones/${id}`, { method: 'PATCH', body: { nombre: nuevo.trim() } });
      await cargar();
      toast.ok('Pedido renombrado.');
    } catch (e) {
      setError(mensajeError(e, 'No se pudo renombrar.'));
    } finally {
      setBusy(false);
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este pedido? Se devolverá a la bodega central el inventario que las sucursales aún tengan de él, se borrarán su ruta e incidencias, y también el pedido capturado por cada sucursal (podrán hacer uno nuevo). No se puede deshacer.')) return;
    setBusy(true); setError('');
    try {
      await api(`/distribuciones/${id}`, { method: 'DELETE' });
      toast.ok('Pedido eliminado · inventario devuelto a bodega.');
      onSalir();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo eliminar.'));
      setBusy(false);
    }
  }

  async function aprobar() {
    setBusy(true); setError('');
    try {
      if (Object.keys(edits).length) await guardarAjustes();
      await api(`/distribuciones/${id}/aprobar`, { method: 'POST' });
      toast.ok('Pedido aprobado · listo para bodega.', {
        label: 'Deshacer',
        onClick: async () => {
          try { await api(`/distribuciones/${id}/estado`, { method: 'PATCH', body: { estado: 'en_revision' } }); await cargar(); }
          catch (e) { toast.error(mensajeError(e, 'No se pudo deshacer.')); }
        },
      });
      await cargar();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo aprobar. Reintenta.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <button className="link-btn" onClick={onSalir}>← Pedidos</button>
          <h1>{nombre?.trim() || `Pedido #${id}`} {estado && <EstadoDistChip estado={estado} />}</h1>
          {nombre?.trim() && <p className="page-sub">Pedido #{id}</p>}
        </div>
        <div className="dist-acciones">
          <button className="btn btn-secondary" disabled={busy} onClick={() => void renombrar()}>Renombrar</button>
          <button className="btn btn-danger" disabled={busy} onClick={() => void eliminar()}>Eliminar</button>
        </div>
      </header>

      <div className="tabs">
        <button className={vista === 'producto' ? 'tab tab--on' : 'tab'} onClick={() => setVista('producto')}>Por producto</button>
        <button className={vista === 'sucursal' ? 'tab tab--on' : 'tab'} onClick={() => setVista('sucursal')}>Por sucursal</button>
        {puedeRuta && <button className={vista === 'ruta' ? 'tab tab--on' : 'tab'} onClick={() => setVista('ruta')}>Ruta</button>}
      </div>

      {error && <p className="error-msg">{error}</p>}

      {editable && agregables.length > 0 && vista !== 'ruta' && (
        <div className="card">
          <div className="card-head"><strong>¿Falta una sucursal?</strong><span className="muted">cerró tarde</span></div>
          <p className="muted" style={{ margin: '0 0 0.5rem' }}>Inclúyela sin rehacer el pedido: se suma lo que pidió esa sucursal.</p>
          <div className="dist-suc-mini">
            {agregables.map((s) => (
              <button key={s.id} className="chip chip--info" style={{ cursor: 'pointer', border: 0 }} disabled={busy} onClick={() => void agregarSucursal(s.id)}>
                + {s.nombre}
              </button>
            ))}
          </div>
        </div>
      )}

      {vista === 'ruta' && <RutaPlanner id={id} />}

      {vista === 'producto' && prod && (
        <>
          <p className="muted">
            Valor total: <strong>{usd(prod.total_valor)}</strong>
            {prod.total_faltante_valor > 0 && <> · Faltante en bodega: <strong>{usd(prod.total_faltante_valor)}</strong></>}
          </p>
          {prod.items.length > 12 && (
            <div className="dist-filtros">
              <input className="inv-search" type="search" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" className={`chip ${soloFaltante ? 'chip--danger' : 'chip--muted'}`} style={{ cursor: 'pointer', border: 0 }} onClick={() => setSoloFaltante((v) => !v)}>
                Solo con faltante
              </button>
            </div>
          )}
          {prod.items
            .filter((it) => !q || it.nombre.toLowerCase().includes(q.trim().toLowerCase()))
            .filter((it) => !soloFaltante || it.faltante > 0)
            .slice()
            .sort((a, b) => (b.faltante > 0 ? 1 : 0) - (a.faltante > 0 ? 1 : 0))
            .map((it) => (
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
                    <small className="muted">{it.unidad} · pedido {it.cantidad_sugerida}</small>
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

      {editable && vista !== 'ruta' && (
        <div className="action-bar">
          {vista === 'sucursal' && (
            <button className="btn btn-secondary" onClick={() => void guardarAjustes()} disabled={busy || Object.keys(edits).length === 0}>
              Guardar ajustes
            </button>
          )}
          <button className="btn btn-primary" onClick={() => void aprobar()} disabled={busy}>Aprobar distribución</button>
        </div>
      )}

      {estado && <ControlEstado id={id} estado={estado} onCambiado={() => void cargar()} />}
    </div>
  );
}

// ── Control total del admin: forzar el estado de la distribución ─────────────
const ESTADOS_DIST: { v: string; label: string }[] = [
  { v: 'calculada', label: 'Calculada' },
  { v: 'en_revision', label: 'En revisión' },
  { v: 'aprobada', label: 'Aprobada' },
  { v: 'verificada', label: 'Verificada' },
  { v: 'en_transito', label: 'En ruta' },
  { v: 'parcialmente_entregada', label: 'Entrega parcial' },
  { v: 'entregada', label: 'Entregada' },
  { v: 'cerrada', label: 'Cerrada' },
  { v: 'cerrada_con_incidencias', label: 'Cerrada c/ incidencias' },
  { v: 'cancelada', label: 'Cancelada' },
];

function ControlEstado({ id, estado, onCambiado }: { id: number; estado: string; onCambiado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [sel, setSel] = useState(estado);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setSel(estado); }, [estado]);

  async function aplicar() {
    if (sel === estado) return;
    if (!window.confirm(`Forzar el estado a "${ESTADOS_DIST.find((e) => e.v === sel)?.label ?? sel}"? Es un override manual; no recalcula inventario.`)) return;
    setBusy(true); setError('');
    try {
      await api(`/distribuciones/${id}/estado`, { method: 'PATCH', body: { estado: sel } });
      onCambiado();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo cambiar el estado');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card control-admin">
      <button type="button" className="control-admin-head" onClick={() => setAbierto((v) => !v)}>
        <span><strong>Control total (admin)</strong> <small className="muted">cambiar estado manualmente</small></span>
        <span className="muted">{abierto ? '▾' : '▸'}</span>
      </button>
      {abierto && (
        <div className="control-admin-body">
          <p className="muted">Mueve la distribución a cualquier etapa del flujo. Úsalo para corregir o desbloquear; es un override directo.</p>
          <div className="control-admin-row">
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              {ESTADOS_DIST.map((e) => <option key={e.v} value={e.v}>{e.label}</option>)}
            </select>
            <button className="btn btn-primary" disabled={busy || sel === estado} onClick={() => void aplicar()}>Aplicar</button>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Planificador de ruta (admin) ────────────────────
interface RutaParada {
  parada_id: number;
  ubicacion: { id: number; nombre: string; direccion: string | null };
  orden: number;
  estado: string;
}
interface RutaDetalle {
  ruta_id: number;
  estado: string;
  repartidor: { id: number; nombre: string } | null;
  paradas: RutaParada[];
}
interface UsuarioBasico { id: number; nombre: string; rol: string }
interface Sucursal { id: number; nombre: string }

function RutaPlanner({ id }: { id: number }) {
  const [ruta, setRuta] = useState<RutaDetalle | null>(null);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [repartidores, setRepartidores] = useState<UsuarioBasico[]>([]);
  const [orden, setOrden] = useState<Sucursal[]>([]); // sucursales seleccionadas, en orden
  const [repartidorId, setRepartidorId] = useState<string>('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function cargar() {
    setError('');
    try {
      const [r, sucCons, usuarios] = await Promise.all([
        api<RutaDetalle | null>(`/distribuciones/${id}/ruta`),
        api<VistaSucursal>(`/distribuciones/${id}/consolidado?vista=sucursal`),
        api<UsuarioBasico[]>('/auth/usuarios?negocio=1', { auth: false }),
      ]);
      const sucs = sucCons.grupos.map((g) => ({ id: g.ubicacion.id, nombre: g.ubicacion.nombre }));
      setSucursales(sucs);
      setRepartidores(usuarios.filter((u) => u.rol === 'encargado_bodega'));
      setRuta(r);
      if (r) {
        setOrden(r.paradas.sort((a, b) => a.orden - b.orden).map((p) => ({ id: p.ubicacion.id, nombre: p.ubicacion.nombre })));
        setRepartidorId(r.repartidor ? String(r.repartidor.id) : '');
      } else {
        setOrden(sucs); // por defecto, todas en el orden del consolidado
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al cargar la ruta');
    }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [id]);

  const bloqueada = ruta != null && ruta.estado !== 'planificada';
  const seleccionadas = new Set(orden.map((s) => s.id));
  const disponibles = sucursales.filter((s) => !seleccionadas.has(s.id));

  function mover(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= orden.length) return;
    const next = [...orden];
    [next[i], next[j]] = [next[j], next[i]];
    setOrden(next);
  }
  const quitar = (sid: number) => setOrden(orden.filter((s) => s.id !== sid));
  const agregar = (s: Sucursal) => setOrden([...orden, s]);

  async function guardar() {
    if (orden.length === 0) { setError('Agrega al menos una parada'); return; }
    setBusy(true); setError(''); setInfo('');
    try {
      await api(`/distribuciones/${id}/ruta`, {
        method: 'PUT',
        body: {
          repartidor_id: repartidorId ? Number(repartidorId) : null,
          paradas: orden.map((s, i) => ({ ubicacion_id: s.id, orden: i + 1 })),
        },
      });
      setInfo('Ruta guardada');
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar la ruta');
    } finally {
      setBusy(false);
    }
  }

  if (bloqueada && ruta) {
    // Ruta despachada o completada: tablero de solo lectura.
    return (
      <div className="card">
        <div className="card-head">
          <strong>Ruta {ruta.estado === 'completada' ? 'completada' : 'en curso'}</strong>
          <span className="muted">{ruta.repartidor?.nombre ?? 'sin repartidor'}</span>
        </div>
        <div className="ruta-tablero">
          {ruta.paradas.sort((a, b) => a.orden - b.orden).map((p) => (
            <div key={p.parada_id} className="ruta-parada-fila">
              <span className={`ruta-dot ruta-dot--${p.estado}`} />
              <span><strong>{p.orden}. {p.ubicacion.nombre}</strong></span>
              <ParadaChip estado={p.estado} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {error && <p className="error-msg">{error}</p>}
      {info && <p className="muted">{info}</p>}

      <div className="card">
        <label className="so-ubic">Repartidor (Bodega y reparto)
          <select value={repartidorId} onChange={(e) => setRepartidorId(e.target.value)}>
            <option value="">— Sin asignar —</option>
            {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </label>
        {repartidores.length === 0 && <p className="muted">No hay usuarios de Bodega y reparto. Créalos en Configuración.</p>}
      </div>

      <div className="card">
        <div className="card-head"><strong>Orden de entrega</strong><span className="muted">{orden.length} paradas</span></div>
        {orden.length === 0 ? (
          <p className="muted">Agrega sucursales desde la lista de abajo.</p>
        ) : (
          orden.map((s, i) => (
            <div key={s.id} className="ruta-parada-fila">
              <span className="parada-orden" style={{ width: '2rem', height: '2rem', fontSize: '1rem' }}>{i + 1}</span>
              <span><strong>{s.nombre}</strong></span>
              <span style={{ display: 'flex', gap: '0.3rem' }}>
                <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem' }} disabled={i === 0} onClick={() => mover(i, -1)}>↑</button>
                <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem' }} disabled={i === orden.length - 1} onClick={() => mover(i, 1)}>↓</button>
                <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem' }} onClick={() => quitar(s.id)}>✕</button>
              </span>
            </div>
          ))
        )}
      </div>

      {disponibles.length > 0 && (
        <div className="card">
          <div className="card-head"><strong>Sucursales fuera de la ruta</strong></div>
          <div className="dist-suc-mini">
            {disponibles.map((s) => (
              <button key={s.id} className="chip chip--info" style={{ cursor: 'pointer', border: 0 }} onClick={() => agregar(s)}>+ {s.nombre}</button>
            ))}
          </div>
        </div>
      )}

      <div className="action-bar">
        <button className="btn btn-primary" disabled={busy} onClick={() => void guardar()}>Guardar ruta</button>
      </div>
    </>
  );
}
