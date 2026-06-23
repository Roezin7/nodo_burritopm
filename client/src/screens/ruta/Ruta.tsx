import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { ParadaChip, FlujoStepper, paradaLabel } from '../../flujo';

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

export default function Ruta() {
  const [rutas, setRutas] = useState<RutaDetalle[]>([]);
  const [parada, setParada] = useState<{ ruta: RutaDetalle; parada: Parada } | null>(null);
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

  if (parada) {
    return (
      <ParadaView
        ruta={parada.ruta}
        parada={parada.parada}
        onSalir={() => setParada(null)}
        onHecho={async () => { setParada(null); await cargar(); }}
      />
    );
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div><h1>Mi ruta</h1><p className="page-sub">Entrega parada por parada. Toca una parada para empezar.</p></div>
      </header>
      <FlujoStepper activo="ruta" />
      {error && <p className="error-msg">{error}</p>}

      {cargando ? (
        <p className="muted">Cargando…</p>
      ) : rutas.length === 0 ? (
        <div className="card"><p className="muted">No tienes rutas asignadas por ahora. Aparecerán aquí cuando el camión salga de bodega.</p></div>
      ) : (
        rutas.map((r) => <RutaCard key={r.ruta_id} ruta={r} onAbrir={(p) => setParada({ ruta: r, parada: p })} />)
      )}
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
