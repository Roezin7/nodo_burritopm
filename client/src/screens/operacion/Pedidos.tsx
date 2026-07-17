import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';
import { filasOrden, nombreEnOrden, productosParaPedido } from '../../operationOrder';

type Linea = 'carne' | 'desechables';
interface Catalogo {
  ubicaciones: { id: number; nombre: string; tipo: string; empresa: { id: number; nombre: string; codigo: string } | null; entrega_en: { id: number; nombre: string } | null }[];
  productos: { id: number; sku: string; nombre: string; linea: Linea; tipo: string; unidad: string; precio: number | null; peso_caja_lb: number | null }[];
  plantillas: { id: number; nombre: string; codigo: string; linea: Linea; dia_semana: number; conductor: string; paradas: { ubicacion_id: number; nombre: string; orden: number; opcional: boolean }[] }[];
  semanas: { id: number; anio: number; semana: number; inicia_at: string; termina_at: string; estado: string }[];
}
interface Pedido {
  id: number; linea: Linea; fecha_entrega: string; estado: string; notas?: string | null;
  empresa: { id: number; nombre: string; codigo: string };
  ubicacion: { id: number; nombre: string; entrega_en: { id: number; nombre: string } | null };
  lineas: { id: number; product_id: number; nombre: string; sku: string; cantidad: number; precio: number | null }[];
}

function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
function siguienteMiercoles() {
  const d = new Date(`${hoy()}T12:00:00`);
  let n = (3 - d.getDay() + 7) % 7;
  if (n === 0) n = 7;
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}
const usd = (n: number | null) => n == null ? 'Precio pendiente' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const esPieza = (p: { unidad: string }) => p.unidad.toLowerCase().includes('pieza');
const unidadCorta = (p: { unidad: string }) => esPieza(p) ? 'pzas' : 'cajas';
const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function rangoSemana(valor: string) {
  const d = new Date(`${valor}T12:00:00`);
  const desplazamiento = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + desplazamiento);
  const inicio = d.toLocaleDateString('en-CA');
  d.setDate(d.getDate() + 5);
  return { inicio, fin: d.toLocaleDateString('en-CA') };
}
interface ResultadoConfirmacion {
  confirmados: number;
  borradores_vacios: number;
  cobertura_bpm: { fecha: string; total: number; confirmados: number; pendientes: string[] }[];
}
interface ResultadoPreparaciones { creadas: { id: number }[]; existentes: number; borradores_omitidos: number }

