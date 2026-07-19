import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api, ApiError, fueEncolado, type Encolado } from '../../api';
import { useAuth } from '../../auth';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';
import { filasOrden, nombreEnVenta, productosParaPedido } from '../../operationOrder';
import { crearSemana, etiquetaRango, inicioDeSemana, type SemanaSeleccionada } from '../../semana';
import Distribucion from '../distribucion/Distribucion';
import CollapsibleSection from '../../components/CollapsibleSection';
import { guardarBorradorLocal, leerBorradorLocal, useUnsavedChanges } from '../../use-unsaved';

type Linea = 'carne' | 'desechables';
interface Catalogo {
  ubicaciones: { id: number; nombre: string; codigo: string; tipo: string; empresa: { id: number; nombre: string; codigo: string } | null; entrega_en: { id: number; nombre: string } | null }[];
  productos: { id: number; sku: string; nombre: string; linea: Linea; tipo: string; unidad: string; precio: number | null; precio_pendiente: boolean; peso_caja_lb: number | null }[];
  plantillas: { id: number; nombre: string; codigo: string; linea: Linea; dia_semana: number; conductor: string; paradas: { ubicacion_id: number; nombre: string; orden: number; opcional: boolean }[] }[];
  calendario_pedidos: { ubicacion_id: number; linea: Linea; dia_semana: number; rutas: { id: number; nombre: string; codigo: string; conductor: string }[] }[];
  semanas: { id: number; anio: number; semana: number; inicia_at: string; termina_at: string; estado: string }[];
}
interface Pedido {
  id: number; linea: Linea; fecha_entrega: string; estado: string; actualizado_at: string; notas?: string | null;
  empresa: { id: number; nombre: string; codigo: string };
  ubicacion: { id: number; nombre: string; entrega_en: { id: number; nombre: string } | null };
  lineas: { id: number; product_id: number; nombre: string; sku: string; cantidad: number; precio: number | null }[];
}

function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
const usd = (n: number | null) => n == null ? 'Precio pendiente' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const esPieza = (p: { unidad: string }) => p.unidad.toLowerCase().includes('pieza');
const unidadCorta = (p: { unidad: string }) => esPieza(p) ? 'pzas' : 'cajas';
const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fechaEntregaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
interface EntregaOpcion {
  fecha: string;
  semana: number;
  rutas: Catalogo['calendario_pedidos'][number]['rutas'];
}
function entregasDeSemana(calendario: Catalogo['calendario_pedidos'], ubicacionId: string, linea: Linea, semana: SemanaSeleccionada): EntregaOpcion[] {
  const programadas = calendario.filter((c) => String(c.ubicacion_id) === ubicacionId && c.linea === linea);
  if (!programadas.length) return [];
  const resultado: EntregaOpcion[] = [];
  for (let iso = semana.inicio; iso <= semana.fin;) {
    const fecha = new Date(`${iso}T12:00:00`);
    const programa = programadas.find((c) => c.dia_semana === fecha.getDay());
    if (programa) resultado.push({ fecha: iso, semana: semana.numero, rutas: programa.rutas });
    fecha.setDate(fecha.getDate() + 1);
    iso = fecha.toLocaleDateString('en-CA');
  }
  return resultado;
}
interface ResultadoConfirmacion {
  confirmados: number;
  borradores_vacios: number;
  cobertura_bpm: { fecha: string; total: number; confirmados: number; pendientes: string[] }[];
  preparaciones?: { creadas: number; existentes: number; aprobadas: number };
}

