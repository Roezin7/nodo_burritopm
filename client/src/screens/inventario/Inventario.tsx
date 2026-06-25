import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth, type UbicacionAsignada } from '../../auth';
import { useToast, mensajeError } from '../../toast';
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
  // Admin: vista central de bodega (default) o revisión de sucursales.
  const [modo, setModo] = useState<'bodega' | 'sucursales'>('bodega');
  const [stockKey, setStockKey] = useState(0); // fuerza recarga del stock tras una entrada

  const bodega = ubicaciones.find((u) => u.tipo === 'bodega') ?? null;
  const sucursales = ubicaciones.filter((u) => u.tipo === 'sucursal');

  // Cargar ubicaciones disponibles según rol. El admin entra centrado en la Bodega.
  useEffect(() => {
    async function cargarUbic() {
      try {
        if (esAdmin) {
          const us = await api<{ id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }[]>('/ubicaciones');
          const activas = us.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, activo: u.activo }));
          setUbicaciones(activas);
          const bod = activas.find((u) => u.tipo === 'bodega');
          setUbicId(String((bod ?? activas[0])?.id ?? ''));
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

  // Bloque reutilizable: sesión de hoy + historial. `promo`=false oculta el aviso de "abrir
  // inventario" (lo usamos en la bodega central, donde estorba).
  const renderSeccion = (promo: boolean) => (
    <>
      {sesion && <HoyCard sesion={sesion} esAdmin={esAdmin} discreto={!promo} busy={busy} onTomar={() => void tomarHoy()} onAbrir={abrir} />}
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
  );

  // ── Admin: bodega central (gestiona) + revisión de sucursales ──────────────
  if (esAdmin) {
    const enSucursal = modo === 'sucursales' && ubicId && bodega && ubicId !== String(bodega.id);
    const nombreActivo = ubicaciones.find((u) => String(u.id) === ubicId)?.nombre ?? '';
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Inventario</h1>
            <p className="page-sub">Gestiona el inventario de la bodega central y revisa el de cada sucursal.</p>
          </div>
        </header>
        <FlujoStepper activo="conteo" />

        <div className="tabs">
          <button className={modo === 'bodega' ? 'tab tab--on' : 'tab'} onClick={() => { setModo('bodega'); if (bodega) setUbicId(String(bodega.id)); }}>Bodega central</button>
          <button className={modo === 'sucursales' ? 'tab tab--on' : 'tab'} onClick={() => { setModo('sucursales'); setUbicId(''); }}>Sucursales</button>
        </div>
        {error && <p className="error-msg">{error}</p>}

        {modo === 'bodega' ? (
          bodega ? (
            <>
              <StockActual key={`${bodega.id}:${stockKey}`} ubicId={String(bodega.id)} nombre={bodega.nombre} abiertoDefault />
              <AgregarEntrada onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(String(bodega.id)); }} />
              {renderSeccion(false)}
            </>
          ) : (
            <p className="muted">No hay una bodega central activa.</p>
          )
        ) : enSucursal ? (
          <>
            <button className="link-btn" onClick={() => setUbicId('')}>← Todas las sucursales</button>
            <StockActual key={`${ubicId}:${stockKey}`} ubicId={ubicId} nombre={nombreActivo} />
            {renderSeccion(true)}
          </>
        ) : (
          <SucursalesOverview sucursales={sucursales} onElegir={setUbicId} />
        )}
      </div>
    );
  }

  // ── Sucursal / bodega-reparto: su propia ubicación ─────────────────────────
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
          {ubicId && <StockActual key={ubicId} ubicId={ubicId} nombre={ubicaciones.find((u) => String(u.id) === ubicId)?.nombre ?? ''} />}
          {renderSeccion(true)}
        </>
      )}
    </div>
  );
}

