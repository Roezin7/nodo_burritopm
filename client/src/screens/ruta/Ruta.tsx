import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { Icono } from '../../icons';
import { ParadaChip, FlujoStepper, paradaLabel } from '../../flujo';
import BodegaRutaTabs from '../../components/BodegaRutaTabs';

interface ParadaItem {
  linea_id: number;
  product_id: number;
  nombre: string;
  unidad: string;
  esperado: number;
  recibida: number | null;
}
interface Parada {
  parada_id: number;
  ubicacion: { id: number; nombre: string; direccion: string | null };
  orden: number;
  estado: string;
  entregada_at: string | null;
  confirmada_at: string | null;
  notas: string | null;
  items: ParadaItem[];
}
interface RutaDetalle {
  ruta_id: number;
  distribucion_id: number;
  nombre: string | null;
  estado: string;
  repartidor: { id: number; nombre: string } | null;
  despachada_at: string | null;
  paradas: Parada[];
}

const cerrada = (e: string) => ['entregada', 'confirmada', 'con_incidencia', 'omitida'].includes(e);
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-MX', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' }) : '');

export default function Ruta() {
  const { usuario } = useAuth();
  if (usuario?.rol === 'admin') return <MonitorRutas />;
  return <RutaRepartidor />;
}

function RutaRepartidor() {
  const [rutas, setRutas] = useState<RutaDetalle[]>([]);
  const [historial, setHistorial] = useState<RutaDetalle[]>([]);
  const [tab, setTab] = useState<'activas' | 'historial'>('activas');
  const [parada, setParada] = useState<{ ruta: RutaDetalle; parada: Parada } | null>(null);
  const [exito, setExito] = useState<string | null>(null); // overlay de "entregado"
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setCargando(true);
    try {
      const r = (await api<(RutaDetalle | null)[]>('/rutas/mias')).filter((x): x is RutaDetalle => x != null);
      setRutas(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar tus rutas');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); }, []);
  useEffect(() => {
    if (tab !== 'historial' || historial.length) return;
    api<(RutaDetalle | null)[]>('/rutas/historial').then((r) => setHistorial(r.filter((x): x is RutaDetalle => x != null))).catch(() => {});
  }, [tab, historial.length]);

  // Celebración breve tras entregar, luego de vuelta a la lista.
  function celebrar(nombre: string) {
    setExito(nombre);
    setTimeout(() => setExito(null), 1100);
  }

  if (parada) {
    return (
      <>
        {exito && <ExitoOverlay nombre={exito} />}
        <ParadaView
          ruta={parada.ruta}
          parada={parada.parada}
          onSalir={() => setParada(null)}
          onHecho={async () => { const n = parada.parada.ubicacion.nombre; setParada(null); celebrar(n); await cargar(); }}
        />
      </>
    );
  }

  const totalParadas = rutas.reduce((a, r) => a + r.paradas.length, 0);
  const hechasTotal = rutas.reduce((a, r) => a + r.paradas.filter((p) => cerrada(p.estado)).length, 0);

  return (
    <div className="page conteo-page ruta-page">
      {exito && <ExitoOverlay nombre={exito} />}
      <header className="page-head">
        <div><h1>Bodega y reparto</h1><p className="page-sub">Entrega parada por parada. Toca la parada activa para empezar.</p></div>
      </header>
      <FlujoStepper activo="ruta" />
      <BodegaRutaTabs activo="reparto" />
      {error && <p className="error-msg">{error}</p>}

      <div className="tabs">
        <button className={tab === 'activas' ? 'tab tab--on' : 'tab'} onClick={() => setTab('activas')}>Hoy{rutas.length ? ` · ${hechasTotal}/${totalParadas}` : ''}</button>
        <button className={tab === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setTab('historial')}>Historial</button>
      </div>

      {tab === 'activas' ? (
        cargando ? (
          <p className="muted">Cargando…</p>
        ) : rutas.length === 0 ? (
          <div className="card"><p className="muted">No tienes rutas asignadas por ahora. Aparecerán aquí cuando el camión salga de bodega.</p></div>
        ) : (
          rutas.map((r) => <RutaCard key={r.ruta_id} ruta={r} onAbrir={(p) => setParada({ ruta: r, parada: p })} />)
        )
      ) : historial.length === 0 ? (
        <div className="card"><p className="muted">Aún no hay rutas completadas.</p></div>
      ) : (
        historial.map((r) => <HistorialRutaCard key={r.ruta_id} ruta={r} />)
      )}
    </div>
  );
}

/** Overlay de éxito tras entregar: check animado a pantalla completa. */
function ExitoOverlay({ nombre }: { nombre: string }) {
  return (
    <div className="exito-overlay" role="status" aria-live="polite">
      <div className="exito-check">
        <svg viewBox="0 0 52 52" className="exito-svg"><circle cx="26" cy="26" r="24" className="exito-circ" /><path d="M14 27 l8 8 l16 -18" className="exito-tick" /></svg>
      </div>
      <strong className="exito-texto">¡Entregado!</strong>
      <span className="exito-sub">{nombre}</span>
    </div>
  );
}

/** Tarjeta de una ruta ya completada (solo lectura). */
function HistorialRutaCard({ ruta }: { ruta: RutaDetalle }) {
  const paradas = [...ruta.paradas].sort((a, b) => a.orden - b.orden);
  return (
    <div className="card monitor-ruta">
      <div className="card-head">
        <strong>{ruta.nombre ?? `Ruta #${ruta.ruta_id}`}</strong>
        <span className="muted">{ruta.despachada_at ? new Date(ruta.despachada_at).toLocaleDateString('es-MX', { timeZone: 'America/Chicago', day: '2-digit', month: 'short' }) : ''}</span>
      </div>
      <div className="ruta-tablero">
        {paradas.map((p) => (
          <div key={p.parada_id} className="ruta-parada-fila">
            <span className={`ruta-dot ruta-dot--${p.estado}`} />
            <span><strong>{p.orden}. {p.ubicacion.nombre}</strong>{p.confirmada_at && <small className="muted"> · {hora(p.confirmada_at)}</small>}</span>
            <ParadaChip estado={p.estado} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RutaCard({ ruta, onAbrir }: { ruta: RutaDetalle; onAbrir: (p: Parada) => void }) {
  const total = ruta.paradas.length;
  const hechas = ruta.paradas.filter((p) => cerrada(p.estado)).length;
  const actual = ruta.paradas.find((p) => !cerrada(p.estado)) ?? null;
  const pct = total ? Math.round((hechas / total) * 100) : 0;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div className="ruta-progreso">
        <span className="ruta-progreso-num">{hechas}/{total} entregadas</span>
        <div className="ruta-progreso-barra"><div className="ruta-progreso-fill" style={{ width: `${pct}%` }} /></div>
      </div>

      {ruta.paradas.map((p) => {
        const esActual = actual?.parada_id === p.parada_id;
        const bloqueada = !esActual && !cerrada(p.estado); // aún no le toca
        return (
          <button
            key={p.parada_id}
            className={`parada-card ${esActual ? 'parada-card--actual' : ''} ${cerrada(p.estado) ? 'parada-card--cerrada' : ''}`}
            onClick={() => onAbrir(p)}
            disabled={bloqueada}
            style={bloqueada ? { opacity: 0.55, cursor: 'default' } : undefined}
          >
            <span className="parada-orden">{cerrada(p.estado) ? '✓' : p.orden}</span>
            <span className="parada-info">
              <strong>{p.ubicacion.nombre}</strong>
              <small>{p.ubicacion.direccion || `${p.items.length} productos`}</small>
            </span>
            <ParadaChip estado={p.estado} />
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────── Vista de una parada ─────────────────────────────
function ParadaView({ ruta, parada, onSalir, onHecho }: { ruta: RutaDetalle; parada: Parada; onSalir: () => void; onHecho: () => void }) {
  const [modoProblema, setModoProblema] = useState(false);
  const [entregado, setEntregado] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const yaCerrada = cerrada(parada.estado);

  async function entregar(items?: { linea_id: number; cantidad: number }[]) {
    setBusy(true); setError('');
    try {
      await api(`/rutas/${ruta.ruta_id}/paradas/${parada.parada_id}/entregar`, {
        method: 'POST',
        body: items ? { items } : {},
      });
      onHecho();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo registrar la entrega');
      setBusy(false);
    }
  }

  function confirmarProblema() {
    const items = parada.items.map((it) => ({
      linea_id: it.linea_id,
      cantidad: Number(entregado[it.linea_id] ?? it.esperado) || 0,
    }));
    void entregar(items);
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div>
          <button className="link-btn" onClick={onSalir}>← Mi ruta</button>
          <h1>Parada {parada.orden}: {parada.ubicacion.nombre} <ParadaChip estado={parada.estado} /></h1>
          {parada.ubicacion.direccion && <p className="page-sub">{parada.ubicacion.direccion}</p>}
        </div>
      </header>

      <a
        className="btn btn-secondary btn-maps"
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parada.ubicacion.direccion || parada.ubicacion.nombre)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Icono name="pin" size={18} /> Abrir en Maps
      </a>

      {error && <p className="error-msg">{error}</p>}

      <div className="card">
        <div className="parada-items">
          {parada.items.map((it) => (
            <div key={it.linea_id} className="parada-item">
              <span><strong>{it.nombre}</strong> <small className="muted">{it.unidad}</small></span>
              {modoProblema ? (
                <input
                  className="conteo-input2 dist-input"
                  inputMode="decimal"
                  value={entregado[it.linea_id] ?? String(it.esperado)}
                  onChange={(e) => setEntregado({ ...entregado, [it.linea_id]: e.target.value })}
                />
              ) : (
                <span className="parada-item-qty">{it.esperado}</span>
              )}
            </div>
          ))}
        </div>

        {yaCerrada ? (
          <p className="muted">Esta parada ya está {paradaLabel(parada.estado).toLowerCase()}.</p>
        ) : modoProblema ? (
          <>
            <p className="muted">Ajusta lo que realmente entregaste. Las diferencias generan una incidencia.</p>
            <button className="btn btn-primary btn-entregar" disabled={busy} onClick={confirmarProblema}>
              Confirmar entrega con ajuste
            </button>
            <button className="btn-problema" onClick={() => { setModoProblema(false); setEntregado({}); }} style={{ color: 'var(--ink-2)', background: 'var(--surface-2)' }}>
              Cancelar
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-entregar" disabled={busy} onClick={() => void entregar()}>
              ✓ ENTREGADO
            </button>
            <button className="btn-problema" onClick={() => setModoProblema(true)} disabled={busy}>
              Hubo un problema
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────── Monitor del admin (rutas activas en vivo) ─────────────
function MonitorRutas() {
  const [rutas, setRutas] = useState<RutaDetalle[]>([]);
  const [historial, setHistorial] = useState<RutaDetalle[]>([]);
  const [tab, setTab] = useState<'activas' | 'historial'>('activas');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [actualizado, setActualizado] = useState<Date | null>(null);
  const primera = useRef(true);

  async function cargar() {
    try {
      const r = (await api<(RutaDetalle | null)[]>('/rutas/activas')).filter((x): x is RutaDetalle => x != null);
      setRutas(r);
      setActualizado(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las rutas');
    } finally {
      if (primera.current) { setCargando(false); primera.current = false; }
    }
  }
  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), 15000); // auto-refresco cada 15 s
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (tab !== 'historial' || historial.length) return;
    api<(RutaDetalle | null)[]>('/rutas/historial').then((r) => setHistorial(r.filter((x): x is RutaDetalle => x != null))).catch(() => {});
  }, [tab, historial.length]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Bodega y reparto</h1>
          <p className="page-sub">
            En vivo: dónde va cada camión y qué sucursal sigue.
            {actualizado && <> · actualizado {hora(actualizado.toISOString())}</>}
          </p>
        </div>
      </header>
      <FlujoStepper activo="ruta" />
      <BodegaRutaTabs activo="reparto" />

      <div className="tabs">
        <button className={tab === 'activas' ? 'tab tab--on' : 'tab'} onClick={() => setTab('activas')}>Activas ({rutas.length})</button>
        <button className={tab === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setTab('historial')}>Historial</button>
      </div>
      {error && <p className="error-msg">{error}</p>}

      {tab === 'historial' ? (
        historial.length === 0 ? (
          <div className="card"><p className="muted">Aún no hay rutas completadas.</p></div>
        ) : (
          historial.map((r) => <MonitorRutaCard key={r.ruta_id} ruta={r} historico />)
        )
      ) : cargando ? (
        <p className="muted">Cargando…</p>
      ) : rutas.length === 0 ? (
        <div className="card"><p className="muted">No hay rutas en curso ahora mismo. Aparecerán aquí cuando un camión salga de bodega.</p></div>
      ) : (
        rutas.map((r) => <MonitorRutaCard key={r.ruta_id} ruta={r} />)
      )}
    </div>
  );
}

function MonitorRutaCard({ ruta, historico = false }: { ruta: RutaDetalle; historico?: boolean }) {
  const paradas = [...ruta.paradas].sort((a, b) => a.orden - b.orden);
  const total = paradas.length;
  const hechas = paradas.filter((p) => cerrada(p.estado)).length;
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  const actual = paradas.find((p) => !cerrada(p.estado)) ?? null;
  const ultimaEntregada = [...paradas].reverse().find((p) => p.entregada_at);
  const conIncidencia = paradas.filter((p) => p.estado === 'con_incidencia').length;

  return (
    <div className="card monitor-ruta">
      <div className="card-head">
        <strong>{ruta.nombre ?? `Ruta #${ruta.ruta_id}`}</strong>
        <span className="muted">{ruta.repartidor?.nombre ?? 'sin repartidor'}{historico && ruta.despachada_at ? ` · ${new Date(ruta.despachada_at).toLocaleDateString('es-MX', { timeZone: 'America/Chicago', day: '2-digit', month: 'short' })}` : ''}</span>
      </div>

      <div className="monitor-estado">
        {historico ? (
          <span className="monitor-actual"><span className="ruta-dot ruta-dot--confirmada" /> Completada · {total} paradas{conIncidencia > 0 ? ` · ${conIncidencia} con incidencia` : ''}</span>
        ) : actual ? (
          <span className="monitor-actual"><span className="ruta-dot ruta-dot--en_camino" /> En camino a <strong>{actual.ubicacion.nombre}</strong> (parada {actual.orden} de {total})</span>
        ) : (
          <span className="monitor-actual"><span className="ruta-dot ruta-dot--confirmada" /> Ruta completada</span>
        )}
        {ultimaEntregada && <span className="muted">Última entrega: {ultimaEntregada.ubicacion.nombre} · {hora(ultimaEntregada.entregada_at)}</span>}
      </div>

      <div className="ruta-progreso">
        <span className="ruta-progreso-num">{hechas}/{total} entregadas</span>
        <div className="ruta-progreso-barra"><div className="ruta-progreso-fill" style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="ruta-tablero">
        {paradas.map((p) => {
          const esActual = actual?.parada_id === p.parada_id;
          return (
            <div key={p.parada_id} className={`ruta-parada-fila ${esActual ? 'ruta-parada-fila--actual' : ''}`}>
              <span className={`ruta-dot ruta-dot--${esActual ? 'en_camino' : p.estado}`} />
              <span>
                <strong>{p.orden}. {p.ubicacion.nombre}</strong>
                {p.ubicacion.direccion && <small className="muted"> · {p.ubicacion.direccion}</small>}
                {(p.entregada_at || p.confirmada_at) && (
                  <small className="muted"> · {p.confirmada_at ? `confirmada ${hora(p.confirmada_at)}` : `entregada ${hora(p.entregada_at)}`}</small>
                )}
              </span>
              <ParadaChip estado={esActual && p.estado === 'pendiente' ? 'en_camino' : p.estado} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
