import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useToast, mensajeError } from '../../toast';
import { EstadoDistChip, FaseChip, ParadaChip, FlujoStepper } from '../../flujo';
import Spinner from '../../components/Spinner';
import { indiceEnOrden, nombreEnOrden, type LineaOperacion } from '../../operationOrder';
import { crearSemana, hoyChicago, type SemanaSeleccionada } from '../../semana';
import CollapsibleSection from '../../components/CollapsibleSection';

interface DistResumen {
  id: number;
  nombre: string | null;
  estado: string;
  linea: 'carne' | 'desechables' | null;
  fecha_entrega: string | null;
  creado_at: string;
  aprobado_at: string | null;
  total_lineas: number;
}

const tituloDist = (d: { id: number; nombre: string | null }) => d.nombre?.trim() || `Pedido #${d.id}`;

const usd = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`);
export default function Distribucion({ integrado = false, semana = crearSemana(), soloRevision = false }: { integrado?: boolean; semana?: SemanaSeleccionada; soloRevision?: boolean }) {
  const toast = useToast();
  const [lista, setLista] = useState<DistResumen[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [linea, setLinea] = useState<'carne' | 'desechables'>('carne');
  const [fecha, setFecha] = useState(semana.inicio);
  const [calendario, setCalendario] = useState<{ linea: 'carne' | 'desechables'; dia_semana: number }[]>([]);
  const solicitud = useRef(0);

  const fechasEntrega = (() => {
    const dias = new Set(calendario.filter((c) => c.linea === linea).map((c) => c.dia_semana));
    const fechas: string[] = [];
    for (let iso = semana.inicio; iso <= semana.fin;) {
      const d = new Date(`${iso}T12:00:00`);
      if (dias.has(d.getDay())) fechas.push(iso);
      d.setDate(d.getDate() + 1);
      iso = d.toLocaleDateString('en-CA');
    }
    return fechas;
  })();

  async function cargar() {
    const turno = ++solicitud.current;
    setCargando(true);
    try {
      const filas = await api<DistResumen[]>(`/distribuciones?desde=${semana.inicio}&hasta=${semana.fin}`);
      if (turno === solicitud.current) setLista(filas);
    } catch {
      if (turno === solicitud.current) setError('No se pudieron cargar los pedidos');
    } finally {
      if (turno === solicitud.current) setCargando(false);
    }
  }
  useEffect(() => { setAbierta(null); setLista([]); setError(''); void cargar(); }, [semana.inicio, semana.fin]);
  useEffect(() => {
    api<{ calendario_pedidos: { linea: 'carne' | 'desechables'; dia_semana: number }[] }>('/operacion/catalogo')
      .then((c) => setCalendario(c.calendario_pedidos))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el calendario de rutas.'));
  }, []);
  useEffect(() => {
    const sugerida = fechasEntrega.find((f) => f >= hoyChicago()) ?? fechasEntrega[0] ?? '';
    setFecha(sugerida);
  }, [semana.inicio, linea, calendario]);

  async function crearPreparacion() {
    setCreando(true);
    setError('');
    try {
      const resultado = await api<{ id: number; pedidos: number; rutas: number }>('/operacion/distribuciones', {
        method: 'POST',
        body: { linea, fecha_entrega: fecha },
      });
      toast.ok(`Preparación #${resultado.id}: ${resultado.pedidos} pedidos y ${resultado.rutas} rutas creadas.`);
      setAbierta(resultado.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear la preparación.');
    } finally {
      setCreando(false);
    }
  }

  async function crearTodas() {
    setCreando(true); setError('');
    try {
      const r = await api<{ creadas: { id: number; linea: string; fecha: string; pedidos: number; rutas: number }[]; existentes: number; borradores_omitidos: number }>('/operacion/distribuciones/crear-todas', {
        method: 'POST', body: { desde: semana.inicio, hasta: semana.fin },
      });
      toast.ok(`${r.creadas.length} preparaciones creadas${r.existentes ? ` · ${r.existentes} ya existían` : ''}${r.borradores_omitidos ? ` · ${r.borradores_omitidos} borradores omitidos` : ''}.`);
      await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudieron crear las preparaciones de la semana.'); }
    finally { setCreando(false); }
  }

  async function aprobarTodas() {
    setCreando(true); setError('');
    try {
      const r = await api<{ aprobadas: number }>('/distribuciones/aprobar-todas', { method: 'POST', body: { desde: semana.inicio, hasta: semana.fin } });
      toast.ok(`${r.aprobadas} preparaciones aprobadas.`);
      await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudieron aprobar las preparaciones.'); }
    finally { setCreando(false); }
  }

  async function reconstruirFaltantes() {
    setCreando(true); setError('');
    try {
      const creadas = await api<{ creadas: { id: number }[]; existentes: number; borradores_omitidos: number }>('/operacion/distribuciones/crear-todas', {
        method: 'POST', body: { desde: semana.inicio, hasta: semana.fin },
      });
      const aprobadas = await api<{ aprobadas: number }>('/distribuciones/aprobar-todas', {
        method: 'POST', body: { desde: semana.inicio, hasta: semana.fin },
      });
      toast.ok(`${creadas.creadas.length} consolidados reconstruidos · ${aprobadas.aprobadas} aprobados.`);
      await cargar();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudieron reconstruir los consolidados.'); }
    finally { setCreando(false); }
  }

  if (abierta != null) {
    return <Consolidado id={abierta} integrado={integrado || soloRevision} onSalir={() => { setAbierta(null); void cargar(); }} />;
  }

  return (
    <div className={integrado ? 'embedded-operation' : 'page'}>
      {!soloRevision && !integrado && <header className="page-head">
        <div>
          <span className="eyebrow">Pedidos confirmados</span>
          <h1>Preparación de entregas</h1>
          <p className="page-sub">Revisa el consolidado de carne o desechables antes de enviarlo a despacho.</p>
        </div>
      </header>}

      {!soloRevision && !integrado && <FlujoStepper activo="conteo" />}
      {!soloRevision && integrado && <header className="embedded-head"><div><span className="eyebrow">Ventas</span><h2>Consolidados automáticos</h2></div></header>}

      {error && <p className="error-msg">{error}</p>}
      {!soloRevision && <section className="workspace-card preparation-builder">
        <div>
          <span className="eyebrow">Nueva preparación</span>
          <h2>Consolidar pedidos</h2>
          <p>Solo entran pedidos confirmados. Al crearla se generan juntas las rutas de Pablo y MH que correspondan al día.</p>
        </div>
        <div className="preparation-builder__controls">
          <div className="segmented order-line-switch">
            <button className={linea === 'carne' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('carne')}>Carne</button>
            <button className={linea === 'desechables' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('desechables')}>Desechables</button>
          </div>
          <label className="field"><span>Entrega de semana {semana.numero}</span><select value={fecha} disabled={!fechasEntrega.length} onChange={(e) => setFecha(e.target.value)}>{!fechasEntrega.length && <option value="">Sin ruta configurada</option>}{fechasEntrega.map((f) => <option value={f} key={f}>{new Date(`${f}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' })}</option>)}</select></label>
          <button className="btn btn-primary" disabled={creando || !fecha} onClick={() => void crearPreparacion()}>{creando ? 'Consolidando…' : 'Crear esta preparación'}</button>
        </div>
        <div className="preparation-batch-actions"><span>Semana {semana.numero} · {semana.inicio} al {semana.fin}</span><button className="btn btn-secondary" disabled={creando} onClick={() => void crearTodas()}>Crear todas</button><button className="btn btn-secondary" disabled={creando} onClick={() => void aprobarTodas()}>Aprobar todas</button></div>
        <Link className="preparation-orders-link" to={`/semana/ventas?semana=${semana.inicio}`}>Revisar o capturar ventas →</Link>
      </section>}

      {soloRevision && <section className="workspace-card consolidated-sales-head">
        <div><span className="eyebrow">Ventas confirmadas</span><h2>Consolidados y rutas</h2><p>Revisa o elimina un consolidado antes del despacho.</p></div>
        <button className="btn btn-secondary" disabled={creando} onClick={() => void reconstruirFaltantes()}>{creando ? 'Reconstruyendo…' : 'Reconstruir faltantes'}</button>
      </section>}

      {cargando ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <p className="muted">Aún no hay consolidados.</p>
      ) : (
        <CollapsibleSection title={`Consolidados de semana ${semana.numero}`} count={lista.length}><div className="lista-ubicaciones">
          {lista.map((d) => (
            <button key={d.id} className="card card-click" onClick={() => setAbierta(d.id)}>
              <div className="ubic-row">
                <div>
                  <strong>{tituloDist(d)}</strong> <FaseChip estado={d.estado} />
                  <div className="muted">
                    {d.fecha_entrega ?? new Date(d.creado_at).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })} · {d.linea ?? 'operación'} · {d.total_lineas} líneas
                  </div>
                </div>
                <span className="muted">›</span>
              </div>
            </button>
          ))}
        </div></CollapsibleSection>
      )}
    </div>
  );
}

// ───────────────────────── Consolidado ─────────────────────────────────────

interface SucItem {
  linea_id: number;
  product_id: number;
  sku: string;
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
  linea: LineaOperacion;
  vista: 'sucursal';
  grupos: { ubicacion: { id: number; nombre: string }; items: SucItem[]; subtotal: number }[];
  total: number;
}
interface ProdItem {
  product_id: number;
  sku: string;
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
  linea: LineaOperacion;
  vista: 'producto';
  items: ProdItem[];
  total_valor: number;
  total_faltante_valor: number;
}

function Consolidado({ id, integrado = false, onSalir }: { id: number; integrado?: boolean; onSalir: () => void }) {
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
    if (!window.confirm('¿Eliminar este consolidado? Se devolverá a la bodega central el inventario que las sucursales aún tengan, se borrarán sus rutas e incidencias y las ventas volverán a estado confirmado para poder corregirlas. No se puede deshacer.')) return;
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
    <div className={integrado ? 'embedded-operation conteo-page' : 'page conteo-page'}>
      <header className="page-head">
        <div>
          <button className="link-btn" onClick={onSalir}>← Consolidados</button>
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
            {prod.total_faltante_valor > 0 && <> · Pendiente de conciliar: <strong>{usd(prod.total_faltante_valor)}</strong></>}
          </p>
          {prod.items.length > 12 && (
            <div className="dist-filtros">
              <input className="inv-search" type="search" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" className={`chip ${soloFaltante ? 'chip--danger' : 'chip--muted'}`} style={{ cursor: 'pointer', border: 0 }} onClick={() => setSoloFaltante((v) => !v)}>
                Solo por conciliar
              </button>
            </div>
          )}
          {prod.items
            .filter((it) => !q || nombreEnOrden(it.sku, it.nombre, prod.linea).toLowerCase().includes(q.trim().toLowerCase()))
            .filter((it) => !soloFaltante || it.faltante > 0)
            .slice()
            .sort((a, b) => indiceEnOrden(a.sku, prod.linea) - indiceEnOrden(b.sku, prod.linea))
            .map((it) => (
            <div key={it.product_id} className={`card ${it.faltante > 0 ? 'card--falt' : ''}`}>
              <div className="ubic-row">
                <div>
                  <strong>{nombreEnOrden(it.sku, it.nombre, prod.linea)}</strong> <span className="chip chip--info">{it.unidad}</span>
                  <div className="muted">
                    Pedido: {it.total_aprobada} · Saldo registrado: {it.bodega_disponible}
                    {it.faltante > 0 && <> · <span className="txt-danger">Por conciliar {it.faltante}</span></>}
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
              {[...g.items].sort((a, b) => indiceEnOrden(a.sku, suc.linea) - indiceEnOrden(b.sku, suc.linea)).map((it) => (
                <div key={it.linea_id} className="dist-row">
                  <div className="conteo-prod">
                    <strong>{nombreEnOrden(it.sku, it.nombre, suc.linea)}</strong>
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
  nombre: string;
  conductor: string | null;
  estado: string;
  repartidor: { id: number; nombre: string } | null;
  paradas: RutaParada[];
}

function RutaPlanner({ id }: { id: number }) {
  const [rutas, setRutas] = useState<RutaDetalle[]>([]);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setError('');
    try {
      setRutas(await api<RutaDetalle[]>(`/distribuciones/${id}/rutas`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al cargar las rutas');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [id]);

  return (
    <>
      {error && <p className="error-msg">{error}</p>}
      {cargando ? <Spinner label="Cargando rutas…" /> : rutas.length === 0 ? <div className="empty-state"><strong>No hay rutas generadas</strong></div> : <div className="generated-route-grid">{rutas.map((ruta) => <CollapsibleSection title={ruta.nombre} count={`${ruta.paradas.length} paradas`} summary={ruta.conductor ?? 'Por asignar'} className="generated-route" key={ruta.ruta_id}>
        <div className="ruta-tablero">{ruta.paradas.length ? [...ruta.paradas].sort((a, b) => a.orden - b.orden).map((p) => <div key={p.parada_id} className="ruta-parada-fila"><span className="parada-orden">{p.orden}</span><span><strong>{p.ubicacion.nombre}</strong></span><ParadaChip estado={p.estado} /></div>) : <p className="muted">Ruta creada; todavía no tiene pedidos confirmados asignados.</p>}</div>
      </CollapsibleSection>)}</div>}
      <p className="operation-footnote"><Link to="/rutas">Editar orden de rutas</Link></p>
    </>
  );
}
