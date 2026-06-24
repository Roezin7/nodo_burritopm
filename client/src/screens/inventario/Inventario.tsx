import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth, type UbicacionAsignada } from '../../auth';
import { FlujoStepper } from '../../flujo';
import UbicacionPicker, { type OpcionUbic } from '../../components/UbicacionPicker';

interface InventarioResumen {
  id: number;
  estado: string;
  fecha: string | null;
  creado_at: string;
  cerrado_at: string | null;
  total_lineas: number;
  contadas: number;
}
interface Sesion {
  fecha: string;
  programado: boolean;
  dias: number[];
  proximo: string | null;
  conteo: { id: number; estado: string; total_lineas: number; contadas: number } | null;
}

/** 'YYYY-MM-DD' → "sáb, 22 jun" (zona del negocio, sin desfase). */
function fechaLarga(iso: string | null): string {
  if (!iso) return 'Inventario';
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'America/Chicago',
  });
}
interface LineaInventario {
  product_id: number;
  nombre: string;
  sku: string;
  categoria: string | null;
  unidad: string;
  qty: number;
  contado: boolean;
  atipico: boolean;
  comentario: string | null;
  stock_objetivo: number;
}
interface InventarioDetalle {
  id: number;
  estado: string;
  editable: boolean;
  fecha: string | null;
  ubicacion: { id: number; nombre: string; tipo: string };
  creado_at: string;
  cerrado_at: string | null;
  lineas: LineaInventario[];
}

