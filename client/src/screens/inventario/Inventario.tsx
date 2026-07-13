import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useAuth, type UbicacionAsignada } from '../../auth';
import { useToast, mensajeError } from '../../toast';
import { FlujoStepper } from '../../flujo';
import { Icono } from '../../icons';
import UbicacionPicker, { type OpcionUbic } from '../../components/UbicacionPicker';
import Spinner from '../../components/Spinner';

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
  const [stockKey, setStockKey] = useState(0); // fuerza recarga del stock tras una entrada/salida
  const [entradaAbierta, setEntradaAbierta] = useState(false); // panel "Registrar entrada"
  const [salidaAbierta, setSalidaAbierta] = useState(false); // panel "Registrar salida"
  const [searchParams] = useSearchParams();

  const bodega = ubicaciones.find((u) => u.tipo === 'bodega') ?? null;
  const ubicActiva = ubicaciones.find((u) => String(u.id) === ubicId) ?? null;
  // Lista de sucursales para el destino de una salida/transferencia. El admin ya trae todas las
  // ubicaciones; bodega y reparto solo tiene asignada su bodega, así que se piden aparte.
  const [sucursalesDestino, setSucursalesDestino] = useState<UbicacionAsignada[]>([]);
  const sucursales = esAdmin ? ubicaciones.filter((u) => u.tipo === 'sucursal') : sucursalesDestino;
  useEffect(() => {
    if (esAdmin) return;
    api<{ id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }[]>('/ubicaciones')
      .then((us) => setSucursalesDestino(us.filter((u) => u.activo && u.tipo === 'sucursal')))
      .catch(() => {});
  }, [esAdmin]);

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

  // Deep-link desde el Tablero del ciclo: /inventario?ubicacion=ID abre esa sucursal directo.
  useEffect(() => {
    const u = searchParams.get('ubicacion');
    if (!u) return;
    const suc = ubicaciones.find((x) => String(x.id) === u && x.tipo === 'sucursal');
    if (suc) { setModo('sucursales'); setUbicId(u); }
  }, [searchParams, ubicaciones]);

  // Si el usuario cambia de ubicación rápido, ignora respuestas de peticiones ya obsoletas
  // (si no, una respuesta lenta de la ubicación anterior podía pisar los datos de la nueva).
  const ultimaPeticion = useRef('');
  async function cargarUbicacion(uid: string) {
    if (!uid) return;
    ultimaPeticion.current = uid;
    setError('');
    try {
      const [ses, lista] = await Promise.all([
        api<Sesion>(`/conteos/sesion?ubicacion=${uid}`),
        api<InventarioResumen[]>(`/conteos?ubicacion=${uid}`),
      ]);
      if (ultimaPeticion.current !== uid) return;
      setSesion(ses);
      setInventarios(lista);
    } catch (e) {
      if (ultimaPeticion.current !== uid) return;
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

  if (cargando) return <div className="page"><Spinner /></div>;

  if (detalle) {
    return <Editor detalle={detalle} onSalir={() => { setDetalle(null); void cargarUbicacion(ubicId); }} onRecargar={() => abrir(detalle.id)} />;
  }

  const opciones: OpcionUbic[] = ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo }));
  const t = q.trim().toLowerCase();
  const histFiltrado = inventarios.filter((c) => !t || fechaLarga(c.fecha).toLowerCase().includes(t) || c.estado.toLowerCase().includes(t));

  // Solo el historial de inventarios (lista). Se reutiliza en bodega y sucursales.
  const renderHistorial = (esPedido = false) => (
    <>
      <h3 className="seccion-title">{esPedido ? 'Historial de pedidos' : 'Historial de inventarios'}</h3>
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
                  <strong className="inv-fecha-titulo">{esPedido ? 'Pedido' : 'Inventario'} {fechaLarga(c.fecha)}</strong>{' '}
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

  // Sesión de hoy + historial (sucursal/personal). `promo`=false usa el aviso discreto.
  const renderSeccion = (promo: boolean, esPedido = false) => (
    <>
      {sesion && <HoyCard sesion={sesion} esAdmin={esAdmin} esPedido={esPedido} discreto={!promo} busy={busy} onTomar={() => void tomarHoy()} onAbrir={abrir} />}
      {renderHistorial(esPedido)}
    </>
  );

  // ── Admin: bodega central (gestiona) + revisión de sucursales ──────────────
  if (esAdmin) {
    const enSucursal = modo === 'sucursales' && ubicId && bodega && ubicId !== String(bodega.id);
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
              <AccionesBodega
                busy={busy}
                entradaAbierta={entradaAbierta}
                salidaAbierta={salidaAbierta}
                onToggleEntrada={() => { setEntradaAbierta((v) => !v); setSalidaAbierta(false); }}
                onToggleSalida={() => { setSalidaAbierta((v) => !v); setEntradaAbierta(false); }}
                onTomarInventario={() => void tomarHoy()}
              />
              <AgregarEntrada
                abierto={entradaAbierta}
                onClose={() => setEntradaAbierta(false)}
                onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(String(bodega.id)); }}
              />
              <RegistrarSalida
                abierto={salidaAbierta}
                sucursales={sucursales}
                onClose={() => setSalidaAbierta(false)}
                onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(String(bodega.id)); }}
              />
              {renderHistorial()}
            </>
          ) : (
            <p className="muted">No hay una bodega central activa.</p>
          )
        ) : enSucursal ? (
          <>
            <button className="link-btn" onClick={() => setUbicId('')}>← Todas las sucursales</button>
            {renderSeccion(true, true)}
          </>
        ) : (
          <SucursalesOverview sucursales={sucursales} onElegir={setUbicId} />
        )}
      </div>
    );
  }

  // ── Bodega y reparto: gestiona su bodega (sin conteo programado, es a demanda) ──────
  const esBodegaRol = ubicActiva?.tipo === 'bodega';
  if (esBodegaRol) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Inventario</h1>
            <p className="page-sub">Registra entradas, salidas y corrige cantidades cuando haga falta.</p>
          </div>
        </header>
        <FlujoStepper activo="conteo" />
        {error && <p className="error-msg">{error}</p>}
        <StockActual key={`${ubicId}:${stockKey}`} ubicId={ubicId} nombre={ubicActiva.nombre} abiertoDefault />
        <AccionesBodega
          busy={busy}
          entradaAbierta={entradaAbierta}
          salidaAbierta={salidaAbierta}
          onToggleEntrada={() => { setEntradaAbierta((v) => !v); setSalidaAbierta(false); }}
          onToggleSalida={() => { setSalidaAbierta((v) => !v); setEntradaAbierta(false); }}
          onTomarInventario={() => void tomarHoy()}
        />
        <AgregarEntrada
          abierto={entradaAbierta}
          onClose={() => setEntradaAbierta(false)}
          onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(ubicId); }}
        />
        <RegistrarSalida
          abierto={salidaAbierta}
          sucursales={sucursales}
          onClose={() => setSalidaAbierta(false)}
          onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(ubicId); }}
        />
        {renderHistorial()}
      </div>
    );
  }

  // ── Sucursal: su propio pedido programado ───────────────────────────────────
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inventario</h1>
          <p className="page-sub">Elige cuánto producto quieres que te envíen.</p>
        </div>
      </header>
      <FlujoStepper activo="conteo" />

      {ubicaciones.length === 0 ? (
        <p className="muted">No tienes ubicaciones asignadas. Pide a un administrador que te asigne una.</p>
      ) : (
        <>
          <UbicacionPicker label="Ubicación" opciones={opciones} value={ubicId} onChange={setUbicId} />
          {error && <p className="error-msg">{error}</p>}
          {renderSeccion(true, true)}
        </>
      )}
    </div>
  );
}

