import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth, type UbicacionAsignada } from '../../auth';
import { EstadoDistChip, FlujoStepper } from '../../flujo';
import UbicacionPicker from '../../components/UbicacionPicker';
import { crearSemana, type SemanaSeleccionada } from '../../semana';
import { useOperacionConfig } from '../../operacion-config';

interface LineaRec {
  linea_id: number;
  product_id: number;
  nombre: string;
  unidad: string;
  esperado: number;
  recibida: number | null;
  estado_linea: string | null;
}
interface DistRec { id: number; estado: string; fecha_entrega: string | null; creado_at: string; lineas: LineaRec[] }
interface DistHist { id: number; estado: string; fecha_entrega: string | null; recibido_at: string; con_incidencia: boolean; total_lineas: number; lineas: LineaRec[] }

export default function Recepcion({ integrado = false, semana = crearSemana() }: { integrado?: boolean; semana?: SemanaSeleccionada }) {
  const { usuario } = useAuth();
  const { repartoHabilitado } = useOperacionConfig();
  const esAdmin = usuario?.rol === 'admin';
  const [ubicaciones, setUbicaciones] = useState<UbicacionAsignada[]>([]);
  const [ubicId, setUbicId] = useState('');
  const [dists, setDists] = useState<DistRec[]>([]);
  const [historial, setHistorial] = useState<DistHist[]>([]);
  const [tab, setTab] = useState<'pendientes' | 'historial'>('pendientes');
  const [recibido, setRecibido] = useState<Record<number, string>>({});
  const [problema, setProblema] = useState<Set<number>>(new Set()); // dist ids en modo "hubo un problema"
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const solicitud = useRef(0);

  useEffect(() => {
    async function cargarUbic() {
      if (esAdmin) {
        const us = await api<{ id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }[]>('/ubicaciones');
        const suc = us.filter((u) => u.activo && u.tipo === 'sucursal').map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, activo: u.activo }));
        setUbicaciones(suc);
        if (suc[0]) setUbicId(String(suc[0].id));
      } else {
        const suc = (usuario?.ubicaciones ?? []).filter((u) => u.tipo === 'sucursal');
        setUbicaciones(suc);
        if (suc[0]) setUbicId(String(suc[0].id));
      }
    }
    void cargarUbic();
  }, [esAdmin, usuario]);

  async function cargar() {
    if (!ubicId) return;
    const turno = ++solicitud.current;
    setError('');
    try { const filas = await api<DistRec[]>(`/distribuciones/recepciones?ubicacion=${ubicId}&desde=${semana.inicio}&hasta=${semana.fin}`); if (turno === solicitud.current) setDists(filas); }
    catch (e) { if (turno === solicitud.current) setError(e instanceof ApiError ? e.message : 'Error al cargar'); }
  }
  useEffect(() => { setDists([]); setHistorial([]); setTab(semana.actual ? 'pendientes' : 'historial'); void cargar(); }, [ubicId, semana.inicio, semana.fin]);
  useEffect(() => {
    if (tab !== 'historial' || !ubicId || historial.length) return;
    setCargandoHistorial(true); setError('');
    api<DistHist[]>(`/distribuciones/recepciones/historial?ubicacion=${ubicId}&desde=${semana.inicio}&hasta=${semana.fin}`)
      .then(setHistorial)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el historial de recepción.'))
      .finally(() => setCargandoHistorial(false));
  }, [tab, ubicId, historial.length, semana.inicio, semana.fin]);

  // modoProblema=false → confirma todo tal cual lo esperado (un toque). true → usa lo ajustado.
  async function recibir(d: DistRec, modoProblema: boolean) {
    setBusy(true); setError(''); setOk('');
    try {
      const items = d.lineas
        .filter((l) => l.recibida == null)
        .map((l) => ({ linea_id: l.linea_id, cantidad: modoProblema ? (Number(recibido[l.linea_id] ?? l.esperado) || 0) : l.esperado }));
      await api(`/distribuciones/${d.id}/recibir`, { method: 'POST', body: { ubicacion_id: Number(ubicId), items } });
      setRecibido({});
      setProblema((p) => { const n = new Set(p); n.delete(d.id); return n; });
      setOk('Recepción confirmada.');
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo confirmar. Reintenta; si sigue, avisa al admin.');
    } finally {
      setBusy(false);
    }
  }
  const toggleProblema = (id: number) => setProblema((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className={integrado ? 'embedded-operation conteo-page' : 'page conteo-page'}>
      {!integrado && <header className="page-head">
        <div><h1>Recepción</h1><p className="page-sub">{repartoHabilitado ? 'Confirma lo que llega del camión.' : 'Valida lo despachado o reporta faltantes.'}</p></div>
      </header>}
      {!integrado && <FlujoStepper activo="recepcion" />}
      {integrado && <header className="embedded-head"><div><span className="eyebrow">Paso {repartoHabilitado ? 7 : 6}</span><h2>Recepción</h2></div></header>}

      {ubicaciones.length === 0 ? (
        <p className="muted">No tienes una sucursal asignada.</p>
      ) : (
        <>
          <UbicacionPicker label="Sucursal" opciones={ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo }))} value={ubicId} onChange={setUbicId} />

          <div className="tabs">
            <button className={tab === 'pendientes' ? 'tab tab--on' : 'tab'} onClick={() => setTab('pendientes')}>Por recibir ({dists.length})</button>
            <button className={tab === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setTab('historial')}>Historial</button>
          </div>

          {error && <p className="error-msg">{error}</p>}
          {ok && <p className="ok-msg">{ok}</p>}

          {tab === 'historial' ? (
            cargandoHistorial ? (
              <p className="muted">Cargando recepciones…</p>
            ) : historial.length === 0 ? (
              <p className="muted">Aún no hay recepciones registradas.</p>
            ) : (
              historial.map((d) => (
                <div key={d.id} className="card">
                  <div className="card-head">
                    <strong>Pedido #{d.id}</strong>
                    <span className="muted">{d.fecha_entrega ?? new Date(d.recibido_at).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })}</span>
                  </div>
                  {d.con_incidencia && <p className="txt-danger" style={{ margin: '0 0 0.4rem' }}>Se recibió con diferencias.</p>}
                  {d.lineas.map((l) => (
                    <div key={l.linea_id} className="dist-row">
                      <div className="conteo-prod">
                        <strong>{l.nombre}</strong>
                        <small className="muted">{l.unidad} · esperado {l.esperado}</small>
                      </div>
                      <span className="dist-aprob">{l.recibida ?? '—'}</span>
                    </div>
                  ))}
                </div>
              ))
            )
          ) : dists.length === 0 ? (
            <p className="muted">No hay entregas en tránsito para esta sucursal.</p>
          ) : (
            dists.map((d) => {
              const pendiente = d.lineas.some((l) => l.recibida == null);
              const enProblema = problema.has(d.id);
              return (
                <div key={d.id} className="card">
                  <div className="card-head"><strong>Pedido #{d.id} · {d.fecha_entrega ?? 'sin fecha'}</strong> <EstadoDistChip estado={d.estado} /></div>
                  {d.lineas.map((l) => (
                    <div key={l.linea_id} className="dist-row">
                      <div className="conteo-prod">
                        <strong>{l.nombre}</strong>
                        <small className="muted">{l.unidad} · esperado {l.esperado}{l.recibida != null ? ` · recibido ${l.recibida}` : ''}</small>
                      </div>
                      {l.recibida != null ? (
                        <span className="dist-aprob">{l.recibida}</span>
                      ) : enProblema ? (
                        <input className="conteo-input2 dist-input" inputMode="decimal"
                          value={recibido[l.linea_id] ?? String(l.esperado)}
                          onChange={(e) => setRecibido({ ...recibido, [l.linea_id]: e.target.value })} />
                      ) : (
                        <span className="dist-aprob">{l.esperado}</span>
                      )}
                    </div>
                  ))}
                  {pendiente && (
                    enProblema ? (
                      <div className="form-actions">
                        <button className="btn btn-secondary" disabled={busy} onClick={() => toggleProblema(d.id)}>Cancelar</button>
                        <button className="btn btn-primary" disabled={busy} onClick={() => void recibir(d, true)}>Confirmar con ajustes</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.6rem' }}>
                        <button className="btn btn-primary btn-entregar" disabled={busy} onClick={() => void recibir(d, false)}>✓ Todo llegó bien</button>
                        <button className="btn-problema" disabled={busy} onClick={() => toggleProblema(d.id)}>Hubo un problema</button>
                      </div>
                    )
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
