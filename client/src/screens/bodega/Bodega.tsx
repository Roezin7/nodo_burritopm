import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { FaseChip, FlujoStepper } from '../../flujo';
import BodegaRutaTabs from '../../components/BodegaRutaTabs';
import { filasOrden, type FilaOrden, type LineaOperacion, type ProductoOrdenable } from '../../operationOrder';
import { crearSemana, type SemanaSeleccionada } from '../../semana';
import { useOperacionConfig } from '../../operacion-config';
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

interface Catalogo {
  productos: ProductoOrdenable[];
  plantillas: { linea: LineaOperacion; dia_semana: number; activo?: boolean }[];
}

interface DestinoDocumento {
  clave: string;
  nombre: string;
  entregaEn: string;
  direccion: string | null;
  items: RutaItem[];
}

type AlcanceImpresion = { tipo: 'completo' | 'carga' } | { tipo: 'ruta'; rutaId: number };

function fechaLegible(valor: string | null) {
  if (!valor) return 'Fecha pendiente';
  return new Date(`${valor}T12:00:00`).toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fechaDocumento(valor: string | null) {
  if (!valor) return 'FECHA PENDIENTE';
  const fecha = new Date(`${valor}T12:00:00`);
  const dia = fecha.toLocaleDateString('en-US', { day: '2-digit' });
  const mes = fecha.toLocaleDateString('en-US', { month: 'short' });
  const anio = fecha.toLocaleDateString('en-US', { year: '2-digit' });
  return `${dia}-${mes}-${anio}`;
}

function diaDocumento(valor: string | null) {
  if (!valor) return '';
  return new Date(`${valor}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
}

function diasDeSemana(semana: SemanaSeleccionada) {
  const dias: { fecha: string; dia: string; numero: string; diaSemana: number }[] = [];
  const cursor = new Date(`${semana.inicio}T12:00:00`);
  while (cursor.toLocaleDateString('en-CA') <= semana.fin) {
    dias.push({
      fecha: cursor.toLocaleDateString('en-CA'),
      dia: cursor.toLocaleDateString('es-MX', { weekday: 'long' }),
      numero: cursor.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
      diaSemana: cursor.getDay(),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
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

function nombreMatriz(nombre: string) {
  const limpio = nombre.toUpperCase();
  const conocidos: [RegExp, string][] = [
    [/NAPERVILLE.*ONE|NAPERVILLE.*ACE/, 'NAP ONE'],
    [/NAPERVILLE.*OGDEN/, 'OGDEN'],
    [/GLENDALE/, 'GLENDALE'],
    [/ROLLING/, 'ROLLING'],
    [/SCHAUM/, 'SCHAUM'],
    [/CAROL.*STREAM/, 'CAROL'],
    [/WEST.*CHICAGO/, 'WEST'],
    [/ALGONQUIN/, 'ALGO'],
    [/LOMBARD/, 'LOMB'],
    [/LISLE/, 'LISLE'],
    [/BATAVIA/, 'BATAVIA'],
    [/STREAMWOOD/, 'STREAM'],
    [/AURORA/, 'AURORA'],
  ];
  return conocidos.find(([patron]) => patron.test(limpio))?.[1] ?? limpio.split(/\s+/).map((parte) => parte[0]).join('').slice(0, 7);
}

export default function Bodega({ integrado = false, semana = crearSemana() }: { integrado?: boolean; semana?: SemanaSeleccionada }) {
  const { usuario } = useAuth();
  const { repartoHabilitado } = useOperacionConfig();
  const [lista, setLista] = useState<DistResumen[]>([]);
  const [op, setOp] = useState<Operacion | null>(null);
  const [rutas, setRutas] = useState<RutaDetalle[]>([]);
  const [productos, setProductos] = useState<ProductoOrdenable[]>([]);
  const [programacion, setProgramacion] = useState<Catalogo['plantillas']>([]);
  const [verificacionCarga, setVerificacionCarga] = useState(false);
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
      .then(([negocio, catalogo]) => {
        setVerificacionCarga(negocio.verificacion_carga);
        setProductos(catalogo.productos);
        setProgramacion(catalogo.plantillas.filter((plantilla) => plantilla.activo !== false));
      })
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

  const dias = diasDeSemana(semana);
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const salidasPor = (fecha: string, linea: LineaOperacion) => lista
    .filter((distribucion) => distribucion.fecha_entrega === fecha && distribucion.linea === linea)
    .sort((a, b) => a.id - b.id);
  const estaProgramado = (diaSemana: number, linea: LineaOperacion) =>
    programacion.some((plantilla) => plantilla.dia_semana === diaSemana && plantilla.linea === linea);

  return (
    <div className={integrado ? 'embedded-operation' : 'page'}>
      {!integrado && <header className="page-head"><div><span className="eyebrow">Documentos de salida</span><h1>Despacho</h1><p className="page-sub">Hojas de carga y paquetes para cada ruta.</p></div></header>}
      {!integrado && <FlujoStepper activo="bodega" />}
      {!integrado && <BodegaRutaTabs activo="bodega" />}
      {integrado && <header className="embedded-head"><div><span className="eyebrow">Paso 4</span><h2>Despacho</h2></div></header>}
      {error && <p className="error-msg">{error}</p>}

      {cargandoDetalle ? <p className="muted">Preparando documentos…</p> : <section className="dispatch-week-board">
        <header className="dispatch-week-board__head"><div><span>Semana {semana.numero}</span><strong>Día</strong></div><div className="dispatch-line-title dispatch-line-title--carne"><span /><div><strong>Carne</strong><small>Carnicería</small></div></div><div className="dispatch-line-title dispatch-line-title--desechables"><span /><div><strong>Desechables</strong><small>Bodega Adison</small></div></div></header>
        <div className="dispatch-week-board__body">
          {dias.map((dia) => <div className={`dispatch-day-row ${dia.fecha === hoy ? 'is-today' : ''}`} key={dia.fecha}>
            <div className="dispatch-day-label"><strong>{dia.dia}</strong><span>{dia.numero}</span>{dia.fecha === hoy && <small>Hoy</small>}</div>
            {(['carne', 'desechables'] as const).map((linea) => {
              const salidas = salidasPor(dia.fecha, linea);
              const programada = estaProgramado(dia.diaSemana, linea);
              return <div className={`dispatch-day-cell dispatch-day-cell--${linea}`} key={linea}>
                {salidas.length ? salidas.map((salida) => <button className="dispatch-day-card" key={salida.id} onClick={() => void abrir(salida.id)}>
                  <div><strong>{salida.total_lineas} partidas</strong><span>Documentos por ruta</span></div><div><FaseChip estado={salida.estado} /><b>›</b></div>
                </button>) : <div className={`dispatch-day-empty ${programada ? 'is-scheduled' : ''}`}><strong>{programada ? 'Salida programada' : 'Sin salida'}</strong>{programada && <span>Se generará al completar los pedidos</span>}</div>}
              </div>;
            })}
          </div>)}
        </div>
      </section>}
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
  const completado = ['entregada', 'cerrada', 'cerrada_con_incidencias'].includes(op.estado);
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
      {repartoHabilitado && op.estado === 'aprobada' && verificacionCarga && <button className="btn btn-secondary" disabled={busy} onClick={() => void ejecutar('verificada')}>Marcar carga revisada</button>}
      {repartoHabilitado && (op.estado === 'verificada' || (op.estado === 'aprobada' && !verificacionCarga)) && <button className="btn btn-primary" disabled={busy} onClick={() => void ejecutar('cargar')}>Confirmar salida a ruta →</button>}
      {!repartoHabilitado && ['aprobada', 'verificada'].includes(op.estado) && <span className="muted">El despacho se completará automáticamente; no requiere confirmación.</span>}
      {enRuta && <span className="muted">{repartoHabilitado ? 'Salida confirmada · en ruta.' : 'Despacho confirmado.'}</span>}
      {completado && <span className="muted">Despacho completado. Usa Auditoría únicamente si se reporta un faltante.</span>}
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
    {linea === 'carne' && <caption><strong>{titulo}</strong><small>{subtitulo}</small></caption>}
    <thead><tr>{linea === 'desechables' ? <><th className="dispatch-matrix-name">DISPOSABLES</th><th>TOTAL</th></> : <><th>TOTAL</th><th className="dispatch-matrix-name">ITEM</th></>}{destinos.map((destino) => <th key={destino.clave} title={destino.nombre}>{nombreMatriz(destino.nombre)}</th>)}</tr></thead>
    <tbody>{filas.map((fila) => {
      const cantidades = destinos.map((destino) => cantidadFila(destino, fila));
      const total = cantidades.reduce((suma, valor) => suma + valor, 0);
      return <tr key={`${fila.nombre}:${fila.skus.join('-')}`}>{linea === 'desechables' ? <><th>{fila.nombre}</th><td>{total > 0 ? numero(total) : ''}</td></> : <><th>{total > 0 ? numero(total) : ''}</th><td>{fila.nombre}</td></>}{cantidades.map((cantidad, indice) => <td key={destinos[indice].clave}>{cantidad > 0 ? numero(cantidad) : ''}</td>)}</tr>;
    })}</tbody>
    {linea === 'carne' && <tfoot><tr><th>{numero(destinos.reduce((total, destino) => total + destino.items.reduce((suma, item) => suma + item.esperado, 0), 0))}</th><th>TOTAL</th>{destinos.map((destino) => <th key={destino.clave}>{numero(destino.items.reduce((total, item) => total + item.esperado, 0))}</th>)}</tr></tfoot>}
  </table>;
}

function MarcaMG() {
  return <div className="dispatch-real-brand"><strong>M &amp; G</strong><span>1058 N. DUPAGE AVENUE</span><span>LOMBARD, ILLINOIS. 60148</span><span>630 245 3643</span></div>;
}

function HojaRutaTapatios({ ruta, destinos, filas, fecha }: {
  ruta: RutaDetalle;
  destinos: DestinoDocumento[];
  filas: FilaOrden[];
  fecha: string | null;
}) {
  const fechaRuta = ruta.fecha_entrega || fecha;
  const totalesPorFila = filas.map((fila) => destinos.reduce((total, destino) => total + cantidadFila(destino, fila), 0));
  const totalRuta = totalesPorFila.reduce((total, cantidad) => total + cantidad, 0);

  return <div className="dispatch-tapatios-document">
    <MarcaMG />
    <header className="dispatch-tapatios-title">
      <strong>TAPATIOS · {diaDocumento(fechaRuta)}</strong>
      <span>{fechaDocumento(fechaRuta)}</span>
    </header>
    <div className="dispatch-tapatios-grid">
      {destinos.map((destino, indiceDestino) => {
        const cantidades = filas.map((fila) => cantidadFila(destino, fila));
        const totalDestino = cantidades.reduce((total, cantidad) => total + cantidad, 0);
        const incluyeTotalRuta = indiceDestino === 0;
        return <section className={`dispatch-tapatios-stop ${incluyeTotalRuta ? 'dispatch-tapatios-stop--route-total' : ''}`} key={destino.clave}>
          <header>
            <strong>{destino.nombre}</strong>
            {destino.entregaEn !== destino.nombre && <small>ENTREGA EN {destino.entregaEn}</small>}
          </header>
          <div className="dispatch-tapatios-date">{fechaDocumento(fechaRuta)}</div>
          <table className="dispatch-tapatios-table">
            <thead><tr>{incluyeTotalRuta && <th>TOTAL</th>}<th>ITEM</th><th>QTY</th></tr></thead>
            <tbody>{filas.map((fila, indiceFila) => <tr key={`${destino.clave}:${fila.nombre}`}>
              {incluyeTotalRuta && <td>{numero(totalesPorFila[indiceFila])}</td>}
              <td>{fila.nombre}</td>
              <td>{numero(cantidades[indiceFila])}</td>
            </tr>)}</tbody>
            <tfoot><tr>{incluyeTotalRuta && <th>{numero(totalRuta)}</th>}<th>TOTAL</th><th>{numero(totalDestino)}</th></tr></tfoot>
          </table>
        </section>;
      })}
    </div>
    <footer>{ruta.conductor || 'CHOFER'} · {ruta.nombre} · {destinos.map((destino) => destino.nombre).join(' → ')}</footer>
  </div>;
}

function TablaIndividual({ destino, filas, linea, fecha }: { destino: DestinoDocumento; filas: FilaOrden[]; linea: LineaOperacion; fecha: string | null }) {
  return <div className={`dispatch-individual-document dispatch-individual-document--${linea}`}>
    {linea === 'carne' && <MarcaMG />}
    <table className={`dispatch-sheet dispatch-sheet--individual dispatch-sheet--${linea}`}>
      <thead>
        <tr><th className="dispatch-sheet-title" colSpan={2}>{destino.nombre}<small>{destino.entregaEn !== destino.nombre ? `ENTREGA EN ${destino.entregaEn}` : destino.direccion || ''}</small></th></tr>
        {linea === 'carne' ? <><tr className="dispatch-sheet-day"><th colSpan={2}>{diaDocumento(fecha)}</th></tr><tr className="dispatch-sheet-date"><th colSpan={2}>{fechaDocumento(fecha)}</th></tr><tr><th>ITEM</th><th>QTY</th></tr></> : <tr className="dispatch-sheet-date"><th colSpan={2}>{diaDocumento(fecha)} · {fechaDocumento(fecha)}</th></tr>}
      </thead>
      <tbody>{filas.map((fila) => { const cantidad = cantidadFila(destino, fila); return <tr key={`${fila.nombre}:${fila.skus.join('-')}`}><td>{fila.nombre}</td><td>{cantidad > 0 ? numero(cantidad) : ''}</td></tr>; })}</tbody>
      {linea === 'carne' && <tfoot><tr><th>TOTAL</th><th>{numero(destino.items.reduce((total, item) => total + item.esperado, 0))}</th></tr></tfoot>}
    </table>
  </div>;
}

function EncabezadoDocumento({ titulo, detalle, fecha }: { titulo: string; detalle: string; fecha: string | null }) {
  return <header className="dispatch-document-date"><span>{titulo}</span><strong>{fechaDocumento(fecha)}</strong><span>{detalle}</span></header>;
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

    {mostrarCarga && (unicaTapatios ? <section className="dispatch-print-page dispatch-print-page--tapatios">
      <HojaRutaTapatios ruta={rutas[0]} destinos={destinosDeRuta(rutas[0])} filas={filas} fecha={op.fecha_entrega} />
    </section> : <section className={`dispatch-print-page dispatch-print-page--matrix dispatch-print-page--${op.linea}`}>
      <EncabezadoDocumento titulo="CARGA GENERAL" detalle={diaDocumento(op.fecha_entrega)} fecha={op.fecha_entrega} />
      <TablaMatriz titulo={op.linea === 'carne' ? 'CARNE' : 'DISPOSABLES'} subtitulo="TOTAL PARA CARGAR" destinos={destinosTotales} filas={filas} linea={op.linea} />
      <footer>{rutas.map((ruta) => `${ruta.conductor || 'Ruta'}: ${ruta.nombre}`).join(' · ')}</footer>
    </section>)}

    {mostrarRutas && rutasSeleccionadas.flatMap((ruta) => {
      const destinos = destinosDeRuta(ruta);
      if (esRutaTapatios(ruta)) return [<section className="dispatch-print-page dispatch-print-page--tapatios" key={`ruta-${ruta.ruta_id}`}>
        <HojaRutaTapatios ruta={ruta} destinos={destinos} filas={filas} fecha={op.fecha_entrega} />
      </section>];
      const hojasIndividuales = destinos.map((destino, indice) => <section className={`dispatch-print-page dispatch-print-page--ticket dispatch-print-page--${op.linea}`} key={`${ruta.ruta_id}:${destino.clave}`}>
        <TablaIndividual destino={destino} filas={filas} linea={op.linea} fecha={ruta.fecha_entrega || op.fecha_entrega} />
        <footer>{ruta.conductor || 'CHOFER'} · {ruta.nombre} · PARADA {indice + 1}/{destinos.length}</footer>
      </section>);
      if (op.linea !== 'carne') return hojasIndividuales;
      return [<section className={`dispatch-print-page dispatch-print-page--matrix dispatch-print-page--${op.linea}`} key={`total-ruta-${ruta.ruta_id}`}>
        <EncabezadoDocumento titulo={ruta.conductor || 'CHOFER'} detalle={`${ruta.nombre} · TOTAL`} fecha={ruta.fecha_entrega || op.fecha_entrega} />
        <TablaMatriz titulo="CARNE" subtitulo={`TOTAL DE RUTA · ${ruta.conductor || ruta.nombre}`} destinos={destinos} filas={filas} linea={op.linea} />
        <footer>{destinos.map((destino) => destino.nombre).join(' → ')}</footer>
      </section>, ...hojasIndividuales];
    })}

    <button className="btn btn-primary btn-block no-print" onClick={() => window.print()}>Imprimir / guardar PDF</button>
  </div></div>;
}
