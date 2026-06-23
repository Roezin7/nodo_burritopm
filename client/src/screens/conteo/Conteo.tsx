import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth, type UbicacionAsignada } from '../../auth';
import { FlujoStepper } from '../../flujo';

interface ConteoResumen {
  id: number;
  estado: string;
  creado_at: string;
  cerrado_at: string | null;
  total_lineas: number;
  contadas: number;
}
interface LineaConteo {
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
interface ConteoDetalle {
  id: number;
  estado: string;
  editable: boolean;
  ubicacion: { id: number; nombre: string; tipo: string };
  creado_at: string;
  cerrado_at: string | null;
  lineas: LineaConteo[];
}

export default function Conteo() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';

  const [ubicaciones, setUbicaciones] = useState<UbicacionAsignada[]>([]);
  const [ubicId, setUbicId] = useState<string>('');
  const [conteos, setConteos] = useState<ConteoResumen[]>([]);
  const [detalle, setDetalle] = useState<ConteoDetalle | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

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

  async function cargarConteos(uid: string) {
    if (!uid) return;
    try {
      setConteos(await api<ConteoResumen[]>(`/conteos?ubicacion=${uid}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al cargar conteos');
    }
  }
  useEffect(() => { setDetalle(null); void cargarConteos(ubicId); }, [ubicId]);

  async function abrir(id: number) {
    setError('');
    try {
      setDetalle(await api<ConteoDetalle>(`/conteos/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al abrir el conteo');
    }
  }

  async function iniciar() {
    setError('');
    try {
      const r = await api<{ id: number }>('/conteos', { method: 'POST', body: { ubicacion_id: Number(ubicId) } });
      await abrir(r.id);
      await cargarConteos(ubicId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo iniciar el conteo');
    }
  }

  if (cargando) return <div className="page"><p className="muted">Cargando…</p></div>;

  if (detalle) {
    return <Editor detalle={detalle} onSalir={() => { setDetalle(null); void cargarConteos(ubicId); }} onRecargar={() => abrir(detalle.id)} />;
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Conteo físico</h1>
          <p className="page-sub">Captura el inventario de tu ubicación.</p>
        </div>
      </header>
      <FlujoStepper activo="conteo" />

      {ubicaciones.length === 0 ? (
        <p className="muted">No tienes ubicaciones asignadas. Pide a un administrador que te asigne una.</p>
      ) : (
        <>
          {ubicaciones.length > 1 && (
            <label className="so-ubic">
              Ubicación
              <select value={ubicId} onChange={(e) => setUbicId(e.target.value)}>
                {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </label>
          )}
          {error && <p className="error-msg">{error}</p>}

          <button className="btn btn-primary btn-grande" onClick={() => void iniciar()}>
            + Iniciar / continuar conteo
          </button>

          <h3 className="seccion-title">Conteos recientes</h3>
          {conteos.length === 0 ? (
            <p className="muted">Aún no hay conteos en esta ubicación.</p>
          ) : (
            <div className="lista-ubicaciones">
              {conteos.map((c) => (
                <button key={c.id} className="card card-click" onClick={() => void abrir(c.id)}>
                  <div className="ubic-row">
                    <div>
                      <strong>Conteo #{c.id}</strong>{' '}
                      <EstadoChip estado={c.estado} />
                      <div className="muted">
                        {new Date(c.creado_at).toLocaleString('es-MX', { timeZone: 'America/Chicago' })}
                        {' · '}{c.contadas}/{c.total_lineas} contados
                      </div>
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

function EstadoChip({ estado }: { estado: string }) {
  const map: Record<string, string> = {
    cerrado: 'chip chip--ok', en_captura: 'chip chip--info', borrador: 'chip', reabierto: 'chip chip--warn',
  };
  const label: Record<string, string> = {
    cerrado: 'Cerrado', en_captura: 'En captura', borrador: 'Borrador', reabierto: 'Reabierto',
  };
  return <span className={map[estado] ?? 'chip'}>{label[estado] ?? estado}</span>;
}

function Editor({ detalle, onSalir, onRecargar }: { detalle: ConteoDetalle; onSalir: () => void; onRecargar: () => void }) {
  const { usuario } = useAuth();
  const [lineas, setLineas] = useState<LineaConteo[]>(detalle.lineas);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const editable = detalle.editable;

  const grupos = useMemo(() => {
    const m = new Map<string, LineaConteo[]>();
    for (const l of lineas) {
      const k = l.categoria ?? 'Sin categoría';
      (m.get(k) ?? m.set(k, []).get(k)!).push(l);
    }
    return [...m.entries()];
  }, [lineas]);

  const pendientes = lineas.filter((l) => !l.contado).length;

  function set(pid: number, campo: keyof LineaConteo, valor: number | boolean) {
    setLineas((prev) => prev.map((l) => (l.product_id === pid ? { ...l, [campo]: valor } : l)));
    setOk('');
  }

  async function guardar() {
    setGuardando(true); setError(''); setOk('');
    try {
      await api(`/conteos/${detalle.id}/lineas`, {
        method: 'PATCH',
        body: { lineas: lineas.map((l) => ({ product_id: l.product_id, qty: l.qty, contado: l.contado })) },
      });
      setOk('Avance guardado');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function cerrar() {
    if (pendientes > 0 && !window.confirm(`Quedan ${pendientes} productos sin marcar como contados. ¿Cerrar de todos modos?`)) return;
    if (!window.confirm('Al cerrar, el conteo queda como inventario oficial de esta ubicación. ¿Continuar?')) return;
    setGuardando(true); setError('');
    try {
      await api(`/conteos/${detalle.id}/lineas`, {
        method: 'PATCH',
        body: { lineas: lineas.map((l) => ({ product_id: l.product_id, qty: l.qty, contado: l.contado })) },
      });
      await api(`/conteos/${detalle.id}/cerrar`, { method: 'POST' });
      onRecargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al cerrar');
      setGuardando(false);
    }
  }

  async function reabrir() {
    if (!window.confirm('¿Reabrir este conteo para editarlo?')) return;
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
          <button className="link-btn" onClick={onSalir}>← Conteos</button>
          <h1>Conteo #{detalle.id} <EstadoChip estado={detalle.estado} /></h1>
          <p className="page-sub">{detalle.ubicacion.nombre}</p>
        </div>
      </header>

      {error && <p className="error-msg">{error}</p>}
      {ok && <p className="ok-msg">{ok}</p>}
      {editable && <p className="muted">Pendientes de contar: <strong>{pendientes}</strong> de {lineas.length}</p>}

      {grupos.map(([cat, items]) => (
        <div key={cat} className="conteo-grupo">
          <h3 className="seccion-title">{cat}</h3>
          {items.map((l) => (
            <div key={l.product_id} className={`conteo-row2 ${l.contado ? 'conteo-row2--ok' : ''} ${l.atipico ? 'conteo-row2--atip' : ''}`}>
              <div className="conteo-prod">
                <strong>{l.nombre}</strong>
                <small className="muted">{l.unidad}{l.stock_objetivo > 0 ? ` · objetivo ${l.stock_objetivo}` : ''}{l.atipico ? ' · ⚠️ atípico' : ''}</small>
              </div>
              <input
                className="conteo-input2"
                inputMode="decimal"
                value={l.qty}
                disabled={!editable}
                onChange={(e) => set(l.product_id, 'qty', Number(e.target.value) || 0)}
                onFocus={(e) => e.currentTarget.select()}
              />
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
      ))}

      {editable ? (
        <div className="action-bar">
          <button className="btn btn-secondary" onClick={() => void guardar()} disabled={guardando}>Guardar avance</button>
          <button className="btn btn-primary" onClick={() => void cerrar()} disabled={guardando}>Cerrar conteo</button>
        </div>
      ) : (
        usuario?.rol === 'admin' && (
          <div className="action-bar">
            <button className="btn btn-ghost" onClick={() => void reabrir()}>Reabrir conteo</button>
          </div>
        )
      )}
    </div>
  );
}
