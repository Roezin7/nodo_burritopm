import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, fueEncolado, type Encolado } from '../../api';
import { useAuth } from '../../auth';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';
import { nombreEnVenta, productosParaPedido } from '../../operationOrder';
import { crearSemana, inicioDeSemana, type SemanaSeleccionada } from '../../semana';
import Distribucion from '../distribucion/Distribucion';
import CollapsibleSection from '../../components/CollapsibleSection';
import { guardarBorradorLocal, leerBorradorLocal, useUnsavedChanges } from '../../use-unsaved';
import CapturaSemanalPedidos from './pedidos/CapturaSemanalPedidos';
import HistorialPedidos from './pedidos/HistorialPedidos';
import OrdenImprimible from './pedidos/OrdenImprimible';
import {
  entregasDeSemana, esPieza, fechaEntregaCorta, fechaLarga, hoy, unidadCorta, usd,
  type Catalogo, type Linea, type Pedido, type ResultadoConfirmacion,
} from './pedidos/types';

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
  const [estado, setEstado] = useState<string | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [cantidadesGuardadas, setCantidadesGuardadas] = useState<Record<number, string>>({});
  const [notasGuardadas, setNotasGuardadas] = useState('');
  const [preciosPedido, setPreciosPedido] = useState<Record<number, number | null>>({});
  const restauradoRef = useRef<string | null>(null);
  const [clavePedidoHidratado, setClavePedidoHidratado] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refrescoHistorial, setRefrescoHistorial] = useState(0);

  // Captura individual (encargado_sucursal): a diferencia del modo semanal de admin, este
  // formulario no tenía protección de cambios sin guardar ni borrador local — se perdía todo
  // si el usuario navegaba por accidente antes de guardar.
  const claveBorradorIndividual = ubicacionId && fecha ? `bpm-borrador-pedido:${ubicacionId}:${linea}:${fecha}` : null;
  const hayCambiosIndividual = useMemo(() => {
    if (vista !== 'captura' || (admin && modoCaptura === 'semana')) return false;
    if (notas !== notasGuardadas) return true;
    const claves = new Set([...Object.keys(cantidades), ...Object.keys(cantidadesGuardadas)].map(Number));
    for (const k of claves) if ((cantidades[k] || '0') !== (cantidadesGuardadas[k] || '0')) return true;
    return false;
  }, [cantidades, cantidadesGuardadas, notas, notasGuardadas, vista, admin, modoCaptura]);
  useUnsavedChanges(hayCambiosIndividual);

  useEffect(() => {
    if (!claveBorradorIndividual || clavePedidoHidratado !== claveBorradorIndividual) return;
    guardarBorradorLocal(claveBorradorIndividual, hayCambiosIndividual ? { cantidades, notas } : null);
  }, [claveBorradorIndividual, clavePedidoHidratado, hayCambiosIndividual, cantidades, notas]);

  useEffect(() => {
    api<Catalogo>(`/operacion/catalogo?fecha_referencia=${semana.inicio}`).then((c) => {
      setCatalogo(c);
      const asignada = admin ? c.ubicaciones.find((u) => u.tipo === 'sucursal' && u.empresa) : c.ubicaciones.find((u) => usuario?.ubicaciones?.some((x) => x.id === u.id));
      if (asignada) setUbicacionId(String(asignada.id));
    }).catch(() => setError('No se pudo cargar el catálogo de pedidos.'));
  }, [admin, usuario, semana.inicio]);

  // El estado de la semana (abierta/cerrada) se carga una sola vez; si el admin cierra la
  // semana desde otro dispositivo mientras esta pestaña sigue abierta, se refresca al volver
  // a primer plano en vez de dejar la UI editable hasta que el usuario recargue a mano.
  useEffect(() => {
    function alVolverVisible() {
      if (document.visibilityState !== 'visible') return;
      api<Catalogo>(`/operacion/catalogo?fecha_referencia=${semana.inicio}`)
        .then((c) => setCatalogo((actual) => (actual ? { ...actual, semanas: c.semanas } : c)))
        .catch(() => { /* silencioso: es solo un refresco de fondo */ });
    }
    document.addEventListener('visibilitychange', alVolverVisible);
    return () => document.removeEventListener('visibilitychange', alVolverVisible);
  }, [semana.inicio]);

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
      setEstado(null); setVersion(null); setNotas(''); setCantidades({});
      setCantidadesGuardadas({}); setNotasGuardadas(''); setPreciosPedido({}); setCargandoPedido(false);
      setClavePedidoHidratado(null);
      return;
    }
    let vigente = true;
    setCargandoPedido(true);
    setClavePedidoHidratado(null);
    setEstado(null); setVersion(null); setNotas(''); setCantidades({});
    setError('');
    const clave = `bpm-borrador-pedido:${ubicacionId}:${linea}:${fecha}`;
    api<Pedido[]>(`/operacion/pedidos?ubicacion_id=${ubicacionId}&linea=${linea}&desde=${fecha}&hasta=${fecha}`)
      .then((rows) => {
        if (!vigente) return;
        const p = rows[0];
        setEstado(p?.estado ?? null);
        setVersion(p?.actualizado_at ?? null);
        setPreciosPedido(Object.fromEntries((p?.lineas ?? []).map((l) => [l.product_id, l.precio])));
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
        setCantidadesGuardadas(cargadas);
        setNotasGuardadas(p?.notas ?? '');
        const borrador = leerBorradorLocal<{ cantidades: Record<number, string>; notas: string }>(clave);
        if (borrador?.valor && restauradoRef.current !== clave) {
          setCantidades(borrador.valor.cantidades);
          setNotas(borrador.valor.notas);
          restauradoRef.current = clave;
        } else {
          setCantidades(cargadas);
          setNotas(p?.notas ?? '');
        }
        setClavePedidoHidratado(clave);
      })
      .catch((e) => { if (vigente) setError(e instanceof ApiError ? e.message : 'No se pudo cargar el pedido.'); })
      .finally(() => { if (vigente) setCargandoPedido(false); });
    return () => { vigente = false; };
  }, [ubicacionId, linea, fecha, vista, modoCaptura, admin, catalogo, ubicacionSeleccionada?.empresa?.codigo]);

  useEffect(() => { setImpresion(null); }, [semana.inicio, semana.fin]);

  useEffect(() => {
    if (!admin || vista !== 'historial') return;
    setCargandoHistorial(true); setError('');
    api<Pedido[]>(`/operacion/pedidos?desde=${semana.inicio}&hasta=${semana.fin}`)
      .then(setHistorial)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el historial.'))
      .finally(() => setCargandoHistorial(false));
  }, [admin, vista, semana.inicio, semana.fin, linea, refrescoHistorial]);

  async function guardar(confirmar: boolean) {
    if (!ubicacionId) return;
    const esCorreccionProcesada = admin && Boolean(estado) && !['borrador', 'confirmado'].includes(estado!);
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
      setCantidadesGuardadas(cantidades);
      setNotasGuardadas(notas);
      setPreciosPedido(Object.fromEntries(productos.map((p) => [p.id, p.precio])));
      if (claveBorradorIndividual) guardarBorradorLocal(claveBorradorIndividual, null);
      toast.ok(esCorreccionProcesada ? 'Corrección aplicada a venta, despacho e inventario.' : confirmar ? 'Pedido confirmado.' : 'Avance guardado.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }

  async function abrirImpresion(lineaObjetivo: Linea) {
    setError('');
    try {
      const rows = await api<Pedido[]>(`/operacion/pedidos?linea=${lineaObjetivo}&desde=${semana.inicio}&hasta=${semana.fin}`);
      setImpresion({ linea: lineaObjetivo, inicio: semana.inicio, fin: semana.fin, pedidos: rows.filter((p) => !['borrador', 'cancelado'].includes(p.estado)) });
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo preparar la orden para imprimir.'); }
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
  const productosDeVenta = productos.filter((p) => p.linea === linea);
  const total = productosDeVenta.reduce((a, p) => a + Number(cantidades[p.id] || 0) * (preciosPedido[p.id] ?? p.precio ?? 0), 0);
  const unidades = productosDeVenta.reduce((a, p) => a + Number(cantidades[p.id] || 0), 0);
  const unidadesOrden = productos.reduce((a, p) => a + Number(cantidades[p.id] || 0), 0);
  const conCantidad = productosDeVenta.filter((p) => Number(cantidades[p.id] || 0) > 0).length;
  const semanaCerrada = catalogo.semanas.some((s) => s.anio === semana.anio && s.semana === semana.numero && s.estado === 'cerrada');
  const editable = !semanaCerrada && (!estado || (admin
    ? !['cerrado', 'cancelado'].includes(estado)
    : ['borrador', 'confirmado'].includes(estado)));
  const q = buscar.trim().toLowerCase();
  const visibles = productos.filter((p) => !q || `${nombreEnVenta(p.sku, p.nombre, linea)} ${p.tipo}`.toLowerCase().includes(q));
  const capturaSemanal = admin && modoCaptura === 'semana';
  return (
    <div className={integrado ? 'order-page order-embedded' : 'page order-page'}>
      {!integrado && <header className="page-head operation-page-head"><div><span className="eyebrow">Ventas</span><h1>Venta semanal</h1></div>{vista === 'captura' && !capturaSemanal && estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      {integrado && <header className="embedded-head embedded-head--status"><div><span className="eyebrow">Paso 3</span><h2>Ventas</h2></div>{vista === 'captura' && !capturaSemanal && estado && <span className={`order-status order-status--${estado}`}>{estado.replaceAll('_', ' ')}</span>}</header>}
      <div className="order-switches">
        {admin && <div className="segmented order-view-switch"><button className={vista === 'captura' ? 'tab tab--on' : 'tab'} onClick={() => setVista('captura')}>Captura</button><button className={vista === 'historial' ? 'tab tab--on' : 'tab'} onClick={() => setVista('historial')}>Historial</button><button className={vista === 'consolidados' ? 'tab tab--on' : 'tab'} onClick={() => setVista('consolidados')}>Despachos</button></div>}
        {vista !== 'consolidados' && <div className="segmented order-line-switch">
        <button className={linea === 'carne' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('carne')}>Carne</button>
        <button className={linea === 'desechables' ? 'tab tab--on' : 'tab'} onClick={() => setLinea('desechables')}>Desechables</button>
        </div>}
      </div>
      {admin && vista === 'captura' && <div className="weekly-capture-mode">
        <strong>Capturar:</strong>
        <div className="segmented segmented--small"><button className={capturaSemanal ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setModoCaptura('semana')}>Semana completa</button><button className={!capturaSemanal ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setModoCaptura('individual')}>Orden individual</button></div>
      </div>}
      {error && <p className="error-msg">{error}</p>}
      {vista === 'consolidados' ? <Distribucion integrado semana={semana} soloRevision /> : vista === 'captura' ? capturaSemanal ? <CapturaSemanalPedidos catalogo={catalogo} linea={linea} semana={semana} ubicaciones={ubicaciones} semanaCerrada={semanaCerrada} onActualizado={() => setRefrescoHistorial((n) => n + 1)} /> : <div className="order-workspace">
        <section className="order-capture">
          <div className="workspace-card order-context">
            <label className="field field--wide"><span>Restaurante</span><select value={ubicacionId} onChange={(e) => setUbicacionId(e.target.value)}>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.empresa?.nombre}</option>)}</select></label>
            <label className="field order-delivery-field"><span className="order-delivery-label">Entrega de semana {semana.numero}{admin && <button type="button" className="link-btn" onClick={(e) => { e.preventDefault(); setFechaManual((actual) => { if (actual && entregas[0]) setFecha(entregas[0].fecha); return !actual; }); }}>{fechaManual ? 'Usar ruta programada' : 'Fecha excepcional'}</button>}</span>{fechaManual ? <input type="date" min={semana.inicio} max={semana.fin} value={fecha} onChange={(e) => setFecha(e.target.value)} /> : <select value={fecha} disabled={!entregas.length} onChange={(e) => setFecha(e.target.value)}>{!entregas.length && <option value="">Sin entrega configurada</option>}{entregas.map((e) => <option key={e.fecha} value={e.fecha}>{fechaEntregaCorta(e.fecha)}</option>)}</select>}<small className="order-delivery-hint">{fechaManual ? 'Fecha excepcional dentro de la semana seleccionada.' : entregaSeleccionada ? `${entregaSeleccionada.rutas.map((r) => r.nombre).join(' / ')} · ${[...new Set(entregaSeleccionada.rutas.map((r) => r.conductor))].join(', ')}` : 'Este restaurante no aparece en una ruta activa para esta línea.'}</small></label>
          </div>
          {ubic?.entrega_en && <p className="context-note">Entrega física en <strong>{ubic.entrega_en.nombre}</strong>; la factura permanece en {ubic.nombre}.</p>}
          {semanaCerrada && <p className="notice notice--warning">La semana {semana.numero} está cerrada y esta venta se muestra en modo consulta.</p>}
          {!semanaCerrada && !cargandoPedido && !editable && <p className="notice notice--warning">Esta venta ya fue procesada. El administrador puede corregirla.</p>}
          {!semanaCerrada && editable && admin && estado && !['borrador', 'confirmado'].includes(estado) && <p className="context-note">Corrección vinculada: al guardar se actualizarán despacho, inventario y facturación.</p>}
          <CollapsibleSection title="Productos" count={productos.length} className="product-picker">
            <div className="workspace-card-head"><div /><input className="compact-search" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar" /></div>
            <div className="order-product-list">{visibles.map((p) => <label key={p.id} className={`order-product ${Number(cantidades[p.id] || 0) > 0 ? 'has-quantity' : ''}`}>
              <span><strong>{nombreEnVenta(p.sku, p.nombre, linea)}</strong><small>{p.peso_caja_lb ? `Caja terminada de ${p.peso_caja_lb} lb` : p.unidad} · {p.precio_pendiente && preciosPedido[p.id] == null ? 'Costo semanal + $15 al capturar producción' : usd(preciosPedido[p.id] ?? p.precio)}</small></span>
              <div className="input-suffix input-suffix--compact"><input disabled={cargandoPedido || !editable} inputMode="decimal" type="number" min="0" step={esPieza(p) ? '1' : '0.5'} value={cantidades[p.id] ?? ''} placeholder="0" onChange={(e) => setCantidades({ ...cantidades, [p.id]: e.target.value })} /><span>{unidadCorta(p)}</span></div>
            </label>)}</div>
          </CollapsibleSection>
          <label className="workspace-card field order-notes"><span>Notas de la venta <em>opcional</em></span><textarea disabled={cargandoPedido || !editable} rows={3} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Instrucciones especiales, sustituciones o entrega…" /></label>
        </section>
        <aside className="order-summary">
          <span className="eyebrow">Resumen de venta</span><h2>{ubic?.nombre ?? 'Selecciona restaurante'}</h2><p>{fecha ? `Semana ${semana.numero} · ${fechaLarga(fecha)}` : 'Sin entrega programada'} · {linea}</p>
          <dl><div><dt>Productos</dt><dd>{conCantidad}</dd></div><div><dt>Unidades</dt><dd>{unidades.toLocaleString('es-MX')}</dd></div><div><dt>Total {linea}</dt><dd>{usd(total)}</dd></div></dl>
          <div className="order-actions"><button className="btn btn-secondary" disabled={busy || cargandoPedido || !editable || !ubicacionId || !fecha} onClick={() => void guardar(false)}>Guardar</button><button className="btn btn-primary" disabled={busy || cargandoPedido || !editable || !ubicacionId || !fecha || unidadesOrden <= 0} onClick={() => void guardar(true)}>{busy ? 'Guardando…' : cargandoPedido ? 'Cargando…' : admin && estado && !['borrador', 'confirmado'].includes(estado) ? 'Guardar corrección' : 'Confirmar'}</button></div>
        </aside>
      </div> : <HistorialPedidos pedidos={historial} cargando={cargandoHistorial} linea={linea} semana={semana} ubicacion={historialUbicacion} setUbicacion={setHistorialUbicacion} ubicaciones={ubicaciones} onPrint={() => void abrirImpresion(linea)} onConfirmar={() => void confirmarTodos(semana.inicio, semana.fin)} confirmando={busy || semanaCerrada} />}
      {impresion && <OrdenImprimible datos={impresion} catalogo={catalogo} onClose={() => setImpresion(null)} />}
    </div>
  );
}
