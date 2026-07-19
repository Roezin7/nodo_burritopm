import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { FaseChip, FlujoStepper } from '../../flujo';
import BodegaRutaTabs from '../../components/BodegaRutaTabs';
import { filasOrden, type FilaOrden, type LineaOperacion, type ProductoOrdenable } from '../../operationOrder';
import { crearSemana, type SemanaSeleccionada } from '../../semana';
import { useOperacionConfig } from '../../operacion-config';
import CollapsibleSection from '../../components/CollapsibleSection';
import { useAuth } from '../../auth';

interface DistResumen {
  id: number;
  estado: string;
  creado_at: string;
  fecha_entrega: string | null;
  linea: LineaOperacion | null;
  total_lineas: number;
}

interface TotalCarga {
  product_id: number;
  sku: string;
  nombre: string;
  unidad: string;
  categoria: string | null;
  total_aprobada: number;
  total_a_cargar: number;
  bodega_disponible: number;
  faltante: number;
}

interface Operacion {
  id: number;
  nombre: string;
  estado: string;
  linea: LineaOperacion;
  fecha_entrega: string | null;
  preparado_por: number | null;
  verificado_por: number | null;
  total_carga: TotalCarga[];
}

interface RutaItem {
  linea_id: number;
  product_id: number;
  sku: string;
  nombre: string;
  unidad: string;
  esperado: number;
  recibida: number | null;
  destino_facturacion?: string;
}

interface RutaParada {
  parada_id: number;
  ubicacion: { id: number; nombre: string; direccion: string | null };
  orden: number;
  estado: string;
  items: RutaItem[];
}

interface RutaDetalle {
  ruta_id: number;
  distribucion_id: number;
  nombre: string;
  conductor: string | null;
  linea: LineaOperacion;
  fecha_entrega: string | null;
  estado: string;
  paradas: RutaParada[];
}

interface Catalogo { productos: ProductoOrdenable[] }

interface DestinoDocumento {
  clave: string;
  nombre: string;
  entregaEn: string;
  direccion: string | null;
  items: RutaItem[];
}

type AlcanceImpresion = { tipo: 'completo' | 'carga' } | { tipo: 'ruta'; rutaId: number };

const ESTADOS_BODEGA = ['aprobada', 'verificada', 'en_transito', 'parcialmente_entregada'];
const ESTADOS_HIST = ['entregada', 'cerrada', 'cerrada_con_incidencias', 'cancelada'];