/** Tarjeta de la sesión de inventario de hoy. `discreto` oculta el aviso grande de "abrir". */
function HoyCard({ sesion, esAdmin, esPedido = false, busy, onTomar, onAbrir, discreto = false }: { sesion: Sesion; esAdmin: boolean; esPedido?: boolean; busy: boolean; onTomar: () => void; onAbrir: (id: number) => void; discreto?: boolean }) {
  const c = sesion.conteo;
  const cerrado = c?.estado === 'cerrado';
  const nombre = esPedido ? 'Pedido' : 'Inventario';
  const nombreMin = nombre.toLowerCase();

  // Ya existe el inventario de hoy.
  if (c) {
    return (
      <div className={`hoy-card ${cerrado ? 'hoy-card--cerrado' : ''}`}>
        <div className="hoy-card-fecha">{nombre} de hoy · {fechaLarga(sesion.fecha)}</div>
        <p className="muted" style={{ margin: '0.2rem 0 0.8rem' }}>
          {cerrado ? (esPedido ? 'Cerrado — listo para que admin lo apruebe.' : 'Cerrado — es la foto oficial de hoy.') : `En captura · ${c.contadas}/${c.total_lineas} productos`}
        </p>
        <button className="btn btn-primary" onClick={() => onAbrir(c.id)}>
          {cerrado ? `Ver ${nombreMin}` : `Continuar ${nombreMin}`}
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
        <div className="hoy-card-fecha">{sesion.programado ? `Hoy toca ${nombreMin}` : `Abrir ${nombreMin}`} · {fechaLarga(sesion.fecha)}</div>
        <p className="muted" style={{ margin: '0.2rem 0 0.8rem' }}>
          {sesion.programado ? 'El espacio de hoy está habilitado.' : `Hoy no es día programado, pero puedes abrir ${esPedido ? 'un pedido' : 'un inventario'} como admin.`}
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={onTomar}>
          {esPedido ? 'Hacer pedido de hoy' : 'Tomar inventario de hoy'}
        </button>
      </div>
    );
  }

  // No programado y no admin: solo informativo.
  return (
    <div className="card">
      <strong>{esPedido ? 'Hoy no es día de pedido' : 'Hoy no es día de inventario'}</strong>
      <p className="muted" style={{ margin: '0.3rem 0 0' }}>
        {sesion.proximo ? <>Próximo {nombreMin}: <strong className="inv-fecha-titulo">{fechaLarga(sesion.proximo)}</strong>.</> : `Aún no hay días de ${nombreMin} configurados.`}
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

interface ProdCat { id: number; nombre: string; sku: string; unidad_distribucion: string; ultimo_costo: number | null; activo: boolean }

/** Tres acciones claras de la bodega: entrada (suma), salida (resta) y contar (conteo físico). */
function AccionesBodega({ busy, entradaAbierta, salidaAbierta, onToggleEntrada, onToggleSalida, onTomarInventario }: {
  busy: boolean; entradaAbierta: boolean; salidaAbierta: boolean;
  onToggleEntrada: () => void; onToggleSalida: () => void; onTomarInventario: () => void;
}) {
  return (
    <div className="acciones-bodega">
      <button type="button" className={`accion-tile ${entradaAbierta ? 'accion-tile--on' : ''}`} onClick={onToggleEntrada}>
        <span className="accion-ico accion-ico--in" aria-hidden="true">＋</span>
        <span className="accion-tx">
          <strong>Registrar entrada</strong>
          <small>Llegó mercancía o compra. Suma al stock.</small>
        </span>
      </button>
      <button type="button" className={`accion-tile ${salidaAbierta ? 'accion-tile--on' : ''}`} onClick={onToggleSalida}>
        <span className="accion-ico accion-ico--out" aria-hidden="true">−</span>
        <span className="accion-tx">
          <strong>Registrar salida</strong>
          <small>Salió producto fuera del reparto. Resta del stock.</small>
        </span>
      </button>
      <button type="button" className="accion-tile" disabled={busy} onClick={onTomarInventario}>
        <span className="accion-ico accion-ico--count" aria-hidden="true"><Icono name="clipboard" size={20} /></span>
        <span className="accion-tx">
          <strong>Contar inventario</strong>
          <small>Conteo físico completo para fijar las cantidades exactas.</small>
        </span>
      </button>
    </div>
  );
}

/** Panel "Registrar salida" de la bodega (retiro directo o transferencia a una sucursal). */
function RegistrarSalida({ abierto, sucursales, onClose, onHecho }: {
  abierto: boolean; sucursales: UbicacionAsignada[]; onClose: () => void; onHecho: () => void;
}) {
  const toast = useToast();
  const [productos, setProductos] = useState<ProdCat[]>([]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ProdCat | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [destino, setDestino] = useState<string>('directa');
  const [motivo, setMotivo] = useState('');
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

  function limpiar() { setSel(null); setQ(''); setCantidad(''); setMotivo(''); setDestino('directa'); }
  function cerrar() { onClose(); limpiar(); setError(''); }

  async function registrar() {
    const c = Number(cantidad);
    if (!sel || !(c > 0)) { setError('Elige producto y cantidad'); return; }
    setBusy(true); setError('');
    try {
      const r = await api<{ destino: string | null }>('/existencias/retiro', {
        method: 'POST',
        body: { product_id: sel.id, cantidad: c, destino_ubicacion_id: destino === 'directa' ? null : Number(destino), motivo: motivo.trim() || undefined },
      });
      toast.ok(`−${c} ${sel.unidad_distribucion} de ${sel.nombre}${r.destino ? ` → ${r.destino}` : ' (salida directa)'}.`);
      limpiar();
      onHecho();
    } catch (e) {
      setError(mensajeError(e, 'No se pudo registrar la salida.'));
    } finally {
      setBusy(false);
    }
  }

  if (!abierto) return null;

  return (
    <div className="card form-pro entrada-card">
      <div className="form-pro-head">
        <div className="form-pro-title">
          <strong>Registrar salida de bodega</strong>
          <small className="muted">Retiro directo o envío a una sucursal fuera del reparto</small>
        </div>
        <button className="link-btn" onClick={cerrar}>Cerrar</button>
      </div>
      {error && <p className="error-msg">{error}</p>}

      <div className="field">
        <span className="field-cap">Producto</span>
        {sel ? (
          <div className="retiro-sel">
            <span><strong>{sel.nombre}</strong> <small className="muted">{sel.unidad_distribucion} · {sel.sku}</small></span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSel(null); setQ(''); }}>Cambiar</button>
          </div>
        ) : (
          <>
            <input className="field-input" type="search" placeholder="Buscar producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
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
      </div>

      <label className="field">
        <span className="field-cap">Cantidad{sel ? ` · ${sel.unidad_distribucion}` : ''}</span>
        <input className="field-num" inputMode="decimal" value={cantidad} placeholder="0" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCantidad(e.target.value)} />
      </label>

      <div className="field">
        <span className="field-cap">¿A dónde fue?</span>
        <div className="ubic-picker-pills">
          <button type="button" className={`ubic-pill ${destino === 'directa' ? 'ubic-pill--on' : ''}`} onClick={() => setDestino('directa')}>Salida directa</button>
          {sucursales.map((s) => (
            <button type="button" key={s.id} className={`ubic-pill ${destino === String(s.id) ? 'ubic-pill--on' : ''}`} onClick={() => setDestino(String(s.id))}>{s.nombre}</button>
          ))}
        </div>
        <small className="field-hint">
          {destino === 'directa' ? 'Sale de bodega como consumo (no entra a una sucursal).' : 'Baja de bodega y sube al inventario de esa sucursal.'}
        </small>
      </div>

      <label className="field">
        <span className="field-cap">Motivo <span className="field-opt">opcional</span></span>
        <input className="field-input" value={motivo} placeholder="Ej. emergencia, merma, se acabó en turno…" onChange={(e) => setMotivo(e.target.value)} />
      </label>

      <div className="form-pro-foot">
        <button className="btn btn-primary btn-block" disabled={busy || !sel || !(Number(cantidad) > 0)} onClick={() => void registrar()}>Registrar salida</button>
      </div>
    </div>
  );
}

/** Panel "Registrar entrada" a la bodega (compra/recepción): sube stock y recalcula costo. */
function AgregarEntrada({ abierto, onClose, onHecho }: { abierto: boolean; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
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
  function cerrar() { onClose(); limpiar(); setError(''); }

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

  if (!abierto) return null;

  return (
    <div className="card form-pro entrada-card">
      <div className="form-pro-head">
        <div className="form-pro-title">
          <strong>Registrar entrada a bodega</strong>
          <small className="muted">Compra o recepción de proveedor</small>
        </div>
        <button className="link-btn" onClick={cerrar}>Cerrar</button>
      </div>
      {error && <p className="error-msg">{error}</p>}

      <div className="field">
        <span className="field-cap">Producto</span>
        {sel ? (
          <div className="retiro-sel">
            <span><strong>{sel.nombre}</strong> <small className="muted">{sel.unidad_distribucion} · {sel.sku}</small></span>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSel(null); setQ(''); }}>Cambiar</button>
          </div>
        ) : (
          <>
            <input className="field-input" type="search" placeholder="Buscar producto o SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
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
      </div>

      <div className="field-grid">
        <label className="field">
          <span className="field-cap">Cantidad{sel ? ` · ${sel.unidad_distribucion}` : ''}</span>
          <input className="field-num" inputMode="decimal" value={cantidad} placeholder="0" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCantidad(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-cap">Costo unitario <span className="field-opt">opcional</span></span>
          <input className="field-num" inputMode="decimal" value={costo} placeholder={sel?.ultimo_costo != null ? sel.ultimo_costo.toFixed(2) : '0.00'} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCosto(e.target.value)} />
          {sel?.ultimo_costo != null && (
            <small className="field-hint">Último costo: ${sel.ultimo_costo.toFixed(2)}. Si compraste a otro precio, escríbelo y se actualiza.</small>
          )}
        </label>
      </div>

      <div className="form-pro-foot">
        <button className="btn btn-primary btn-block" disabled={busy || !sel || !(Number(cantidad) > 0)} onClick={() => void registrar()}>Registrar entrada</button>
        <p className="muted">Para fijar cantidades exactas usa <strong>Tomar inventario</strong> (concilia el stock).</p>
      </div>
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
