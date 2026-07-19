import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth, type UbicacionAsignada } from '../../auth';
import { EstadoDistChip, FlujoStepper } from '../../flujo';
import UbicacionPicker from '../../components/UbicacionPicker';
import Spinner from '../../components/Spinner';
import { crearSemana, type SemanaSeleccionada } from '../../semana';
import { useOperacionConfig } from '../../operacion-config';
import CollapsibleSection from '../../components/CollapsibleSection';

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
interface AuditoriaRec {
  distribucion_id: number; estado_distribucion: string; fecha_entrega: string | null;
  ubicacion: { id: number; nombre: string; codigo: string; orden: number };
  estado: 'pendiente' | 'sin_faltantes' | 'con_faltantes'; total_faltante: number;
  lineas: (LineaRec & { faltante: number })[];
}

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
      if (esAdmin) { setUbicaciones([]); setUbicId(''); return; }
      const suc = (usuario?.ubicaciones ?? []).filter((u) => u.tipo === 'sucursal');
      setUbicaciones(suc);
      if (suc[0]) setUbicId(String(suc[0].id));
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

  if (esAdmin) return <AuditoriaRecepcion integrado={integrado} semana={semana} />;

  return (
    <div className={integrado ? 'embedded-operation conteo-page' : 'page conteo-page'}>
      {!integrado && <header className="page-head">
        <div><h1>Confirmar recepción</h1><p className="page-sub">{repartoHabilitado ? 'Confirma lo que llegó del camión o indica una diferencia.' : 'Confirma lo despachado o reporta faltantes.'}</p></div>
      </header>}
      {!integrado && <FlujoStepper activo="recepcion" />}
      {integrado && <header className="embedded-head"><div><span className="eyebrow">Entrega</span><h2>Confirmar recepción</h2></div></header>}

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
                <CollapsibleSection key={d.id} title={`Pedido #${d.id}`} count={`${d.lineas.length} productos`} summary={d.fecha_entrega ?? new Date(d.recibido_at).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })}>
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
                </CollapsibleSection>
              ))
            )
          ) : dists.length === 0 ? (
            <p className="muted">No hay entregas en tránsito para esta sucursal.</p>
          ) : (
            dists.map((d) => {
              const pendiente = d.lineas.some((l) => l.recibida == null);
              const enProblema = problema.has(d.id);
              return (
                <CollapsibleSection key={d.id} title={`Pedido #${d.id}`} count={`${d.lineas.length} productos`} summary={d.fecha_entrega ?? 'Sin fecha'}>
                  <div className="receipt-status"><EstadoDistChip estado={d.estado} /></div>
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
                </CollapsibleSection>
              );
            })
          )}
        </>
      )}
    </div>
  );
}