export default function Pedidos({ integrado = false, semana = crearSemana() }: { integrado?: boolean; semana?: SemanaSeleccionada }) {
  const { usuario } = useAuth();
  const toast = useToast();
  const admin = usuario?.rol === 'admin';
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [linea, setLinea] = useState<Linea>('carne');
  const [ubicacionId, setUbicacionId] = useState('');
  const [fecha, setFecha] = useState('');
  const [fechaManual, setFechaManual] = useState(false);
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [notas, setNotas] = useState('');
  const [buscar, setBuscar] = useState('');
  const [vista, setVista] = useState<'captura' | 'historial' | 'consolidados'>('captura');
  const [modoCaptura, setModoCaptura] = useState<'semana' | 'individual'>('semana');
  const [historial, setHistorial] = useState<Pedido[]>([]);
  const [historialUbicacion, setHistorialUbicacion] = useState('todas');
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [cargandoPedido, setCargandoPedido] = useState(false);
  const [impresion, setImpresion] = useState<{ linea: Linea; inicio: string; fin: string; pedidos: Pedido[] } | null>(null);
  const [cargandoImpresion, setCargandoImpresion] = useState(false);
  const [estado, setEstado] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refrescoHistorial, setRefrescoHistorial] = useState(0);

  useEffect(() => {
    api<Catalogo>(`/operacion/catalogo?fecha_referencia=${semana.inicio}`).then((c) => {
      setCatalogo(c);
      const asignada = admin ? c.ubicaciones.find((u) => u.tipo === 'sucursal' && u.empresa) : c.ubicaciones.find((u) => usuario?.ubicaciones?.some((x) => x.id === u.id));
      if (asignada) setUbicacionId(String(asignada.id));
    }).catch(() => setError('No se pudo cargar el catálogo de pedidos.'));
  }, [admin, usuario, semana.inicio]);

  const ubicaciones = useMemo(() => {
    if (!catalogo) return [];
    const todas = catalogo.ubicaciones.filter((u) => u.tipo === 'sucursal' && u.empresa);
    return admin ? todas : todas.filter((u) => usuario?.ubicaciones?.some((x) => x.id === u.id));
  }, [catalogo, admin, usuario]);
  const ubicacionSeleccionada = ubicaciones.find((u) => String(u.id) === ubicacionId);
  const productos = useMemo(
    () => catalogo ? productosParaPedido(catalogo.productos, linea, ubicacionSeleccionada?.empresa?.codigo) : [],
    [catalogo, linea, ubicacionSeleccionada?.empresa?.codigo],
  );
  const entregas = useMemo(
    () => catalogo ? entregasDeSemana(catalogo.calendario_pedidos, ubicacionId, linea, semana) : [],
    [catalogo, ubicacionId, linea, semana.inicio, semana.fin],
  );
  const entregaSeleccionada = entregas.find((e) => e.fecha === fecha);

  useEffect(() => {
    setFechaManual(false);
    const proxima = entregas.find((e) => e.fecha >= hoy()) ?? entregas[0];
    setFecha(proxima?.fecha ?? '');
  }, [entregas, semana.inicio]);

  useEffect(() => {
    if (admin && semana.inicio < inicioDeSemana(hoy())) setVista('historial');
  }, [admin, semana.inicio]);

  useEffect(() => {
    if (vista !== 'captura' || (admin && modoCaptura === 'semana') || !ubicacionId || !fecha) {
      setEstado(null); setVersion(null); setNotas(''); setCantidades({}); setCargandoPedido(false);
      return;
    }
    let vigente = true;
    setCargandoPedido(true);
    setEstado(null); setVersion(null); setNotas(''); setCantidades({});
    setError('');
    api<Pedido[]>(`/operacion/pedidos?ubicacion_id=${ubicacionId}&linea=${linea}&desde=${fecha}&hasta=${fecha}`)
      .then((rows) => {
        if (!vigente) return;
        const p = rows[0];
        setEstado(p?.estado ?? null);
        setVersion(p?.actualizado_at ?? null);
        setNotas(p?.notas ?? '');
        const cargadas = Object.fromEntries((p?.lineas ?? []).map((l) => [l.product_id, String(l.cantidad)]));
        const pastorBpm = catalogo?.productos.find((x) => x.sku === 'MEAT-PASTOR-BPM');
        const pastorTap = catalogo?.productos.find((x) => x.sku === 'MEAT-PASTOR-TAP');
        const esTapatios = ubicacionSeleccionada?.empresa?.codigo === 'LBT';
        if (pastorBpm && pastorTap) {
          const origen = esTapatios ? pastorBpm.id : pastorTap.id;
          const destino = esTapatios ? pastorTap.id : pastorBpm.id;
          if (cargadas[origen] && !cargadas[destino]) cargadas[destino] = cargadas[origen];
          delete cargadas[origen];
        }
        setCantidades(cargadas);
      })
      .catch((e) => { if (vigente) setError(e instanceof ApiError ? e.message : 'No se pudo cargar el pedido.'); })
      .finally(() => { if (vigente) setCargandoPedido(false); });
    return () => { vigente = false; };
  }, [ubicacionId, linea, fecha, vista, modoCaptura, admin, catalogo, ubicacionSeleccionada?.empresa?.codigo]);

  useEffect(() => { setImpresion(null); }, [semana.inicio, semana.fin]);

  useEffect(() => {
    if (!admin || vista !== 'historial') return;
    setCargandoHistorial(true); setError('');
    api<Pedido[]>(`/operacion/pedidos?linea=${linea}&desde=${semana.inicio}&hasta=${semana.fin}`)
      .then(setHistorial)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el historial.'))
      .finally(() => setCargandoHistorial(false));
  }, [admin, vista, semana.inicio, semana.fin, linea, refrescoHistorial]);

  async function guardar(confirmar: boolean) {
    if (!ubicacionId) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ estado: string; actualizado_at: string } | Encolado>('/operacion/pedidos', {
        method: 'PUT',
        body: { ubicacion_id: Number(ubicacionId), linea, fecha_entrega: fecha, actualizado_at: version, confirmar, notas: notas.trim() || null, lineas: productos.map((p) => ({ product_id: p.id, cantidad: Number(cantidades[p.id] || 0) })) },
      });
      if (fueEncolado(r)) {
        toast.ok('Venta guardada sin conexión; se enviará automáticamente al recuperar la red.');
        return;
      }
      setEstado(r.estado);
      setVersion(r.actualizado_at);
      toast.ok(confirmar ? 'Pedido confirmado.' : 'Avance guardado.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }

  async function abrirImpresion(lineaObjetivo: Linea) {
    setCargandoImpresion(true); setError('');
    try {
      const rows = await api<Pedido[]>(`/operacion/pedidos?linea=${lineaObjetivo}&desde=${semana.inicio}&hasta=${semana.fin}`);
      setImpresion({ linea: lineaObjetivo, inicio: semana.inicio, fin: semana.fin, pedidos: rows.filter((p) => !['borrador', 'cancelado'].includes(p.estado)) });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo preparar la orden para imprimir.'); }
    finally { setCargandoImpresion(false); }
  }

  async function confirmarTodos(desde: string, hasta: string) {
    setBusy(true); setError('');
    try {
      const r = await api<ResultadoConfirmacion>('/operacion/pedidos/confirmar-todos', {
        method: 'POST', body: { linea, desde, hasta },
      });
      const pendientes = r.cobertura_bpm.flatMap((c) => c.pendientes.map((nombre) => `${c.fecha}: ${nombre}`));
      const detalle = pendientes.length ? ` · BPM pendiente: ${pendientes.slice(0, 3).join(', ')}${pendientes.length > 3 ? ` y ${pendientes.length - 3} más` : ''}` : ' · BPM completo';
      const preparaciones = r.preparaciones?.aprobadas ? ` · ${r.preparaciones.aprobadas} consolidados listos` : '';
      toast.ok(`${r.confirmados} ventas confirmadas${r.borradores_vacios ? ` · ${r.borradores_vacios} borradores vacíos omitidos` : ''}${detalle}${preparaciones}`);
      setRefrescoHistorial((n) => n + 1);
      if (desde === hasta && ubicacionId) {
        const rows = await api<Pedido[]>(`/operacion/pedidos?ubicacion_id=${ubicacionId}&linea=${linea}&desde=${desde}&hasta=${hasta}`);
        setEstado(rows[0]?.estado ?? null);
      }
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudieron confirmar los pedidos.'); }
    finally { setBusy(false); }
  }

  if (!catalogo) return <div className="page"><Spinner /><p className="error-msg">{error}</p></div>;
  const ubic = ubicacionSeleccionada;
  const total = productos.reduce((a, p) => a + Number(cantidades[p.id] || 0) * (p.precio ?? 0), 0);
  const unidades = productos.reduce((a, p) => a + Number(cantidades[p.id] || 0), 0);
  const conCantidad = productos.filter((p) => Number(cantidades[p.id] || 0) > 0).length;
  const semanaCerrada = catalogo.semanas.some((s) => s.anio === semana.anio && s.semana === semana.numero && s.estado === 'cerrada');
  const editable = !semanaCerrada && (!estado || ['borrador', 'confirmado'].includes(estado));
  const q = buscar.trim().toLowerCase();
  const visibles = productos.filter((p) => !q || `${nombreEnVenta(p.sku, p.nombre, linea)} ${p.tipo}`.toLowerCase().includes(q));
  const capturaSemanal = admin && modoCaptura === 'semana';
  return (
    <div className={integrado ? 'order-page order-embedded' : 'page order-page'}>
      {!integrado && <header className="page-head operation-page-head"><div><span className="eyebrow">Ventas</span><h1>Venta semanal</h1></div>{vista === 'captura' && !capturaSemanal && estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      {integrado && <header className="embedded-head embedded-head--status"><div><span className="eyebrow">Paso 3</span><h2>Ventas</h2></div>{vista === 'captura' && !capturaSemanal && estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      <div className="order-switches">
        {admin && <div className="segmented order-view-switch"><button className={vista === 'captura' ? 'tab tab--on' : 'tab'} onClick={() => setVista('captura')}>Capturar</button><button className={vista === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setVista('historial')}>Historial por sucursal</button><button className={vista === 'consolidados' ? 'tab tab--on' : 'tab'} onClick={() => setVista('consolidados')}>Consolidados</button></div>}
        {vista !== 'consolidados' && <div className="segmented order-line-switch">
        <button className={linea === 'carne' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('carne')}>Carne</button>
        <button className={linea === 'desechables' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('desechables')}>Desechables</button>
        </div>}
      </div>
      {admin && vista === 'captura' && <section className="workspace-card weekly-capture-mode">
        <div><span className="eyebrow">Forma de captura</span><strong>{capturaSemanal ? 'Toda la semana' : 'Una orden'}</strong><small>{capturaSemanal ? 'Todos los días programados por restaurante, en una sola vista.' : 'Captura o corrige una sucursal y fecha específica.'}</small></div>
        <div className="segmented segmented--small"><button className={capturaSemanal ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setModoCaptura('semana')}>Semana completa</button><button className={!capturaSemanal ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setModoCaptura('individual')}>Orden individual</button></div>
      </section>}
      {error && <p className="error-msg">{error}</p>}
      {vista === 'consolidados' ? <Distribucion integrado semana={semana} soloRevision /> : vista === 'captura' ? capturaSemanal ? <CapturaSemanalPedidos catalogo={catalogo} linea={linea} semana={semana} ubicaciones={ubicaciones} semanaCerrada={semanaCerrada} onActualizado={() => setRefrescoHistorial((n) => n + 1)} /> : <div className="order-workspace">
        <section className="order-capture">
          <div className="workspace-card order-context">
            <label className="field field--wide"><span>Restaurante</span><select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.empresa?.nombre}</option>)}</select></label>
            <label className="field order-delivery-field"><span className="order-delivery-label">Entrega de semana {semana.numero}{admin && <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); setFechaManual((actual) => { if (actual && entregas[0]) setFecha(entregas[0].fecha); return !actual; }); }}>{fechaManual ? 'Usar ruta programada' : 'Fecha excepcional'}</button>}</span>{fechaManual ? <input type="date" min={semana.inicio} max={semana.fin} value={fecha} onChange={(e) => setFecha(e.target.value)} /> : <select value={fecha} disabled={!entregas.length} onChange={(e) => setFecha(e.target.value)}>{!entregas.length && <option value="">Sin entrega configurada</option>}{entregas.map((e) => <option key={e.fecha} value={e.fecha}>{fechaEntregaCorta(e.fecha)}</option>)}</select>}<small className="order-delivery-hint">{fechaManual ? 'Fecha excepcional dentro de la semana seleccionada.' : entregaSeleccionada ? `${entregaSeleccionada.rutas.map((r) => r.nombre).join(' / ')} · ${[...new Set(entregaSeleccionada.rutas.map((r) => r.conductor))].join(', ')}` : 'Este restaurante no aparece en una ruta activa para esta línea.'}</small></label>
          </div>
          {ubic?.entrega_en && <p className="notice">Se factura a <strong>{ubic.nombre}</strong> y se entrega físicamente en <strong>{ubic.entrega_en.nombre}</strong>.</p>}
          {semanaCerrada && <p className="notice notice--warning">La semana {semana.numero} está cerrada y esta venta se muestra en modo consulta.</p>}
          {!semanaCerrada && !cargandoPedido && !editable && <p className="notice notice--warning">Esta venta ya fue consolidada. Para corregirla, abre Consolidados y elimina el consolidado; la venta volverá a estado confirmado.</p>}
          <CollapsibleSection title="Productos" count={productos.length} className="product-picker">
            <div className="workspace-card-head"><div /><input className="compact-search" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar" /></div>
            <div className="order-product-list">{visibles.map((p) => <label key={p.id} className={`order-product ${Number(cantidades[p.id] || 0) > 0 ? 'has-quantity' : ''}`}>
              <span><strong>{nombreEnVenta(p.sku, p.nombre, linea)}</strong><small>{p.peso_caja_lb ? `Caja terminada de ${p.peso_caja_lb} lb` : p.unidad} · {p.precio_pendiente ? 'Costo semanal + $15 al capturar producción' : usd(p.precio)}</small></span>
              <div className="input-suffix input-suffix--compact"><input disabled={cargandoPedido || !editable} inputMode="decimal" type="number" min="0" step={esPieza(p) ? '1' : '0.5'} value={cantidades[p.id] ?? ''} placeholder="0" onChange={(e) => setCantidades({ ...cantidades, [p.id]: e.target.value })} /><span>{unidadCorta(p)}</span></div>
            </label>)}</div>
          </CollapsibleSection>
          <label className="workspace-card field order-notes"><span>Notas de la venta <em>opcional</em></span><textarea disabled={cargandoPedido || !editable} rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Instrucciones especiales, sustituciones o entrega…" /></label>
        </section>
        <aside className="order-summary">
          <span className="eyebrow">Resumen de venta</span><h2>{ubic?.nombre ?? 'Selecciona restaurante'}</h2><p>{fecha ? `Semana ${semana.numero} · ${fechaLarga(fecha)}` : 'Sin entrega programada'} · {linea}</p>
          <dl><div><dt>Productos</dt><dd>{conCantidad}</dd></div><div><dt>Unidades</dt><dd>{unidades.toLocaleString('es-MX')}</dd></div><div><dt>Total</dt><dd>{usd(total)}</dd></div></dl>
          <div className="order-actions"><button className="btn btn-secondary" disabled={busy || cargandoPedido || !editable || !ubicacionId || !fecha} onClick={() => void guardar(false)}>Guardar</button><button className="btn btn-primary" disabled={busy || cargandoPedido || !editable || !ubicacionId || !fecha || unidades <= 0} onClick={() => void guardar(true)}>{busy ? 'Guardando…' : cargandoPedido ? 'Cargando…' : 'Confirmar'}</button></div>
          {admin && <button className="btn btn-secondary btn-block order-confirm-all" disabled={semanaCerrada || busy || !fecha} onClick={() => void confirmarTodos(fecha, fecha)}>Confirmar todos de esta fecha</button>}
          {admin && <div className="order-print-actions"><span>Orden de semana {semana.numero}</span><button className="btn btn-secondary btn-block" disabled={cargandoImpresion} onClick={() => void abrirImpresion('carne')}>Imprimir carne</button><button className="btn btn-secondary btn-block" disabled={cargandoImpresion} onClick={() => void abrirImpresion('desechables')}>Imprimir desechables</button></div>}
        </aside>
      </div> : <HistorialPedidos pedidos={historial} cargando={cargandoHistorial} linea={linea} semana={semana} ubicacion={historialUbicacion} setUbicacion={setHistorialUbicacion} ubicaciones={ubicaciones} onPrint={() => void abrirImpresion(linea)} onConfirmar={() => void confirmarTodos(semana.inicio, semana.fin)} confirmando={busy || semanaCerrada} />}
      {impresion && <OrdenImprimible datos={impresion} catalogo={catalogo} onClose={() => setImpresion(null)} />}
    </div>
  );
}