/** Tarjeta de la sesión de inventario de hoy. `discreto` oculta el aviso grande de "abrir". */
function HoyCard({ sesion, esAdmin, busy, onTomar, onAbrir, discreto = false }: { sesion: Sesion; esAdmin: boolean; busy: boolean; onTomar: () => void; onAbrir: (id: number) => void; discreto?: boolean }) {
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

  // Modo discreto (bodega central): sin el aviso grande de "abrir"; solo un botón pequeño.
  if (discreto) {
    return (
      <button className="btn btn-secondary btn-sm btn-conciliar" disabled={busy} onClick={onTomar}>
        Tomar inventario para corregir cantidades
      </button>
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

const usd = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface ExistItem { product_id: number; nombre: string; unidad: string; disponible: number; costo_promedio: number | null; valor: number }
interface ExistResp { items: ExistItem[]; valor_total: number }

/** Valor del inventario y stock actual de la ubicación (en vivo, desde existencias). Compacto. */
function StockActual({ ubicId, nombre, abiertoDefault = false }: { ubicId: string; nombre: string; abiertoDefault?: boolean }) {
  const [data, setData] = useState<ExistResp | null>(null);
  const [abierto, setAbierto] = useState(abiertoDefault);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    setData(null); setError('');
    api<ExistResp>(`/existencias?ubicacion=${ubicId}`)
      .then((r) => { if (vivo) setData(r); })
      .catch(() => { if (vivo) setError('No se pudo cargar el inventario actual'); });
    return () => { vivo = false; };
  }, [ubicId]);

  if (error) return null;
  const conStock = data?.items.filter((i) => i.disponible > 0) ?? [];
  const t = q.trim().toLowerCase();
  const vis = conStock.filter((i) => !t || i.nombre.toLowerCase().includes(t));

  return (
    <div className="stock-card2">
      <button type="button" className="stock-card2-head" onClick={() => setAbierto((v) => !v)}>
        <span className="stock-card2-meta">
          <span className="stock-card2-name">{nombre}</span>
          <span className="muted">{conStock.length} con stock</span>
        </span>
        <span className="stock-card2-right">
          <span className="stock-card2-valor">{data ? usd(data.valor_total) : '—'}</span>
          <span className={`stock-card2-caret ${abierto ? 'is-open' : ''}`}>▾</span>
        </span>
      </button>
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

interface ValuacionResp { ubicaciones: { id: number; nombre: string; tipo: string; skus: number; valor: number }[]; valor_total: number }

/** Lista compacta de sucursales con su dinero en inventario; tocar una abre su detalle. */
function SucursalesOverview({ sucursales, onElegir }: { sucursales: UbicacionAsignada[]; onElegir: (id: string) => void }) {
  const [val, setVal] = useState<ValuacionResp | null>(null);
  useEffect(() => { api<ValuacionResp>('/existencias/valuacion').then(setVal).catch(() => {}); }, []);
  const valorDe = new Map((val?.ubicaciones ?? []).map((u) => [u.id, u]));
  const lista = [...sucursales].sort((a, b) => (valorDe.get(b.id)?.valor ?? 0) - (valorDe.get(a.id)?.valor ?? 0));

  return (
    <div className="lista-ubicaciones">
      {lista.length === 0 ? (
        <p className="muted">No hay sucursales activas.</p>
      ) : (
        lista.map((s) => {
          const v = valorDe.get(s.id);
          return (
            <button key={s.id} className="card card-click suc-row" onClick={() => onElegir(String(s.id))}>
              <span className="suc-row-name"><strong>{s.nombre}</strong>{v && <small className="muted"> · {v.skus} prod.</small>}</span>
              <span className="suc-row-val">{v ? usd(v.valor) : '—'}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

interface ProdCat { id: number; nombre: string; sku: string; unidad_distribucion: string; activo: boolean }

/** Agregar entrada a la bodega central (compra/recepción): sube stock y recalcula costo. */
function AgregarEntrada({ onHecho }: { onHecho: () => void }) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [productos, setProductos] = useState<ProdCat[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ProdCat | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!abierto || productos.length) return;
    api<ProdCat[]>('/catalogo/productos').then((ps) => setProductos(ps.filter((p) => p.activo))).catch(() => {});
  }, [abierto, productos.length]);

  const resultados = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return productos.filter((p) => p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 8);
  }, [q, productos]);

  function limpiar() { setSel(null); setQ(''); setCantidad(''); setCosto(''); }

  async function registrar() {
    const c = Number(cantidad);
    if (!sel || !(c > 0)) { setError('Elige producto y cantidad'); return; }
    setBusy(true); setError('');
    try {
      await api('/existencias/ingreso', { method: 'POST', body: { product_id: sel.id, cantidad: c, costo_unitario: costo ? Number(costo) : null } });
      toast.ok(`+${c} ${sel.unidad_distribucion} de ${sel.nombre} a bodega.`);
      limpiar();
      onHecho();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo registrar la entrada.'));
    } finally {
      setBusy(false);
    }
  }

  if (!abierto) {
    return <button type="button" className="btn btn-secondary btn-entrada" onClick={() => setAbierto(true)}>+ Agregar entrada a bodega</button>;
  }

  return (
    <div className="card entrada-card">
      <div className="card-head"><strong>Agregar entrada a bodega</strong><button className="link-btn" onClick={() => { setAbierto(false); limpiar(); setError(''); }}>Cerrar</button></div>
      {error && <p className="error-msg">{error}</p>}
      {sel ? (
        <div className="retiro-sel">
          <span><strong>{sel.nombre}</strong> <small className="muted">{sel.unidad_distribucion} · {sel.sku}</small></span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSel(null); setQ(''); }}>Cambiar</button>
        </div>
      ) : (
        <>
          <input className="inv-search" type="search" placeholder="Buscar producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
          {resultados.length > 0 && (
            <div className="retiro-resultados">
              {resultados.map((p) => (
                <button key={p.id} className="retiro-resultado" onClick={() => { setSel(p); setQ(''); }}>
                  <strong>{p.nombre}</strong> <small className="muted">{p.unidad_distribucion} · {p.sku}</small>
                </button>
              ))}
            </div>
          )}
          {q.trim() && resultados.length === 0 && <p className="muted">Sin coincidencias.</p>}
        </>
      )}
      <div className="entrada-campos">
        <label className="retiro-label">Cantidad{sel ? ` (${sel.unidad_distribucion})` : ''}
          <input className="conteo-input2" inputMode="decimal" value={cantidad} placeholder="0" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCantidad(e.target.value)} />
        </label>
        <label className="retiro-label">Costo unitario (opcional)
          <input className="conteo-input2" inputMode="decimal" value={costo} placeholder="0.00" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCosto(e.target.value)} />
        </label>
      </div>
      <div className="form-actions" style={{ marginTop: '0.7rem' }}>
        <button className="btn btn-primary" disabled={busy || !sel || !(Number(cantidad) > 0)} onClick={() => void registrar()}>Registrar entrada</button>
      </div>
      <p className="muted" style={{ marginTop: '0.4rem' }}>Para corregir cantidades exactas usa <strong>Tomar/continuar inventario</strong> (concilia el stock).</p>
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
  const toast = useToast();
  const [lineas, setLineas] = useState<LineaInventario[]>(detalle.lineas);
  const [guardando, setGuardando] = useState(false);
  const [armado, setArmado] = useState(false); // confirmar cierre en 2 toques (sin diálogo)
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [q, setQ] = useState('');
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set());
  const editable = detalle.editable;
  const esAdmin = usuario?.rol === 'admin';

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
      toast.ok('Inventario cerrado.', esAdmin ? { label: 'Deshacer', onClick: () => void reabrir() } : undefined);
      onRecargar();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo cerrar el inventario. Reintenta.'));
      setGuardando(false);
    }
  }

  async function reabrir() {
    try {
      await api(`/conteos/${detalle.id}/reabrir`, { method: 'POST' });
      toast.ok('Inventario reabierto.');
      onRecargar();
    } catch (e) {
      toast.error(mensajeError(e, 'No se pudo reabrir.'));
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
        <div className="action-bar action-bar--col">
          {armado && <p className="armar-aviso">Queda como la foto oficial de hoy{pendientes > 0 ? ` · ${pendientes} sin contar` : ''}. Toca de nuevo para confirmar.</p>}
          <div className="action-bar-row">
            <button className="btn btn-secondary" onClick={() => void guardar()} disabled={guardando}>Guardar avance</button>
            {armado ? (
              <button className="btn btn-primary" onClick={() => void cerrar()} disabled={guardando}>Confirmar cierre</button>
            ) : (
              <button className="btn btn-primary" onClick={() => { setArmado(true); setTimeout(() => setArmado(false), 5000); }} disabled={guardando}>Cerrar inventario</button>
            )}
          </div>
        </div>
      ) : (
        esAdmin && (
          <div className="action-bar">
            <button className="btn btn-ghost" onClick={() => void reabrir()}>Reabrir inventario</button>
          </div>
        )
      )}
    </div>
  );
}