function fechaLegible(valor: string | null) {
  if (!valor) return 'Fecha pendiente';
  return new Date(`${valor}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function numero(valor: number) {
  return valor.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function prioridadRuta(ruta: RutaDetalle) {
  const texto = `${ruta.conductor ?? ''} ${ruta.nombre}`.toLowerCase();
  if (texto.includes('pablo') || texto.includes('sur')) return 0;
  if (texto.includes('mh') || texto.includes('norte')) return 1;
  if (texto.includes('tapat')) return 2;
  return 3;
}

function esRutaTapatios(ruta: RutaDetalle) {
  return ruta.nombre.toLowerCase().includes('tapat');
}

function destinosDeRuta(ruta: RutaDetalle): DestinoDocumento[] {
  const destinos = new Map<string, DestinoDocumento>();
  for (const parada of [...ruta.paradas].sort((a, b) => a.orden - b.orden)) {
    for (const item of parada.items) {
      const nombre = item.destino_facturacion?.trim() || parada.ubicacion.nombre;
      const clave = `${ruta.ruta_id}:${parada.parada_id}:${nombre}`;
      if (!destinos.has(clave)) destinos.set(clave, {
        clave,
        nombre,
        entregaEn: parada.ubicacion.nombre,
        direccion: parada.ubicacion.direccion,
        items: [],
      });
      destinos.get(clave)!.items.push(item);
    }
  }
  return [...destinos.values()];
}

function cantidadFila(destino: DestinoDocumento, fila: FilaOrden) {
  return destino.items
    .filter((item) => fila.skus.includes(item.sku))
    .reduce((total, item) => total + item.esperado, 0);
}

export default function Bodega({ integrado = false, semana = crearSemana() }: { integrado?: boolean; semana?: SemanaSeleccionada }) {
  const { usuario } = useAuth();
  const { repartoHabilitado } = useOperacionConfig();
  const [lista, setLista] = useState<DistResumen[]>([]);
  const [op, setOp] = useState<Operacion | null>(null);
  const [rutas, setRutas] = useState<RutaDetalle[]>([]);
  const [productos, setProductos] = useState<ProductoOrdenable[]>([]);
  const [verificacionCarga, setVerificacionCarga] = useState(false);
  const [tab, setTab] = useState<'activos' | 'historial'>('activos');
  const [error, setError] = useState('');
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const solicitud = useRef(0);

  async function cargar() {
    const turno = ++solicitud.current;
    try {
      if (usuario?.rol === 'admin' && semana.actual) {
        await api('/operacion/distribuciones/sincronizar', { method: 'POST', body: { desde: semana.inicio, hasta: semana.fin } }).catch(() => undefined);
      }
      const filas = await api<DistResumen[]>(`/distribuciones?desde=${semana.inicio}&hasta=${semana.fin}`);
      if (turno === solicitud.current) setLista(filas);
    } catch (e) {
      if (turno === solicitud.current) setError(e instanceof ApiError ? e.message : 'Error al cargar los despachos.');
    }
  }

  useEffect(() => {
    setOp(null); setRutas([]); setLista([]); setError('');
    void cargar();
  }, [semana.inicio, semana.fin, usuario?.rol]);

  useEffect(() => {
    Promise.all([api<{ verificacion_carga: boolean }>('/negocio'), api<Catalogo>('/operacion/catalogo')])
      .then(([negocio, catalogo]) => { setVerificacionCarga(negocio.verificacion_carga); setProductos(catalogo.productos); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar la configuración de despacho.'));
  }, []);

  async function abrir(id: number) {
    setError(''); setCargandoDetalle(true);
    try {
      const [detalle, rutasDetalle] = await Promise.all([
        api<Operacion>(`/distribuciones/${id}/operacion`),
        api<RutaDetalle[]>(`/distribuciones/${id}/rutas`),
      ]);
      setOp(detalle);
      setRutas([...rutasDetalle].sort((a, b) => prioridadRuta(a) - prioridadRuta(b) || a.nombre.localeCompare(b.nombre, 'es')));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo abrir el despacho.');
    } finally {
      setCargandoDetalle(false);
    }
  }

  if (op) return <OperacionView
    op={op}
    rutas={rutas}
    productos={productos}
    verificacionCarga={verificacionCarga}
    repartoHabilitado={repartoHabilitado}
    integrado={integrado}
    onSalir={() => { setOp(null); setRutas([]); void cargar(); }}
    onRecargar={() => void abrir(op.id)}
  />;

  const activos = lista.filter((d) => ESTADOS_BODEGA.includes(d.estado));
  const historial = lista.filter((d) => ESTADOS_HIST.includes(d.estado));
  const mostradas = tab === 'activos' ? activos : historial;

  return (
    <div className={integrado ? 'embedded-operation' : 'page'}>
      {!integrado && <header className="page-head"><div><span className="eyebrow">Documentos de salida</span><h1>Despacho</h1><p className="page-sub">Hojas de carga y paquetes para cada ruta.</p></div></header>}
      {!integrado && <FlujoStepper activo="bodega" />}
      {!integrado && <BodegaRutaTabs activo="bodega" />}
      {integrado && <header className="embedded-head"><div><span className="eyebrow">Paso 4</span><h2>Despacho</h2></div></header>}
      {error && <p className="error-msg">{error}</p>}

      <div className="tabs">
        <button className={tab === 'activos' ? 'tab tab--on' : 'tab'} onClick={() => setTab('activos')}>Pendientes ({activos.length})</button>
        <button className={tab === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setTab('historial')}>Historial ({historial.length})</button>
      </div>

      {cargandoDetalle ? <p className="muted">Preparando documentos…</p> : mostradas.length === 0 ? (
        <div className="empty-state"><strong>{tab === 'activos' ? 'No hay despachos pendientes' : 'Aún no hay despachos anteriores'}</strong><span>Los documentos aparecen automáticamente cuando los pedidos confirmados de la fecha están completos.</span></div>
      ) : (
        <CollapsibleSection title={tab === 'activos' ? 'Salidas de la semana' : 'Despachos anteriores'} count={mostradas.length}>
          <div className="lista-ubicaciones">
            {mostradas.map((d) => <button key={d.id} className="card card-click" onClick={() => void abrir(d.id)}>
              <div className="ubic-row"><div><strong>{d.linea === 'carne' ? 'Carne' : 'Desechables'} · {fechaLegible(d.fecha_entrega)}</strong> <FaseChip estado={d.estado} /><div className="muted">{d.total_lineas} partidas · hojas por ruta listas para imprimir</div></div><span className="muted">›</span></div>
            </button>)}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

function OperacionView({
  op, rutas, productos, verificacionCarga, repartoHabilitado, integrado, onSalir, onRecargar,
}: {
  op: Operacion;
  rutas: RutaDetalle[];
  productos: ProductoOrdenable[];
  verificacionCarga: boolean;
  repartoHabilitado: boolean;
  integrado: boolean;
  onSalir: () => void;
  onRecargar: () => void;
}) {
  const [impresion, setImpresion] = useState<AlcanceImpresion | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const enRuta = op.estado === 'en_transito' || op.estado === 'parcialmente_entregada';
  const totalFaltante = op.total_carga.filter((t) => t.faltante > 0).length;

  async function ejecutar(endpoint: string) {
    setBusy(true); setError('');
    try {
      await api(`/distribuciones/${op.id}/${endpoint}`, { method: 'POST' });
      onRecargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo actualizar el despacho.');
    } finally {
      setBusy(false);
    }
  }

  return <div className={integrado ? 'embedded-operation dispatch-workspace' : 'page dispatch-workspace'}>
    <header className="page-head dispatch-page-head"><div><button className="link-btn" onClick={onSalir}>← Despacho</button><span className="eyebrow">{op.linea}</span><h1>Documentos de salida</h1><p className="page-sub">{fechaLegible(op.fecha_entrega)} · {rutas.length} ruta{rutas.length === 1 ? '' : 's'}</p></div><div className="page-actions"><button className="btn btn-secondary" disabled={!rutas.length} onClick={() => setImpresion({ tipo: 'carga' })}>Hoja general de carga</button><button className="btn btn-primary" disabled={!rutas.length} onClick={() => setImpresion({ tipo: 'completo' })}>Imprimir paquete completo</button></div></header>
    {error && <p className="error-msg">{error}</p>}
    {totalFaltante > 0 && <p className="aviso-falt">Hay {totalFaltante} producto{totalFaltante === 1 ? '' : 's'} con inventario pendiente de conciliar. Las hojas conservan las cantidades confirmadas para que el cierre semanal refleje la diferencia real.</p>}

    <section className="dispatch-summary card">
      <div><span className="eyebrow">Salida</span><strong>{op.linea === 'carne' ? 'Orden total de carne' : 'Orden total de desechables'}</strong><small>{fechaLegible(op.fecha_entrega)}</small></div>
      <div><small>Productos</small><strong>{op.total_carga.filter((p) => p.total_a_cargar > 0).length}</strong></div>
      <div><small>Paradas</small><strong>{rutas.reduce((total, ruta) => total + destinosDeRuta(ruta).length, 0)}</strong></div>
      <div><small>Rutas</small><strong>{rutas.length}</strong></div>
      <FaseChip estado={op.estado} />
    </section>

    {!rutas.length ? <div className="empty-state"><strong>No se generaron rutas</strong><span>Revisa la configuración de rutas para esta línea y día.</span></div> : <div className="dispatch-route-grid">
      {rutas.map((ruta) => {
        const destinos = destinosDeRuta(ruta);
        const tapatios = esRutaTapatios(ruta);
        return <article className="dispatch-route-card" key={ruta.ruta_id}>
          <header><div><span className="eyebrow">{ruta.conductor || 'Ruta'}</span><h2>{ruta.nombre}</h2><p>{tapatios ? 'Una hoja consolidada para toda la ruta' : op.linea === 'carne' ? `Una hoja total + ${destinos.length} individuales` : `${destinos.length} hojas individuales para el chofer`}</p></div><button className="btn btn-secondary" onClick={() => setImpresion({ tipo: 'ruta', rutaId: ruta.ruta_id })}>Imprimir ruta</button></header>
          <ol>{destinos.map((destino, indice) => <li key={destino.clave}><span>{indice + 1}</span><div><strong>{destino.nombre}</strong>{destino.entregaEn !== destino.nombre && <small>Se entrega en {destino.entregaEn}</small>}</div><b>{numero(destino.items.reduce((total, item) => total + item.esperado, 0))}</b></li>)}</ol>
        </article>;
      })}
    </div>}

    <div className="action-bar dispatch-final-actions">
      {op.estado === 'aprobada' && verificacionCarga && <button className="btn btn-secondary" disabled={busy} onClick={() => void ejecutar('verificada')}>Marcar carga revisada</button>}
      {(op.estado === 'verificada' || (op.estado === 'aprobada' && !verificacionCarga)) && <button className="btn btn-primary" disabled={busy} onClick={() => void ejecutar('cargar')}>{repartoHabilitado ? 'Confirmar salida a ruta →' : 'Confirmar salida y enviar a Recepción →'}</button>}
      {enRuta && <span className="muted">{repartoHabilitado ? 'Salida confirmada · en ruta.' : 'Salida confirmada · pendiente de recepción.'}</span>}
    </div>

    {impresion && <PaqueteDespacho op={op} rutas={rutas} productos={productos} alcance={impresion} onClose={() => setImpresion(null)} />}
  </div>;
}

function TablaMatriz({ titulo, subtitulo, destinos, filas, linea }: {
  titulo: string;
  subtitulo: string;
  destinos: DestinoDocumento[];
  filas: FilaOrden[];
  linea: LineaOperacion;
}) {
  return <table className={`dispatch-sheet dispatch-sheet--matrix dispatch-sheet--${linea}`}>
    <thead><tr><th className="dispatch-sheet-title" colSpan={destinos.length + 2}>{titulo}<small>{subtitulo}</small></th></tr><tr><th>TOTAL</th><th>ITEM</th>{destinos.map((destino) => <th key={destino.clave}>{destino.nombre}</th>)}</tr></thead>
    <tbody>{filas.map((fila) => {
      const cantidades = destinos.map((destino) => cantidadFila(destino, fila));
      const total = cantidades.reduce((suma, valor) => suma + valor, 0);
      return <tr key={`${fila.nombre}:${fila.skus.join('-')}`}><th>{total > 0 ? numero(total) : ''}</th><td>{fila.nombre}</td>{cantidades.map((cantidad, indice) => <td key={destinos[indice].clave}>{cantidad > 0 ? numero(cantidad) : ''}</td>)}</tr>;
    })}</tbody>
    <tfoot><tr><th>{numero(destinos.reduce((total, destino) => total + destino.items.reduce((suma, item) => suma + item.esperado, 0), 0))}</th><th>TOTAL</th>{destinos.map((destino) => <th key={destino.clave}>{numero(destino.items.reduce((total, item) => total + item.esperado, 0))}</th>)}</tr></tfoot>
  </table>;
}

function TablaIndividual({ destino, filas, linea }: { destino: DestinoDocumento; filas: FilaOrden[]; linea: LineaOperacion }) {
  return <table className={`dispatch-sheet dispatch-sheet--individual dispatch-sheet--${linea}`}>
    <thead><tr><th className="dispatch-sheet-title" colSpan={2}>{destino.nombre}<small>{destino.entregaEn !== destino.nombre ? `ENTREGA EN ${destino.entregaEn}` : destino.direccion || ''}</small></th></tr><tr><th>ITEM</th><th>QTY</th></tr></thead>
    <tbody>{filas.map((fila) => { const cantidad = cantidadFila(destino, fila); return <tr key={`${fila.nombre}:${fila.skus.join('-')}`}><td>{fila.nombre}</td><td>{cantidad > 0 ? numero(cantidad) : ''}</td></tr>; })}</tbody>
    <tfoot><tr><th>TOTAL</th><th>{numero(destino.items.reduce((total, item) => total + item.esperado, 0))}</th></tr></tfoot>
  </table>;
}

function EncabezadoHoja({ izquierda, derecha, fecha }: { izquierda: string; derecha: string; fecha: string | null }) {
  return <header className="dispatch-print-heading"><div><span>M&amp;G MANAGEMENT AND LOGISTICS INC.</span><strong>{izquierda}</strong></div><div><span>{fechaLegible(fecha)}</span><strong>{derecha}</strong></div></header>;
}

function PaqueteDespacho({ op, rutas, productos, alcance, onClose }: {
  op: Operacion;
  rutas: RutaDetalle[];
  productos: ProductoOrdenable[];
  alcance: AlcanceImpresion;
  onClose: () => void;
}) {
  const filas = useMemo(() => filasOrden(op.linea, productos), [op.linea, productos]);
  const rutasSeleccionadas = alcance.tipo === 'ruta' ? rutas.filter((ruta) => ruta.ruta_id === alcance.rutaId) : rutas;
  const destinosTotales = rutas.flatMap(destinosDeRuta);
  const unicaTapatios = rutas.length === 1 && esRutaTapatios(rutas[0]);
  const mostrarCarga = alcance.tipo === 'carga' || (alcance.tipo === 'completo' && !unicaTapatios);
  const mostrarRutas = alcance.tipo !== 'carga';

  return <div className="modal-backdrop" onClick={onClose}><div className="modal-card invoice-print dispatch-print" onClick={(e) => e.stopPropagation()}>
    <header className="dispatch-preview-toolbar no-print"><div><span className="eyebrow">Vista previa</span><h2>{alcance.tipo === 'carga' ? 'Hoja general de carga' : alcance.tipo === 'ruta' ? 'Paquete del chofer' : 'Paquete completo'}</h2></div><button className="icon-btn" aria-label="Cerrar" onClick={onClose}>×</button></header>

    {mostrarCarga && <section className={`dispatch-print-page dispatch-print-page--matrix dispatch-print-page--${op.linea}`}>
      <EncabezadoHoja izquierda="CARGA GENERAL" derecha={op.linea.toUpperCase()} fecha={op.fecha_entrega} />
      <TablaMatriz titulo={op.linea === 'carne' ? 'CARNE' : 'DISPOSABLES'} subtitulo="TOTAL PARA CARGAR" destinos={destinosTotales} filas={filas} linea={op.linea} />
      <footer>{rutas.map((ruta) => `${ruta.conductor || 'Ruta'}: ${ruta.nombre}`).join(' · ')}</footer>
    </section>}

    {mostrarRutas && rutasSeleccionadas.flatMap((ruta) => {
      const destinos = destinosDeRuta(ruta);
      if (esRutaTapatios(ruta)) return [<section className={`dispatch-print-page dispatch-print-page--matrix dispatch-print-page--${op.linea}`} key={`ruta-${ruta.ruta_id}`}>
        <EncabezadoHoja izquierda={ruta.conductor || 'TAPATÍOS'} derecha={ruta.nombre} fecha={ruta.fecha_entrega || op.fecha_entrega} />
        <TablaMatriz titulo="RUTA TAPATÍOS" subtitulo="UNA HOJA PARA TODA LA RUTA" destinos={destinos} filas={filas} linea={op.linea} />
        <footer>{destinos.map((destino) => destino.nombre).join(' → ')}</footer>
      </section>];
      const hojasIndividuales = destinos.map((destino, indice) => <section className={`dispatch-print-page dispatch-print-page--ticket dispatch-print-page--${op.linea}`} key={`${ruta.ruta_id}:${destino.clave}`}>
        <EncabezadoHoja izquierda={ruta.conductor || 'CHOFER'} derecha={`${ruta.nombre} · ${indice + 1}/${destinos.length}`} fecha={ruta.fecha_entrega || op.fecha_entrega} />
        <TablaIndividual destino={destino} filas={filas} linea={op.linea} />
        <footer>Parada {indice + 1} de {destinos.length}{destino.direccion ? ` · ${destino.direccion}` : ''}</footer>
      </section>);
      if (op.linea !== 'carne') return hojasIndividuales;
      return [<section className={`dispatch-print-page dispatch-print-page--matrix dispatch-print-page--${op.linea}`} key={`total-ruta-${ruta.ruta_id}`}>
        <EncabezadoHoja izquierda={ruta.conductor || 'CHOFER'} derecha={`${ruta.nombre} · TOTAL`} fecha={ruta.fecha_entrega || op.fecha_entrega} />
        <TablaMatriz titulo="CARNE" subtitulo={`TOTAL DE RUTA · ${ruta.conductor || ruta.nombre}`} destinos={destinos} filas={filas} linea={op.linea} />
        <footer>{destinos.map((destino) => destino.nombre).join(' → ')}</footer>
      </section>, ...hojasIndividuales];
    })}

    <button className="btn btn-primary btn-block no-print" onClick={() => window.print()}>Imprimir / guardar PDF</button>
  </div></div>;
}