const clavePedidoSemanal = (ubicacionId: number, fechaEntrega: string) => `${ubicacionId}|${fechaEntrega}`;
const claveCantidadSemanal = (ubicacionId: number, fechaEntrega: string, productId: number) => `${ubicacionId}|${fechaEntrega}|${productId}`;
const pedidoEditable = (pedido?: Pedido) => !pedido || ['borrador', 'confirmado'].includes(pedido.estado);
const abreviaturasUbicacion: Record<string, string> = {
  LOMBA: 'LO', NAPER: 'NA', CAROL: 'CS', LISLE: 'LI', GLEND: 'GH', WESTC: 'WEST', BATAV: 'BT', ALGON: 'AL',
  NAPER2: 'N2', ROLLI: 'RM', SCHAU: 'SC', CRYST: 'CRY-L', LAKEZ: 'LZ', FRANK: 'FR', PLAIN: 'PL', AUROR: 'AUR',
  TGE: 'T-GE', TLO: 'T-LO', TST: 'T-ST', TNA: 'T-NA', TBO: 'T-BO',
};
const abreviaturaUbicacion = (ubicacion: Catalogo['ubicaciones'][number]) => abreviaturasUbicacion[ubicacion.codigo] ?? ubicacion.codigo.slice(0, 5).toUpperCase();
function CapturaSemanalPedidos({ catalogo, linea, semana, ubicaciones, semanaCerrada, onActualizado }: {
  catalogo: Catalogo;
  linea: Linea;
  semana: SemanaSeleccionada;
  ubicaciones: Catalogo['ubicaciones'];
  semanaCerrada: boolean;
  onActualizado: () => void;
}) {
  const toast = useToast();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [cantidadesGuardadas, setCantidadesGuardadas] = useState<Record<string, string>>({});
  const [cambios, setCambios] = useState<string[]>([]);
  const [historialCambios, setHistorialCambios] = useState<{ clave: string; anterior: string | undefined }[][]>([]);
  const [buscar, setBuscar] = useState('');
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresco, setRefresco] = useState(0);
  const [herramientas, setHerramientas] = useState(false);
  const [fechaHerramienta, setFechaHerramienta] = useState('todas');
  const [ubicacionHerramienta, setUbicacionHerramienta] = useState('todas');
  const [productoHerramienta, setProductoHerramienta] = useState('todos');
  const restauradoRef = useRef<string | null>(null);

  const programadas = useMemo(() => ubicaciones.map((ubicacion) => ({
    ubicacion,
    entregas: entregasDeSemana(catalogo.calendario_pedidos, String(ubicacion.id), linea, semana),
    productos: productosParaPedido(catalogo.productos, linea, ubicacion.empresa?.codigo),
  })).filter((fila) => fila.entregas.length > 0), [ubicaciones, catalogo, linea, semana.inicio, semana.fin]);
  const claveBorrador = `bpm-borrador-ventas:${semana.inicio}:${linea}`;
  useUnsavedChanges(cambios.length > 0);

  useEffect(() => {
    let vigente = true;
    setCargando(true); setError('');
    api<Pedido[]>(`/operacion/pedidos?linea=${linea}&desde=${semana.inicio}&hasta=${semana.fin}`)
      .then((rows) => {
        if (!vigente) return;
        const valores: Record<string, string> = {};
        for (const pedido of rows) {
          const fila = programadas.find((x) => x.ubicacion.id === pedido.ubicacion.id);
          if (!fila) continue;
          const porSku = new Map(fila.productos.map((p) => [p.sku, p.id]));
          for (const detalle of pedido.lineas) {
            let productId = detalle.product_id;
            if (detalle.sku === 'MEAT-PASTOR-BPM' && fila.ubicacion.empresa?.codigo === 'LBT') productId = porSku.get('MEAT-PASTOR-TAP') ?? productId;
            if (detalle.sku === 'MEAT-PASTOR-TAP' && fila.ubicacion.empresa?.codigo !== 'LBT') productId = porSku.get('MEAT-PASTOR-BPM') ?? productId;
            valores[claveCantidadSemanal(pedido.ubicacion.id, pedido.fecha_entrega, productId)] = String(detalle.cantidad);
          }
        }
        setPedidos(rows);
        setCantidadesGuardadas(valores);
        const borrador = leerBorradorLocal<{ cantidades: Record<string, string>; cambios: string[] }>(claveBorrador);
        if (borrador?.valor.cambios.length && restauradoRef.current !== claveBorrador) {
          setCantidades(borrador.valor.cantidades);
          setCambios(borrador.valor.cambios);
          restauradoRef.current = claveBorrador;
        } else {
          setCantidades(valores);
          setCambios([]);
        }
        setHistorialCambios([]);
      })
      .catch((e) => { if (vigente) setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las ventas de la semana.'); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [linea, semana.inicio, semana.fin, refresco, programadas, claveBorrador]);

  useEffect(() => {
    if (cargando) return;
    guardarBorradorLocal(claveBorrador, cambios.length ? { cantidades, cambios } : null);
  }, [claveBorrador, cantidades, cambios, cargando]);

  const porClave = useMemo(() => new Map(pedidos.map((p) => [clavePedidoSemanal(p.ubicacion.id, p.fecha_entrega), p])), [pedidos]);
  const filtro = buscar.trim().toLowerCase();
  const visibles = programadas.filter(({ ubicacion }) => !filtro || `${ubicacion.nombre} ${ubicacion.empresa?.nombre ?? ''}`.toLowerCase().includes(filtro));
  const unidades = programadas.reduce((total, fila) => total + fila.entregas.reduce((subtotal, entrega) => subtotal + fila.productos.reduce(
    (suma, producto) => suma + Number(cantidades[claveCantidadSemanal(fila.ubicacion.id, entrega.fecha, producto.id)] || 0), 0,
  ), 0), 0);
  const importe = programadas.reduce((total, fila) => total + fila.entregas.reduce((subtotal, entrega) => subtotal + fila.productos.reduce(
    (suma, producto) => suma + Number(cantidades[claveCantidadSemanal(fila.ubicacion.id, entrega.fecha, producto.id)] || 0) * (producto.precio ?? 0), 0,
  ), 0), 0);
  const ventasCapturadas = programadas.flatMap((fila) => fila.entregas.map((entrega) => porClave.get(clavePedidoSemanal(fila.ubicacion.id, entrega.fecha)))).filter((p) => p?.lineas.length).length;
  const fechasVisibles = [...new Set(visibles.flatMap((fila) => fila.entregas.map((entrega) => entrega.fecha)))].sort();
  const filasFormato = filasOrden(linea, catalogo.productos);

  function pedidosModificados(valores: Record<string, string>) {
    const modificados: string[] = [];
    for (const fila of programadas) for (const entrega of fila.entregas) {
      const cambio = fila.productos.some((producto) => {
        const clave = claveCantidadSemanal(fila.ubicacion.id, entrega.fecha, producto.id);
        return Number(valores[clave] || 0) !== Number(cantidadesGuardadas[clave] || 0);
      });
      if (cambio) modificados.push(clavePedidoSemanal(fila.ubicacion.id, entrega.fecha));
    }
    return modificados;
  }

  function aplicarValores(entradas: { clave: string; valor: string }[]) {
    if (!entradas.length) return;
    const siguientes = { ...cantidades };
    const reversa: { clave: string; anterior: string | undefined }[] = [];
    for (const entrada of entradas) {
      if ((siguientes[entrada.clave] ?? '') === entrada.valor) continue;
      reversa.push({ clave: entrada.clave, anterior: siguientes[entrada.clave] });
      siguientes[entrada.clave] = entrada.valor;
    }
    if (!reversa.length) return;
    setCantidades(siguientes);
    setHistorialCambios((historial) => [...historial.slice(-49), reversa]);
    setCambios(pedidosModificados(siguientes));
  }

  function cambiarCantidad(ubicacionId: number, fechaEntrega: string, productId: number, valor: string) {
    aplicarValores([{ clave: claveCantidadSemanal(ubicacionId, fechaEntrega, productId), valor }]);
  }

  function deshacer() {
    const ultimo = historialCambios.at(-1);
    if (!ultimo) return;
    const siguientes = { ...cantidades };
    for (const cambio of ultimo) {
      if (cambio.anterior === undefined) delete siguientes[cambio.clave];
      else siguientes[cambio.clave] = cambio.anterior;
    }
    setCantidades(siguientes);
    setCambios(pedidosModificados(siguientes));
    setHistorialCambios((historial) => historial.slice(0, -1));
  }

  function clavesDeHerramienta() {
    const formato = filasFormato.find((fila) => fila.nombre === productoHerramienta);
    const claves: string[] = [];
    for (const fila of programadas) {
      if (ubicacionHerramienta !== 'todas' && fila.ubicacion.id !== Number(ubicacionHerramienta)) continue;
      for (const entrega of fila.entregas) {
        if (fechaHerramienta !== 'todas' && entrega.fecha !== fechaHerramienta) continue;
        const pedido = porClave.get(clavePedidoSemanal(fila.ubicacion.id, entrega.fecha));
        if (!pedidoEditable(pedido)) continue;
        for (const producto of fila.productos) {
          if (formato && !formato.skus.includes(producto.sku)) continue;
          claves.push(claveCantidadSemanal(fila.ubicacion.id, entrega.fecha, producto.id));
        }
      }
    }
    return claves;
  }

  function limpiarAlcance() {
    aplicarValores(clavesDeHerramienta().map((clave) => ({ clave, valor: '' })));
  }

  function restaurarAlcance() {
    aplicarValores(clavesDeHerramienta().map((clave) => ({ clave, valor: cantidadesGuardadas[clave] ?? '' })));
  }

  async function reabrirConsolidados() {
    const fechas = fechaHerramienta === 'todas'
      ? [...new Set(programadas.flatMap((fila) => fila.entregas.map((entrega) => entrega.fecha)))]
      : [fechaHerramienta];
    if (!window.confirm(`Se reabrirán los consolidados de ${linea} de ${fechas.length} fecha${fechas.length === 1 ? '' : 's'} y se revertirá su inventario para permitir correcciones. ¿Continuar?`)) return;
    setBusy(true); setError('');
    try {
      const resultado = await api<{ eliminados: number }>('/operacion/pedidos/reabrir-consolidados', { method: 'POST', body: { linea, fechas } });
      setRefresco((actual) => actual + 1);
      toast.ok(`${resultado.eliminados} consolidado${resultado.eliminados === 1 ? '' : 's'} reabierto${resultado.eliminados === 1 ? '' : 's'}. Ya puedes limpiar o corregir las ventas.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudieron reabrir los consolidados.'); }
    finally { setBusy(false); }
  }

  function pegarMatriz(
    evento: ReactClipboardEvent<HTMLInputElement>,
    fechaEntrega: string,
    filaInicio: number,
    columnaInicio: number,
    filas: { productos: (Catalogo['productos'][number] | undefined)[] }[],
    restaurantes: typeof programadas,
  ) {
    const textoPegado = evento.clipboardData.getData('text/plain');
    if (!textoPegado.includes('\t') && !textoPegado.includes('\n')) return;
    evento.preventDefault();
    const matriz = textoPegado.trim().split(/\r?\n/).map((renglon) => renglon.split('\t'));
    const entradas: { clave: string; valor: string }[] = [];
    for (const [desplazamientoFila, renglon] of matriz.entries()) {
      const fila = filas[filaInicio + desplazamientoFila];
      if (!fila) break;
      for (const [desplazamientoColumna, crudo] of renglon.entries()) {
        const columna = columnaInicio + desplazamientoColumna;
        const restaurante = restaurantes[columna];
        const producto = fila.productos[columna];
        const pedido = restaurante ? porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega)) : undefined;
        if (!restaurante || !producto || !pedidoEditable(pedido)) continue;
        const limpio = crudo.trim().replace(/[$,]/g, '');
        if (limpio !== '' && (!Number.isFinite(Number(limpio)) || Number(limpio) < 0)) continue;
        entradas.push({ clave: claveCantidadSemanal(restaurante.ubicacion.id, fechaEntrega, producto.id), valor: limpio });
      }
    }
    aplicarValores(entradas);
  }

  function navegarConEnter(evento: ReactKeyboardEvent<HTMLInputElement>) {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    const celdas = [...document.querySelectorAll<HTMLInputElement>('input[data-weekly-matrix-input]:not(:disabled)')]
      .sort((a, b) => Number(a.dataset.navOrder) - Number(b.dataset.navOrder));
    const actual = celdas.indexOf(evento.currentTarget);
    const siguiente = celdas[actual + (evento.shiftKey ? -1 : 1)];
    if (siguiente) { siguiente.focus(); siguiente.select(); }
  }

  async function guardarSemana(confirmar: boolean) {
    const objetivos = new Set(cambios);
    if (confirmar) {
      for (const fila of programadas) for (const entrega of fila.entregas) {
        const clave = clavePedidoSemanal(fila.ubicacion.id, entrega.fecha);
        const existente = porClave.get(clave);
        if (existente?.estado === 'borrador' && existente.lineas.length > 0) objetivos.add(clave);
      }
    }

    const payload = [...objetivos].flatMap((clave) => {
      const [ubicacionRaw, fechaEntrega] = clave.split('|');
      const fila = programadas.find((x) => x.ubicacion.id === Number(ubicacionRaw) && x.entregas.some((e) => e.fecha === fechaEntrega));
      if (!fila) return [];
      const existente = porClave.get(clave);
      if (!pedidoEditable(existente)) return [];
      const lineas = fila.productos.map((producto) => ({
        product_id: producto.id,
        cantidad: Number(cantidades[claveCantidadSemanal(fila.ubicacion.id, fechaEntrega, producto.id)] || 0),
      }));
      if (!existente && !lineas.some((l) => l.cantidad > 0)) return [];
      return [{
        ubicacion_id: fila.ubicacion.id,
        linea,
        fecha_entrega: fechaEntrega,
        actualizado_at: existente?.actualizado_at ?? null,
        confirmar,
        notas: existente?.notas ?? null,
        lineas,
      }];
    });

    if (!payload.length) {
      setCambios([]);
      if (confirmar) {
        setBusy(true); setError('');
        try {
          const avance = await api<ResultadoConfirmacion>('/operacion/pedidos/confirmar-todos', { method: 'POST', body: { linea, desde: semana.inicio, hasta: semana.fin } });
          const faltantes = avance.cobertura_bpm.flatMap((c) => c.pendientes);
          toast.ok(faltantes.length ? `Faltan ${faltantes.length} pedidos BPM antes de consolidar.` : `${avance.preparaciones?.aprobadas ?? 0} consolidados listos.`);
          setRefresco((n) => n + 1); onActualizado();
        } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo completar la semana.'); }
        finally { setBusy(false); }
      } else toast.ok('No hay cambios con cantidades para guardar.');
      return;
    }

    setBusy(true); setError('');
    try {
      const resultado = await api<{ guardados: number; confirmados: number; borradores: number } | Encolado>('/operacion/pedidos/semana', {
        method: 'PUT', body: { pedidos: payload },
      });
      if (fueEncolado(resultado)) {
        setCambios([]);
        setHistorialCambios([]);
        guardarBorradorLocal(claveBorrador, null);
        restauradoRef.current = claveBorrador;
        toast.ok('Semana guardada sin conexión; se enviará automáticamente al recuperar la red.');
        return;
      }
      if (confirmar) {
        const avance = await api<ResultadoConfirmacion>('/operacion/pedidos/confirmar-todos', {
          method: 'POST', body: { linea, desde: semana.inicio, hasta: semana.fin },
        });
        const faltantes = avance.cobertura_bpm.flatMap((c) => c.pendientes);
        const preparadas = avance.preparaciones?.aprobadas ?? 0;
        toast.ok(faltantes.length
          ? `${resultado.guardados} ventas guardadas · faltan ${faltantes.length} pedidos BPM antes de consolidar.`
          : `${resultado.guardados} ventas confirmadas${preparadas ? ` · ${preparadas} consolidados listos` : ''}.`);
      } else {
        toast.ok(`${resultado.guardados} ventas actualizadas.`);
      }
      setCambios([]);
      setHistorialCambios([]);
      guardarBorradorLocal(claveBorrador, null);
      restauradoRef.current = claveBorrador;
      setRefresco((n) => n + 1);
      onActualizado();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la semana. Ninguna venta fue modificada.'); }
    finally { setBusy(false); }
  }

  return <div className="weekly-sales-capture">
    <section className="workspace-card weekly-sales-toolbar">
      <div><span className="eyebrow">Semana {semana.numero}</span><h2>Pedidos por restaurante</h2><p>{etiquetaRango(semana)}</p></div>
      <label className="field"><span>Buscar restaurante</span><input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre o empresa" /></label>
      <div className="weekly-sales-toolbar-actions"><button className="btn btn-ghost" disabled={!historialCambios.length || busy} onClick={deshacer}>Deshacer</button><button className="btn btn-secondary" disabled={cargando || busy || semanaCerrada} onClick={() => setHerramientas((actual) => !actual)}>Herramientas</button><button className="btn btn-secondary" disabled={cargando || busy || semanaCerrada || cambios.length === 0} onClick={() => void guardarSemana(false)}>Guardar cambios</button><button className="btn btn-primary" disabled={cargando || busy || semanaCerrada} onClick={() => void guardarSemana(true)}>{busy ? 'Guardando…' : 'Guardar y confirmar'}</button></div>
    </section>
    {herramientas && <section className="workspace-card weekly-sales-tools">
      <div><span className="eyebrow">Acciones masivas</span><strong>Elige qué parte de la cuadrícula quieres modificar</strong></div>
      <label className="field"><span>Fecha</span><select value={fechaHerramienta} onChange={(e) => setFechaHerramienta(e.target.value)}><option value="todas">Toda la semana</option>{[...new Set(programadas.flatMap((fila) => fila.entregas.map((entrega) => entrega.fecha)))].sort().map((fechaEntrega) => <option value={fechaEntrega} key={fechaEntrega}>{fechaLarga(fechaEntrega)}</option>)}</select></label>
      <label className="field"><span>Restaurante</span><select value={ubicacionHerramienta} onChange={(e) => setUbicacionHerramienta(e.target.value)}><option value="todas">Todos</option>{programadas.map((fila) => <option value={fila.ubicacion.id} key={fila.ubicacion.id}>{fila.ubicacion.nombre}</option>)}</select></label>
      <label className="field"><span>Producto</span><select value={productoHerramienta} onChange={(e) => setProductoHerramienta(e.target.value)}><option value="todos">Todos</option>{filasFormato.map((fila) => <option value={fila.nombre} key={fila.nombre}>{fila.nombre}</option>)}</select></label>
      <div className="weekly-sales-tools__actions"><button className="btn btn-secondary" disabled={busy} onClick={restaurarAlcance}>Restaurar guardado</button><button className="btn btn-danger-ghost" disabled={busy} onClick={limpiarAlcance}>Limpiar selección</button><button className="btn btn-secondary" disabled={busy} onClick={() => void reabrirConsolidados()}>Reabrir consolidados</button></div>
      <small>Puedes pegar un bloque copiado de Excel directamente sobre cualquier celda. Las filas y columnas se llenarán desde ese punto.</small>
    </section>}
    {error && <p className="error-msg">{error}</p>}
    {semanaCerrada && <p className="notice notice--warning">La semana {semana.numero} está cerrada. Reábrela para corregir sus ventas.</p>}
    <div className="metric-strip metric-strip--four"><div><span>Restaurantes</span><strong>{programadas.length}</strong></div><div><span>Ventas capturadas</span><strong>{ventasCapturadas}</strong></div><div><span>Unidades</span><strong>{unidades.toLocaleString('es-MX')}</strong></div><div><span>Importe</span><strong>{usd(importe)}</strong></div></div>
    {cargando ? <Spinner label="Cargando semana…" /> : <div className="weekly-sales-sheets">{fechasVisibles.map((fechaEntrega, fechaIndice) => {
      const restaurantes = visibles.filter((fila) => fila.entregas.some((entrega) => entrega.fecha === fechaEntrega));
      const filas = filasFormato.map((formato) => ({
        formato,
        productos: restaurantes.map((restaurante) => restaurante.productos.find((producto) => formato.skus.includes(producto.sku))),
      })).filter((fila) => fila.productos.some(Boolean));
      const totalRestaurante = (indice: number) => filas.reduce((total, fila) => {
        const producto = fila.productos[indice];
        return total + (producto ? Number(cantidades[claveCantidadSemanal(restaurantes[indice].ubicacion.id, fechaEntrega, producto.id)] || 0) : 0);
      }, 0);
      const totalDia = restaurantes.reduce((total, _, indice) => total + totalRestaurante(indice), 0);
      const confirmadas = restaurantes.filter((restaurante) => porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega))?.estado === 'confirmado').length;
      return <CollapsibleSection title={fechaLarga(fechaEntrega)} count={`${confirmadas}/${restaurantes.length}`} summary={`${totalDia.toLocaleString('es-MX')} unidades`} className="weekly-sales-sheet" key={fechaEntrega}>
        <div className="weekly-sales-matrix-wrap"><table className="weekly-sales-matrix">
          <thead><tr><th>Total</th><th>Item</th>{restaurantes.map((restaurante) => {
            const pedido = porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega));
            return <th key={restaurante.ubicacion.id} title={`${restaurante.ubicacion.nombre} · ${pedido?.estado.replaceAll('_', ' ') ?? 'sin capturar'}`}><strong>{abreviaturaUbicacion(restaurante.ubicacion)}</strong><small>{restaurante.ubicacion.nombre}</small><i className={`matrix-status matrix-status--${pedido?.estado ?? 'pendiente'}`} /></th>;
          })}</tr></thead>
          <tbody>{filas.map((fila, filaIndice) => {
            const totalProducto = fila.productos.reduce((total, producto, indice) => total + (producto ? Number(cantidades[claveCantidadSemanal(restaurantes[indice].ubicacion.id, fechaEntrega, producto.id)] || 0) : 0), 0);
            return <tr key={fila.formato.nombre}><th>{totalProducto.toLocaleString('es-MX')}</th><th>{fila.formato.nombre}</th>{fila.productos.map((producto, indice) => {
              const restaurante = restaurantes[indice];
              const pedido = porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega));
              if (!producto) return <td key={restaurante.ubicacion.id} className="matrix-cell-empty">—</td>;
              const clave = claveCantidadSemanal(restaurante.ubicacion.id, fechaEntrega, producto.id);
              const modificada = Number(cantidades[clave] || 0) !== Number(cantidadesGuardadas[clave] || 0);
              return <td key={restaurante.ubicacion.id} className={`${!pedidoEditable(pedido) ? 'matrix-cell-locked' : ''} ${modificada ? 'matrix-cell-dirty' : ''}`}><input data-weekly-matrix-input data-nav-order={fechaIndice * 10000 + indice * 100 + filaIndice} aria-label={`${fila.formato.nombre} · ${restaurante.ubicacion.nombre} · ${fechaEntregaCorta(fechaEntrega)}`} title={`${restaurante.ubicacion.nombre} · ${fila.formato.nombre}`} disabled={semanaCerrada || !pedidoEditable(pedido)} inputMode="decimal" type="number" min="0" step={esPieza(producto) ? '1' : '0.5'} value={cantidades[clave] ?? ''} placeholder="0" onPaste={(e) => pegarMatriz(e, fechaEntrega, filaIndice, indice, filas, restaurantes)} onKeyDown={navegarConEnter} onChange={(e) => cambiarCantidad(restaurante.ubicacion.id, fechaEntrega, producto.id, e.target.value)} /></td>;
            })}</tr>;
          })}</tbody>
          <tfoot><tr><th>{totalDia.toLocaleString('es-MX')}</th><th>Total</th>{restaurantes.map((restaurante, indice) => <th key={restaurante.ubicacion.id}>{totalRestaurante(indice).toLocaleString('es-MX')}</th>)}</tr></tfoot>
        </table></div>
      </CollapsibleSection>;
    })}</div>}
    {!cargando && !visibles.length && <div className="empty-state"><strong>No hay restaurantes programados</strong><span>Revisa la línea seleccionada, la búsqueda o la configuración de rutas.</span></div>}
    {!semanaCerrada && cambios.length > 0 && <div className="weekly-sales-savebar"><span><strong>{cambios.length}</strong> ventas con cambios sin guardar</span><div><button className="btn btn-secondary" disabled={busy} onClick={() => void guardarSemana(false)}>Guardar</button><button className="btn btn-primary" disabled={busy} onClick={() => void guardarSemana(true)}>Guardar y confirmar</button></div></div>}
  </div>;
}

function HistorialPedidos({ pedidos, cargando, linea, semana, ubicacion, setUbicacion, ubicaciones, onPrint, onConfirmar, confirmando }: {
  pedidos: Pedido[]; cargando: boolean; linea: Linea; semana: SemanaSeleccionada; ubicacion: string; setUbicacion: (v: string) => void;
  ubicaciones: Catalogo['ubicaciones']; onPrint: () => void; onConfirmar: () => void; confirmando: boolean;
}) {
  const filtrados = pedidos.filter((p) => ubicacion === 'todas' || String(p.ubicacion.id) === ubicacion);
  const fechas = [...new Set(filtrados.map((p) => p.fecha_entrega))].sort();
  const unidades = filtrados.flatMap((p) => p.lineas).reduce((a, l) => a + l.cantidad, 0);
  const total = filtrados.flatMap((p) => p.lineas).reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  return <div className="order-history">
    <section className="workspace-card history-toolbar history-toolbar--global">
      <div><span className="eyebrow">Periodo general</span><h2>Semana {semana.numero}</h2><p>{etiquetaRango(semana)}</p></div>
      <label className="field"><span>Sucursal</span><select value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}><option value="todas">Todas las sucursales</option>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>
      <div className="history-primary-actions"><button className="btn btn-secondary" disabled={cargando || confirmando} onClick={onConfirmar}>{confirmando ? 'Confirmando…' : 'Confirmar todos'}</button><button className="btn btn-primary" disabled={cargando || !pedidos.length} onClick={onPrint}>Imprimir por ruta</button></div>
    </section>
    {cargando ? <Spinner label="Cargando pedidos…" /> : <>
      <div className="metric-strip metric-strip--four"><div><span>Sucursales</span><strong>{new Set(filtrados.map((p) => p.ubicacion.id)).size}</strong></div><div><span>Ventas</span><strong>{filtrados.length}</strong></div><div><span>Unidades</span><strong>{unidades.toLocaleString('es-MX')}</strong></div><div><span>Importe</span><strong>{usd(total)}</strong></div></div>
      {fechas.map((dia) => <CollapsibleSection title={fechaLarga(dia)} count={`${filtrados.filter((p) => p.fecha_entrega === dia).length} sucursales`} className="history-day" key={dia}><div className="history-location-grid">{filtrados.filter((p) => p.fecha_entrega === dia).map((p) => <PedidoHistorico key={p.id} pedido={p} />)}</div></CollapsibleSection>)}
      {!filtrados.length && <div className="empty-state"><strong>No hay pedidos de {linea} esta semana</strong><span>Cambia la semana, la línea o la sucursal.</span></div>}
    </>}
  </div>;
}

function PedidoHistorico({ pedido }: { pedido: Pedido }) {
  const total = pedido.lineas.reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  return <article className="history-order-card"><header><div><strong>{pedido.ubicacion.nombre}</strong><small>{pedido.empresa.nombre}</small></div><span className={`order-status order-status--${pedido.estado}`}>{pedido.estado.replaceAll('_', ' ')}</span></header><div>{pedido.lineas.map((l) => <div className="history-order-line" key={l.id}><span><strong>{nombreEnVenta(l.sku, l.nombre, pedido.linea)}</strong><small>{l.sku}</small></span><span>{l.cantidad.toLocaleString('es-MX')} × {usd(l.precio)}</span><strong>{usd(l.cantidad * (l.precio ?? 0))}</strong></div>)}</div><footer><span>{pedido.notas ?? ''}</span><strong>{usd(total)}</strong></footer></article>;
}

interface HojaRuta {
  clave: string;
  nombre: string;
  conductor: string;
  fechas: string[];
  paradas: string[];
  pedidos: Pedido[];
}

const familiaPlantilla = (codigo: string) => codigo.replace(/-(MIE|SAB|LUN|JUE)$/i, '');
const sumarFecha = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');
};
const diaCorto = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
const fechaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }).toUpperCase();

function construirHojasRuta(datos: { linea: Linea; inicio: string; fin: string; pedidos: Pedido[] }, catalogo: Catalogo): HojaRuta[] {
  const hojas = new Map<string, HojaRuta>();
  const plantillas = catalogo.plantillas.filter((p) => p.linea === datos.linea);
  for (let dia = datos.inicio; dia <= datos.fin; dia = sumarFecha(dia, 1)) {
    const numeroDia = new Date(`${dia}T12:00:00`).getDay();
    for (const plantilla of plantillas.filter((p) => p.dia_semana === numeroDia)) {
      const clave = familiaPlantilla(plantilla.codigo);
      const hoja = hojas.get(clave) ?? {
        clave,
        nombre: plantilla.nombre.replace(/\s*·\s*(lunes|martes|miércoles|jueves|viernes|sábado|domingo)$/i, ''),
        conductor: plantilla.conductor,
        fechas: [],
        paradas: [],
        pedidos: [],
      };
      if (!hoja.fechas.includes(dia)) hoja.fechas.push(dia);
      for (const parada of plantilla.paradas) if (!hoja.paradas.includes(parada.nombre)) hoja.paradas.push(parada.nombre);
      hojas.set(clave, hoja);
    }
  }

  for (const pedido of datos.pedidos) {
    const numeroDia = new Date(`${pedido.fecha_entrega}T12:00:00`).getDay();
    const destino = pedido.ubicacion.entrega_en?.id ?? pedido.ubicacion.id;
    const plantilla = plantillas.find((p) => p.dia_semana === numeroDia && p.paradas.some((parada) => parada.ubicacion_id === destino));
    const clave = plantilla ? familiaPlantilla(plantilla.codigo) : 'SIN-RUTA';
    if (!hojas.has(clave)) {
      hojas.set(clave, { clave, nombre: 'Sin ruta asignada', conductor: 'POR ASIGNAR', fechas: [], paradas: [], pedidos: [] });
    }
    const hoja = hojas.get(clave)!;
    if (!hoja.fechas.includes(pedido.fecha_entrega)) hoja.fechas.push(pedido.fecha_entrega);
    if (!hoja.paradas.includes(pedido.ubicacion.entrega_en?.nombre ?? pedido.ubicacion.nombre)) hoja.paradas.push(pedido.ubicacion.entrega_en?.nombre ?? pedido.ubicacion.nombre);
    hoja.pedidos.push(pedido);
  }

  return [...hojas.values()]
    .filter((hoja) => hoja.pedidos.length > 0)
    .map((hoja) => ({ ...hoja, fechas: hoja.fechas.sort() }))
    .sort((a, b) => {
      const prioridad = (nombre: string) => nombre.toLowerCase() === 'pablo' ? 0 : nombre.toLowerCase() === 'mh' ? 1 : 2;
      return prioridad(a.conductor) - prioridad(b.conductor) || a.nombre.localeCompare(b.nombre, 'es');
    });
}

function cantidadesHoja(hoja: HojaRuta, linea: Linea, catalogo: Catalogo, fechaObjetivo?: string) {
  const productosPorSku = new Map(catalogo.productos.map((p) => [p.sku, p.id]));
  const pedidos = fechaObjetivo ? hoja.pedidos.filter((p) => p.fecha_entrega === fechaObjetivo) : hoja.pedidos;
  const lineas = pedidos.flatMap((p) => p.lineas);
  return filasOrden(linea, catalogo.productos).map((fila) => ({
    nombre: fila.nombre,
    cantidad: fila.skus.reduce((total, sku) => {
      const productoId = productosPorSku.get(sku);
      return total + (productoId ? lineas.filter((l) => l.product_id === productoId).reduce((a, l) => a + l.cantidad, 0) : 0);
    }, 0),
  }));
}

function TablaRuta({ titulo, subtitulo, filas }: { titulo: string; subtitulo?: string; filas: { nombre: string; cantidad: number }[] }) {
  return <table className="operation-order-sheet route-order-table"><thead><tr><th colSpan={2}>{titulo}{subtitulo && <small>{subtitulo}</small>}</th></tr><tr><th>ITEM</th><th>QTY</th></tr></thead><tbody>{filas.map((fila) => <tr key={fila.nombre}><td>{fila.nombre}</td><td>{fila.cantidad > 0 ? fila.cantidad.toLocaleString('es-MX') : ''}</td></tr>)}</tbody><tfoot><tr><th>TOTAL</th><th>{filas.reduce((a, fila) => a + fila.cantidad, 0).toLocaleString('es-MX')}</th></tr></tfoot></table>;
}

function OrdenImprimible({ datos, catalogo, onClose }: { datos: { linea: Linea; inicio: string; fin: string; pedidos: Pedido[] }; catalogo: Catalogo; onClose: () => void }) {
  const hojas = construirHojasRuta(datos, catalogo);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-card invoice-print operation-order-print route-order-print" onClick={(e) => e.stopPropagation()}>
    <header className="print-order-head no-print"><div><span className="eyebrow">M&amp;G Management and Logistics Inc.</span><h1>Orden de {datos.linea} por ruta</h1><p>{datos.inicio} al {datos.fin} · {hojas.length} hojas</p></div><button className="icon-btn" aria-label="Cerrar" onClick={onClose}>×</button></header>
    {hojas.map((hoja) => <section className={`route-order-page route-order-page--${datos.linea}`} key={hoja.clave}>
      <header className="route-order-heading"><div><span>M&amp;G Management and Logistics Inc.</span><strong>{hoja.conductor}</strong></div><div><span>{datos.linea}</span><strong>{hoja.nombre}</strong></div></header>
      <div className="route-order-grid" style={{ gridTemplateColumns: `repeat(${hoja.fechas.length + 1}, minmax(190px, 1fr))` }}>
        {hoja.fechas.map((dia) => <TablaRuta key={dia} titulo={diaCorto(dia)} subtitulo={fechaCorta(dia)} filas={cantidadesHoja(hoja, datos.linea, catalogo, dia)} />)}
        <TablaRuta titulo="TOTAL" subtitulo="SEMANA" filas={cantidadesHoja(hoja, datos.linea, catalogo)} />
      </div>
      <footer><strong>Ruta:</strong> {hoja.paradas.join(' → ')} <span>{hoja.pedidos.length} pedidos confirmados</span></footer>
    </section>)}
    {!hojas.length && <div className="empty-state"><strong>No hay pedidos confirmados en esta semana</strong><span>Los borradores no se incluyen en la impresión ni en los consolidados.</span></div>}
    <button className="btn btn-primary btn-block no-print" disabled={!hojas.length} onClick={() => window.print()}>Imprimir / guardar PDF</button>
  </div></div>;
}