export default function Pedidos({ integrado = false }: { integrado?: boolean }) {
  const { usuario } = useAuth();
  const toast = useToast();
  const admin = usuario?.rol === 'admin';
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [linea, setLinea] = useState<Linea>('carne');
  const [ubicacionId, setUbicacionId] = useState('');
  const [fecha, setFecha] = useState(siguienteMiercoles());
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [notas, setNotas] = useState('');
  const [buscar, setBuscar] = useState('');
  const [vista, setVista] = useState<'captura' | 'historial'>('captura');
  const [fechaHistorial, setFechaHistorial] = useState(hoy());
  const [historial, setHistorial] = useState<Pedido[]>([]);
  const [historialUbicacion, setHistorialUbicacion] = useState('todas');
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [impresion, setImpresion] = useState<{ linea: Linea; inicio: string; fin: string; pedidos: Pedido[] } | null>(null);
  const [cargandoImpresion, setCargandoImpresion] = useState(false);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refrescoHistorial, setRefrescoHistorial] = useState(0);

  useEffect(() => {
    api<Catalogo>('/operacion/catalogo').then((c) => {
      setCatalogo(c);
      if (c.semanas[0]) setFechaHistorial(c.semanas[0].inicia_at);
      const asignada = admin ? c.ubicaciones.find((u) => u.tipo === 'sucursal' && u.empresa) : c.ubicaciones.find((u) => usuario?.ubicaciones?.some((x) => x.id === u.id));
      if (asignada) setUbicacionId(String(asignada.id));
    }).catch(() => setError('No se pudo cargar el catálogo de pedidos.'));
  }, [admin, usuario]);

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

  useEffect(() => {
    if (vista !== 'captura' || !ubicacionId || !fecha) return;
    setError('');
    api<Pedido[]>(`/operacion/pedidos?ubicacion_id=${ubicacionId}&linea=${linea}&desde=${fecha}&hasta=${fecha}`)
      .then((rows) => {
        const p = rows[0];
        setEstado(p?.estado ?? null);
        setNotas(p?.notas ?? '');
        setCantidades(Object.fromEntries((p?.lineas ?? []).map((l) => [l.product_id, String(l.cantidad)])));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el pedido.'));
  }, [ubicacionId, linea, fecha, vista]);

  useEffect(() => {
    if (!admin || vista !== 'historial') return;
    const rango = rangoSemana(fechaHistorial);
    setCargandoHistorial(true); setError('');
    api<Pedido[]>(`/operacion/pedidos?linea=${linea}&desde=${rango.inicio}&hasta=${rango.fin}`)
      .then(setHistorial)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el historial.'))
      .finally(() => setCargandoHistorial(false));
  }, [admin, vista, fechaHistorial, linea, refrescoHistorial]);

  async function guardar(confirmar: boolean) {
    if (!ubicacionId) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ estado: string }>('/operacion/pedidos', {
        method: 'PUT',
        body: { ubicacion_id: Number(ubicacionId), linea, fecha_entrega: fecha, confirmar, notas: notas.trim() || null, lineas: productos.map((p) => ({ product_id: p.id, cantidad: Number(cantidades[p.id] || 0) })) },
      });
      setEstado(r.estado);
      toast.ok(confirmar ? 'Pedido confirmado.' : 'Avance guardado.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }

  async function abrirImpresion(lineaObjetivo: Linea, fechaBase: string) {
    const rango = rangoSemana(fechaBase);
    setCargandoImpresion(true); setError('');
    try {
      const rows = await api<Pedido[]>(`/operacion/pedidos?linea=${lineaObjetivo}&desde=${rango.inicio}&hasta=${rango.fin}`);
      setImpresion({ linea: lineaObjetivo, ...rango, pedidos: rows.filter((p) => !['borrador', 'cancelado'].includes(p.estado)) });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo preparar la orden para imprimir.'); }
    finally { setCargandoImpresion(false); }
  }

  async function confirmarTodos(desde: string, hasta: string) {
    setBusy(true); setError('');
    try {
      const r = await api<ResultadoConfirmacion>('/operacion/pedidos/confirmar-todos', {
        method: 'POST', body: { linea, desde, hasta },
      });
      let proceso = '';
      try {
        const preparaciones = await api<ResultadoPreparaciones>('/operacion/distribuciones/crear-todas', {
          method: 'POST', body: { linea, desde, hasta },
        });
        const aprobacion = await api<{ aprobadas: number }>('/distribuciones/aprobar-todas', {
          method: 'POST', body: { desde, hasta },
        });
        proceso = ` · ${preparaciones.creadas.length} preparaciones creadas · ${aprobacion.aprobadas} listas para despacho`;
      } catch (e) {
        setError(e instanceof ApiError ? `Las ventas quedaron confirmadas, pero el proceso automático requiere atención: ${e.message}` : 'Las ventas quedaron confirmadas, pero no se pudo generar el proceso automático.');
      }
      const pendientes = r.cobertura_bpm.flatMap((c) => c.pendientes.map((nombre) => `${c.fecha}: ${nombre}`));
      const detalle = pendientes.length ? ` · BPM pendiente: ${pendientes.slice(0, 3).join(', ')}${pendientes.length > 3 ? ` y ${pendientes.length - 3} más` : ''}` : ' · BPM completo';
      toast.ok(`${r.confirmados} ventas confirmadas${r.borradores_vacios ? ` · ${r.borradores_vacios} borradores vacíos omitidos` : ''}${proceso}${detalle}`);
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
  const q = buscar.trim().toLowerCase();
  const visibles = productos.filter((p) => !q || `${nombreEnOrden(p.sku, p.nombre, linea)} ${p.tipo}`.toLowerCase().includes(q));
  return (
    <div className={integrado ? 'order-page order-embedded' : 'page order-page'}>
      {!integrado && <header className="page-head operation-page-head"><div><span className="eyebrow">Ventas</span><h1>Venta semanal</h1></div>{vista === 'captura' && estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      {integrado && <header className="embedded-head embedded-head--status"><div><span className="eyebrow">Paso 3</span><h2>Ventas</h2></div>{vista === 'captura' && estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      <div className="order-switches">
        {admin && <div className="segmented order-view-switch"><button className={vista === 'captura' ? 'tab tab--on' : 'tab'} onClick={() => setVista('captura')}>Capturar</button><button className={vista === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setVista('historial')}>Historial por sucursal</button></div>}
        <div className="segmented order-line-switch">
        <button className={linea === 'carne' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('carne')}>Carne</button>
        <button className={linea === 'desechables' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('desechables')}>Desechables</button>
        </div>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {vista === 'captura' ? <div className="order-workspace">
        <section className="order-capture">
          <div className="workspace-card order-context">
            <label className="field field--wide"><span>Restaurante</span><select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.empresa?.nombre}</option>)}</select></label>
            <label className="field"><span>Fecha de entrega</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          </div>
          {ubic?.entrega_en && <p className="notice">Se factura a <strong>{ubic.nombre}</strong> y se entrega físicamente en <strong>{ubic.entrega_en.nombre}</strong>.</p>}
          <section className="workspace-card product-picker">
            <div className="workspace-card-head"><h2>Productos</h2><input className="compact-search" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar" /></div>
            <div className="order-product-list">{visibles.map((p) => <label key={p.id} className={`order-product ${Number(cantidades[p.id] || 0) > 0 ? 'has-quantity' : ''}`}>
              <span><strong>{nombreEnOrden(p.sku, p.nombre, linea)}</strong><small>{p.peso_caja_lb ? `Caja terminada de ${p.peso_caja_lb} lb` : p.unidad} · {usd(p.precio)}</small></span>
              <div className="input-suffix input-suffix--compact"><input inputMode="decimal" type="number" min="0" step={esPieza(p) ? '1' : '0.5'} value={cantidades[p.id] ?? ''} placeholder="0" onChange={(e) => setCantidades({ ...cantidades, [p.id]: e.target.value })} /><span>{unidadCorta(p)}</span></div>
            </label>)}</div>
          </section>
          <label className="workspace-card field order-notes"><span>Notas de la venta <em>opcional</em></span><textarea rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Instrucciones especiales, sustituciones o entrega…" /></label>
        </section>
        <aside className="order-summary">
          <span className="eyebrow">Resumen de venta</span><h2>{ubic?.nombre ?? 'Selecciona restaurante'}</h2><p>{fecha} · {linea}</p>
          <dl><div><dt>Productos</dt><dd>{conCantidad}</dd></div><div><dt>Unidades</dt><dd>{unidades.toLocaleString('es-MX')}</dd></div><div><dt>Total</dt><dd>{usd(total)}</dd></div></dl>
          <div className="order-actions"><button className="btn btn-secondary" disabled={busy || !ubicacionId} onClick={() => void guardar(false)}>Guardar</button><button className="btn btn-primary" disabled={busy || !ubicacionId || unidades <= 0} onClick={() => void guardar(true)}>{busy ? 'Guardando…' : 'Confirmar'}</button></div>
          {admin && <button className="btn btn-secondary btn-block order-confirm-all" disabled={busy} onClick={() => void confirmarTodos(fecha, fecha)}>Confirmar ventas y generar proceso</button>}
          {admin && <div className="order-print-actions"><span>Orden semanal consolidada</span><button className="btn btn-secondary btn-block" disabled={cargandoImpresion} onClick={() => void abrirImpresion('carne', fecha)}>Imprimir carne</button><button className="btn btn-secondary btn-block" disabled={cargandoImpresion} onClick={() => void abrirImpresion('desechables', fecha)}>Imprimir desechables</button></div>}
        </aside>
      </div> : <HistorialPedidos pedidos={historial} cargando={cargandoHistorial} linea={linea} fecha={fechaHistorial} setFecha={setFechaHistorial} ubicacion={historialUbicacion} setUbicacion={setHistorialUbicacion} ubicaciones={ubicaciones} semanas={catalogo.semanas} onPrint={() => void abrirImpresion(linea, fechaHistorial)} onConfirmar={() => { const rango = rangoSemana(fechaHistorial); void confirmarTodos(rango.inicio, rango.fin); }} confirmando={busy} />}
      {impresion && <OrdenImprimible datos={impresion} catalogo={catalogo} onClose={() => setImpresion(null)} />}
    </div>
  );
}

function HistorialPedidos({ pedidos, cargando, linea, fecha, setFecha, ubicacion, setUbicacion, ubicaciones, semanas, onPrint, onConfirmar, confirmando }: {
  pedidos: Pedido[]; cargando: boolean; linea: Linea; fecha: string; setFecha: (v: string) => void; ubicacion: string; setUbicacion: (v: string) => void;
  ubicaciones: Catalogo['ubicaciones']; semanas: Catalogo['semanas']; onPrint: () => void; onConfirmar: () => void; confirmando: boolean;
}) {
  const rango = rangoSemana(fecha);
  const indiceSemana = semanas.findIndex((s) => s.inicia_at === fecha);
  const semanaActual = semanas[indiceSemana] ?? semanas[0];
  const anterior = semanas[indiceSemana + 1];
  const siguiente = indiceSemana > 0 ? semanas[indiceSemana - 1] : undefined;
  const filtrados = pedidos.filter((p) => ubicacion === 'todas' || String(p.ubicacion.id) === ubicacion);
  const fechas = [...new Set(filtrados.map((p) => p.fecha_entrega))].sort();
  const unidades = filtrados.flatMap((p) => p.lineas).reduce((a, l) => a + l.cantidad, 0);
  const total = filtrados.flatMap((p) => p.lineas).reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  return <div className="order-history">
    <section className="workspace-card history-toolbar">
      <div><span className="eyebrow">Periodo</span><h2>Semana {semanaActual?.semana ?? '—'}</h2><p>{rango.inicio} al {rango.fin}</p></div>
      <div className="history-week-controls"><button className="icon-btn" disabled={!anterior} aria-label="Semana anterior" onClick={() => anterior && setFecha(anterior.inicia_at)}>←</button><select aria-label="Semana" value={semanaActual?.inicia_at ?? fecha} onChange={(e) => setFecha(e.target.value)}>{semanas.map((s) => <option key={s.id} value={s.inicia_at}>Semana {s.semana} · {s.inicia_at} al {s.termina_at}</option>)}</select><button className="icon-btn" disabled={!siguiente} aria-label="Semana siguiente" onClick={() => siguiente && setFecha(siguiente.inicia_at)}>→</button></div>
      <label className="field"><span>Sucursal</span><select value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}><option value="todas">Todas las sucursales</option>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>
      <div className="history-primary-actions"><button className="btn btn-secondary" disabled={cargando || confirmando} onClick={onConfirmar}>{confirmando ? 'Generando…' : 'Confirmar y generar proceso'}</button><button className="btn btn-primary" disabled={cargando || !pedidos.length} onClick={onPrint}>Imprimir por ruta</button></div>
    </section>
    {cargando ? <Spinner label="Cargando pedidos…" /> : <>
      <div className="metric-strip metric-strip--four"><div><span>Sucursales</span><strong>{new Set(filtrados.map((p) => p.ubicacion.id)).size}</strong></div><div><span>Ventas</span><strong>{filtrados.length}</strong></div><div><span>Unidades</span><strong>{unidades.toLocaleString('es-MX')}</strong></div><div><span>Importe</span><strong>{usd(total)}</strong></div></div>
      {fechas.map((dia) => <section className="history-day" key={dia}><div className="section-heading"><div><span className="eyebrow">Entrega</span><h2>{fechaLarga(dia)}</h2></div><span>{filtrados.filter((p) => p.fecha_entrega === dia).length} sucursales</span></div><div className="history-location-grid">{filtrados.filter((p) => p.fecha_entrega === dia).map((p) => <PedidoHistorico key={p.id} pedido={p} />)}</div></section>)}
      {!filtrados.length && <div className="empty-state"><strong>No hay pedidos de {linea} esta semana</strong><span>Cambia la semana, la línea o la sucursal.</span></div>}
    </>}
  </div>;
}

function PedidoHistorico({ pedido }: { pedido: Pedido }) {
  const total = pedido.lineas.reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  return <article className="history-order-card"><header><div><strong>{pedido.ubicacion.nombre}</strong><small>{pedido.empresa.nombre}</small></div><span className={`order-status order-status--${pedido.estado}`}>{pedido.estado.replaceAll('_', ' ')}</span></header><div>{pedido.lineas.map((l) => <div className="history-order-line" key={l.id}><span><strong>{nombreEnOrden(l.sku, l.nombre, pedido.linea)}</strong><small>{l.sku}</small></span><span>{l.cantidad.toLocaleString('es-MX')} × {usd(l.precio)}</span><strong>{usd(l.cantidad * (l.precio ?? 0))}</strong></div>)}</div><footer><span>{pedido.notas ?? ''}</span><strong>{usd(total)}</strong></footer></article>;
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
    {!hojas.length && <div className="empty-state"><strong>No hay pedidos confirmados en esta semana</strong><span>Los borradores no se incluyen en la impresión ni en la preparación.</span></div>}
    <button className="btn btn-primary btn-block no-print" disabled={!hojas.length} onClick={() => window.print()}>Imprimir / guardar PDF</button>
  </div></div>;
}