export default function Inventario() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';

  const [ubicaciones, setUbicaciones] = useState<UbicacionAsignada[]>([]);
  const [ubicId, setUbicId] = useState<string>('');
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [inventarios, setInventarios] = useState<InventarioResumen[]>([]);
  const [detalle, setDetalle] = useState<InventarioDetalle | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);

  // Cargar ubicaciones disponibles según rol.
  useEffect(() => {
    async function cargarUbic() {
      try {
        if (esAdmin) {
          const us = await api<{ id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }[]>('/ubicaciones');
          const activas = us.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, activo: u.activo }));
          setUbicaciones(activas);
          if (activas[0]) setUbicId(String(activas[0].id));
        } else {
          const asignadas = usuario?.ubicaciones ?? [];
          setUbicaciones(asignadas);
          if (asignadas[0]) setUbicId(String(asignadas[0].id));
        }
      } catch {
        setError('No se pudieron cargar las ubicaciones');
      } finally {
        setCargando(false);
      }
    }
    void cargarUbic();
  }, [esAdmin, usuario]);

  async function cargarUbicacion(uid: string) {
    if (!uid) return;
    setError('');
    try {
      const [ses, lista] = await Promise.all([
        api<Sesion>(`/conteos/sesion?ubicacion=${uid}`),
        api<InventarioResumen[]>(`/conteos?ubicacion=${uid}`),
      ]);
      setSesion(ses);
      setInventarios(lista);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al cargar el inventario');
    }
  }
  useEffect(() => { setDetalle(null); void cargarUbicacion(ubicId); }, [ubicId]);

  async function abrir(id: number) {
    setError('');
    try {
      setDetalle(await api<InventarioDetalle>(`/conteos/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al abrir el inventario');
    }
  }

  // Abre/continúa el inventario de hoy (se crea solo en días programados).
  async function tomarHoy() {
    setBusy(true); setError('');
    try {
      const r = await api<{ id: number }>('/conteos/abrir', { method: 'POST', body: { ubicacion_id: Number(ubicId) } });
      await abrir(r.id);
      await cargarUbicacion(ubicId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo abrir el inventario');
    } finally {
      setBusy(false);
    }
  }

  if (cargando) return <div className="page"><p className="muted">Cargando…</p></div>;

  if (detalle) {
    return <Editor detalle={detalle} onSalir={() => { setDetalle(null); void cargarUbicacion(ubicId); }} onRecargar={() => abrir(detalle.id)} />;
  }

  const opciones: OpcionUbic[] = ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo }));
  const t = q.trim().toLowerCase();
  const histFiltrado = inventarios.filter((c) => !t || fechaLarga(c.fecha).toLowerCase().includes(t) || c.estado.toLowerCase().includes(t));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inventario</h1>
          <p className="page-sub">Captura el inventario físico de tu ubicación.</p>
        </div>
      </header>
      <FlujoStepper activo="conteo" />

      {ubicaciones.length === 0 ? (
        <p className="muted">No tienes ubicaciones asignadas. Pide a un administrador que te asigne una.</p>
      ) : (
        <>
          <UbicacionPicker label="Ubicación" opciones={opciones} value={ubicId} onChange={setUbicId} />
          {error && <p className="error-msg">{error}</p>}

          {/* Tarjeta de la sesión de hoy */}
          {sesion && <HoyCard sesion={sesion} esAdmin={esAdmin} busy={busy} onTomar={() => void tomarHoy()} onAbrir={abrir} />}

          <h3 className="seccion-title">Historial de inventarios</h3>
          {inventarios.length > 8 && (
            <input className="inv-search" type="search" placeholder="Buscar por fecha…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          {histFiltrado.length === 0 ? (
            <p className="muted">{inventarios.length === 0 ? 'Aún no hay inventarios en esta ubicación.' : 'Sin coincidencias.'}</p>
          ) : (
            <div className="lista-ubicaciones">
              {histFiltrado.map((c) => (
                <button key={c.id} className="card card-click" onClick={() => void abrir(c.id)}>
                  <div className="ubic-row">
                    <div>
                      <strong className="inv-fecha-titulo">Inventario {fechaLarga(c.fecha)}</strong>{' '}
                      <EstadoChip estado={c.estado} />
                      <div className="muted">{c.contadas}/{c.total_lineas} contados</div>
                    </div>
                    <span className="muted">›</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Tarjeta de la sesión de inventario de hoy. */
function HoyCard({ sesion, esAdmin, busy, onTomar, onAbrir }: { sesion: Sesion; esAdmin: boolean; busy: boolean; onTomar: () => void; onAbrir: (id: number) => void }) {
  const c = sesion.conteo;
  const cerrado = c?.estado === 'cerrado';

  // Ya existe el inventario de hoy.
  if (c) {
    return (
      <div className={`hoy-card ${cerrado ? 'hoy-card--cerrado' : ''}`}>
        <div className="hoy-card-fecha">Inventario de hoy · {fechaLarga(sesion.fecha)}</div>
        <p className="muted" style={{ margin: '0.2rem 0 0.8rem' }}>
          {cerrado ? 'Cerrado — es la foto oficial de hoy.' : `En captura · ${c.contadas}/${c.total_lineas} contados`}
        </p>
        <button className="btn btn-primary" onClick={() => onAbrir(c.id)}>
          {cerrado ? 'Ver inventario' : 'Continuar inventario'}
        </button>
      </div>
    );
  }

  // No existe aún: se ofrece si hoy es día programado (o si es admin, que puede abrir cuando sea).
  if (sesion.programado || esAdmin) {
    return (
      <div className="hoy-card">
        <div className="hoy-card-fecha">{sesion.programado ? 'Hoy toca inventario' : 'Abrir inventario'} · {fechaLarga(sesion.fecha)}</div>
        <p className="muted" style={{ margin: '0.2rem 0 0.8rem' }}>
          {sesion.programado ? 'El espacio de hoy está habilitado.' : 'Hoy no es día programado, pero puedes abrir uno como admin.'}
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={onTomar}>
          Tomar inventario de hoy
        </button>
      </div>
    );
  }

  // No programado y no admin: solo informativo.
  return (
    <div className="card">
      <strong>Hoy no es día de inventario</strong>
      <p className="muted" style={{ margin: '0.3rem 0 0' }}>
        {sesion.proximo ? <>Próximo inventario: <strong className="inv-fecha-titulo">{fechaLarga(sesion.proximo)}</strong>.</> : 'Aún no hay días de inventario configurados.'}
      </p>
    </div>
  );
}

function EstadoChip({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    cerrado: 'chip chip--ok', en_captura: 'chip chip--info', borrador: 'chip', reabierto: 'chip chip--warn',
  };
  const label: Record<string, string> = {
    cerrado: 'Cerrado', en_captura: 'En captura', borrador: 'Borrador', reabierto: 'Reabierto',
  };
  return <span className={map[estado] ?? 'chip'}>{label[estado] ?? estado}</span>;
}

function Editor({ detalle, onSalir, onRecargar }: { detalle: InventarioDetalle; onSalir: () => void; onRecargar: () => void }) {
  const { usuario } = useAuth();
  const [lineas, setLineas] = useState<LineaInventario[]>(detalle.lineas);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [q, setQ] = useState('');
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  const editable = detalle.editable;

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
    if (pendientes > 0 && !window.confirm(`Quedan ${pendientes} productos sin marcar como contados. ¿Cerrar de todos modos?`)) return;
    if (!window.confirm('Al cerrar, el inventario queda como la foto oficial de esta ubicación. ¿Continuar?')) return;
    setGuardando(true); setError('');
    try {
      await api(`/conteos/${detalle.id}/lineas`, { method: 'PATCH', body: payload() });
      await api(`/conteos/${detalle.id}/cerrar`, { method: 'POST' });
      onRecargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al cerrar');
      setGuardando(false);
    }
  }

  async function reabrir() {
    if (!window.confirm('¿Reabrir este inventario para editarlo?')) return;
    try {
      await api(`/conteos/${detalle.id}/reabrir`, { method: 'POST' });
      onRecargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al reabrir');
    }
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <button className="link-btn" onClick={onSalir}>← Inventarios</button>
          <h1 className="inv-fecha-titulo">Inventario {fechaLarga(detalle.fecha)} <EstadoChip estado={detalle.estado} /></h1>
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
                  <small className="muted">{l.unidad}{l.stock_objetivo > 0 ? ` · objetivo ${l.stock_objetivo}` : ''}{l.atipico ? ' · atípico' : ''}</small>
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
        <div className="action-bar">
          <button className="btn btn-secondary" onClick={() => void guardar()} disabled={guardando}>Guardar avance</button>
          <button className="btn btn-primary" onClick={() => void cerrar()} disabled={guardando}>Cerrar inventario</button>
        </div>
      ) : (
        usuario?.rol === 'admin' && (
          <div className="action-bar">
            <button className="btn btn-ghost" onClick={() => void reabrir()}>Reabrir inventario</button>
          </div>
        )
      )}
    </div>
  );
}