function AuditoriaRecepcion({ integrado, semana }: { integrado: boolean; semana: SemanaSeleccionada }) {
  const [registros, setRegistros] = useState<AuditoriaRec[]>([]);
  const [filtro, setFiltro] = useState<'todos' | 'sin_faltantes' | 'con_faltantes'>('todos');
  const [buscar, setBuscar] = useState('');
  const [editando, setEditando] = useState('');
  const [faltantes, setFaltantes] = useState<Record<number, string>>({});
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function cargarAuditoria() {
    setCargando(true); setError('');
    try { setRegistros(await api<AuditoriaRec[]>(`/distribuciones/recepciones/auditoria?desde=${semana.inicio}&hasta=${semana.fin}`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo cargar la auditoría de recepción.'); }
    finally { setCargando(false); }
  }
  useEffect(() => { setEditando(''); setFaltantes({}); setOk(''); void cargarAuditoria(); }, [semana.inicio, semana.fin]);

  function abrir(registro: AuditoriaRec) {
    setEditando(`${registro.distribucion_id}:${registro.ubicacion.id}`);
    setFaltantes(Object.fromEntries(registro.lineas.map((linea) => [linea.linea_id, linea.faltante > 0 ? String(linea.faltante) : ''])));
    setError(''); setOk('');
  }
  async function guardar(registro: AuditoriaRec) {
    const items = registro.lineas.map((linea) => ({ linea_id: linea.linea_id, cantidad: Number(faltantes[linea.linea_id] || 0) }));
    const hayFaltantes = items.some((item) => item.cantidad > 0);
    if (!hayFaltantes && registro.estado !== 'con_faltantes') {
      setError('Captura al menos un faltante. Si todo llegó bien, no necesitas auditar esta entrega.');
      return;
    }
    setBusy(true); setError(''); setOk('');
    try {
      await api(`/distribuciones/recepciones/${registro.distribucion_id}/auditar`, {
        method: 'POST', body: { ubicacion_id: registro.ubicacion.id, faltantes: items },
      });
      setEditando(''); setFaltantes({}); setOk(hayFaltantes ? `Faltantes registrados para ${registro.ubicacion.nombre}.` : `Se eliminó el reporte de faltantes de ${registro.ubicacion.nombre}.`);
      await cargarAuditoria();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la auditoría.'); }
    finally { setBusy(false); }
  }

  const q = buscar.trim().toLowerCase();
  const visibles = registros.filter((registro) => (
    filtro === 'todos'
    || (filtro === 'con_faltantes' ? registro.estado === 'con_faltantes' : registro.estado !== 'con_faltantes')
  ) && (!q || `${registro.ubicacion.nombre} ${registro.ubicacion.codigo}`.toLowerCase().includes(q)));
  const fechas = [...new Set(visibles.map((registro) => registro.fecha_entrega ?? 'Sin fecha'))];
  const conFaltantes = registros.filter((r) => r.estado === 'con_faltantes').length;
  const sinReporte = registros.length - conFaltantes;
  const fechaLabel = (iso: string) => iso === 'Sin fecha' ? iso : new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  return <div className={integrado ? 'embedded-operation reception-audit' : 'page reception-audit'}>
    {!integrado && <header className="page-head"><div><span className="eyebrow">Control excepcional</span><h1>Auditoría de faltantes</h1><p className="page-sub">Solo registra una entrega cuando algún producto no llegó completo.</p></div></header>}
    {integrado && <header className="embedded-head"><div><span className="eyebrow">Control excepcional</span><h2>Auditoría de faltantes</h2><p>No requiere confirmación cuando todo llegó bien.</p></div></header>}

    <div className="metric-strip metric-strip--three reception-audit-metrics"><div><span>Entregas despachadas</span><strong>{registros.length}</strong></div><div><span>Sin reporte</span><strong>{sinReporte}</strong></div><div><span>Con faltantes</span><strong>{conFaltantes}</strong></div></div>
    <section className="workspace-card reception-audit-toolbar"><div className="segmented segmented--small"><button className={filtro === 'todos' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setFiltro('todos')}>Todas</button><button className={filtro === 'con_faltantes' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setFiltro('con_faltantes')}>Con faltantes</button><button className={filtro === 'sin_faltantes' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setFiltro('sin_faltantes')}>Sin reporte</button></div><input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar restaurante" /></section>
    {error && <p className="error-msg">{error}</p>}
    {ok && <p className="ok-msg">{ok}</p>}
    {cargando ? <Spinner label="Cargando auditoría…" /> : <div className="reception-audit-days">{fechas.map((fecha) => <CollapsibleSection title={fechaLabel(fecha)} count={`${visibles.filter((r) => (r.fecha_entrega ?? 'Sin fecha') === fecha).length} restaurantes`} key={fecha}><div className="reception-audit-grid">{visibles.filter((r) => (r.fecha_entrega ?? 'Sin fecha') === fecha).map((registro) => {
      const clave = `${registro.distribucion_id}:${registro.ubicacion.id}`;
      const abierto = editando === clave;
      return <article className={`workspace-card reception-audit-card reception-audit-card--${registro.estado}`} key={clave}>
        <header><div><strong>{registro.ubicacion.nombre}</strong><small>{registro.ubicacion.codigo} · consolidado #{registro.distribucion_id}</small></div><span className={`chip ${registro.estado === 'con_faltantes' ? 'chip--warn' : 'chip--muted'}`}>{registro.estado === 'con_faltantes' ? `${registro.total_faltante} faltantes` : 'Sin reporte'}</span></header>
        <div className="reception-audit-lines"><div className="reception-audit-line reception-audit-line--head"><span>Artículo</span><span>Enviado</span><span>{abierto ? 'Faltó' : 'Registrado'}</span></div>{registro.lineas.map((linea) => <div className={`reception-audit-line ${linea.faltante > 0 ? 'has-shortage' : ''}`} key={linea.linea_id}><span><strong>{linea.nombre}</strong><small>{linea.unidad}</small></span><span>{linea.esperado.toLocaleString('es-MX')}</span>{abierto ? <input type="number" min="0" max={linea.esperado} step="0.5" inputMode="decimal" aria-label={`Faltante de ${linea.nombre} en ${registro.ubicacion.nombre}`} value={faltantes[linea.linea_id] ?? ''} placeholder="0" onChange={(e) => setFaltantes({ ...faltantes, [linea.linea_id]: e.target.value })} /> : <span>{(linea.recibida ?? linea.esperado).toLocaleString('es-MX')}{linea.faltante > 0 && <small>Faltó {linea.faltante}</small>}</span>}</div>)}</div>
        <footer>{abierto ? <><button className="btn btn-secondary" disabled={busy} onClick={() => { setEditando(''); setFaltantes({}); }}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={() => void guardar(registro)}>{busy ? 'Guardando…' : registro.estado === 'con_faltantes' ? 'Guardar corrección' : 'Registrar faltantes'}</button></> : <><span>{registro.estado === 'con_faltantes' ? 'Incidencia registrada.' : 'No requiere confirmación.'}</span><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => abrir(registro)}>{registro.estado === 'con_faltantes' ? 'Corregir faltantes' : 'Registrar faltante'}</button></>}</footer>
      </article>;
    })}</div></CollapsibleSection>)}</div>}
    {!cargando && !visibles.length && <div className="empty-state"><strong>No hay recepciones en este filtro</strong><span>Cambia el estado, la búsqueda o la semana.</span></div>}
  </div>;
}
