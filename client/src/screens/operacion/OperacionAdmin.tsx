import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, getToken } from '../../api';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';
import { crearSemana, fechaDentroDeSemana, type SemanaSeleccionada } from '../../semana';
import { useOperacionConfig } from '../../operacion-config';
import CollapsibleSection from '../../components/CollapsibleSection';

export type OperacionSeccion = 'compras' | 'produccion' | 'rutas' | 'cierre';
interface Catalogo {
  ubicaciones: { id: number; nombre: string; tipo: string; empresa: { nombre: string } | null }[];
  productos: { id: number; nombre: string; sku: string; linea: string; tipo: string; unidad: string; costo: number | null; precio: number | null; peso_caja_lb: number | null; produccion_dias: number[] }[];
  proveedores: { id: number; nombre: string }[];
  plantillas: { id: number; nombre: string; codigo: string; linea: string; dia_semana: number; conductor: string; paradas: { ubicacion_id: number; nombre: string; orden: number; opcional: boolean }[] }[];
  recetas_produccion: { materia_prima_id: number; producto_salida_id: number; sin_costo: boolean; orden: number }[];
}
interface Resumen {
  total_compras: number;
  cantidad_compras: number;
  resumen_proteinas: { product_id: number; producto: string; cajas: number; costo_total: number; costo_caja: number; markup_caja: number; precio_venta_caja: number; venta_total: number }[];
  compras: { id: number; fecha: string; vence_at: string; proveedor_id: number; ubicacion_id: number; proveedor: string; referencia: string | null; total: number; estado: string; lineas: { product_id: number; producto: string; cajas: number; peso_lb: number; costo: number; congelado: boolean }[] }[];
  producciones: { id: number; fecha: string; materia_prima: string; cajas_entrada: number; peso_entrada_lb: number; peso_salida_lb: number; desperdicio_lb: number; yield: number; costo: number; salidas: { producto: string; sku: string; unidad: string; tipo: string | null; cajas: number; costo_caja: number; precio: number }[] }[];
  lotes: { id: number; fecha: string; producto: string; product_id: number; cajas: number; peso_lb: number; costo: number; congelado: boolean }[];
}
interface Cierre {
  id: number; anio: number; semana: number; inicia_at: string; termina_at: string; estado: string;
  valor_carne: number; valor_congelado: number; valor_desechables: number; cuentas_por_cobrar: number; cuentas_por_pagar: number; balance_neto: number;
  facturas: Factura[];
}
interface Factura { id: number; numero: string; version: number; empresa: string; ubicacion: string; linea: string; emitida_at: string; vence_at: string; estado: string; total: number; pagado: number; lineas: { descripcion: string; cantidad: number; precio: number; importe: number }[] }
interface ConciliacionFila {
  product_id: number; sku: string; nombre: string; tipo: string | null; unidad: string;
  inicial: number; actual: number; fisico_final: number | null;
  compras1: number; compras2: number; produccionEntrada1: number; produccionEntrada2: number;
  produccionSalida1: number; produccionSalida2: number; salidas1: number; salidas2: number;
  pedidos1: number; pedidos2: number; saldoMiercoles: number; teoricoFinal: number; diferenciaFinal: number | null;
}
interface Conciliacion {
  ubicacion: { id: number; nombre: string };
  periodo: { desde: string; hasta: string; corte_miercoles: string };
  inicial_fijado: boolean; final_capturado: boolean; origen_inicial: 'fijado' | 'cierre_anterior' | 'reconstruido'; filas: ConciliacionFila[];
  resumen: { saldos_provisionales: number; diferencias_fisicas: number; producciones: number; pedidos: number };
}
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const MARKUP_PROTEINA = 15;
const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const diasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const meta: Record<OperacionSeccion, { eyebrow: string; titulo: string; descripcion: string }> = {
  compras: { eyebrow: 'Paso 1', titulo: 'Compras', descripcion: 'Registra lo recibido esta semana.' },
  produccion: { eyebrow: 'Paso 2', titulo: 'Producción', descripcion: 'Captura la materia prima usada y las cajas producidas.' },
  rutas: { eyebrow: 'Entregas', titulo: 'Rutas', descripcion: 'Orden de entrega por día.' },
  cierre: { eyebrow: 'Paso 8', titulo: 'Cierre', descripcion: 'Genera facturas y libros semanales.' },
};

export default function OperacionAdmin({ seccion, integrado = false, semana = crearSemana() }: { seccion: OperacionSeccion; integrado?: boolean; semana?: SemanaSeleccionada }) {
  const toast = useToast();
  const { repartoHabilitado } = useOperacionConfig();
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cierres, setCierres] = useState<Cierre[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const solicitud = useRef(0);

  async function cargar() {
    const turno = ++solicitud.current;
    setError('');
    try {
      const [c, r, s] = await Promise.all([api<Catalogo>('/operacion/catalogo'), api<Resumen>(`/operacion/produccion?desde=${semana.inicio}&hasta=${semana.fin}`), api<Cierre[]>('/cierre')]);
      if (turno !== solicitud.current) return;
      setCatalogo(c); setResumen(r); setCierres(s);
    } catch (e) { if (turno === solicitud.current) setError(e instanceof ApiError ? e.message : 'No se pudo cargar la operación.'); }
  }
  useEffect(() => { setResumen(null); void cargar(); }, [semana.inicio, semana.fin]);
  if (!catalogo || !resumen) return <div className={integrado ? '' : 'page'}><Spinner /><p className="error-msg">{error}</p></div>;
  const semanaCerrada = cierres.some((s) => s.anio === semana.anio && s.semana === semana.numero && s.estado === 'cerrada');
  const vista = seccion === 'cierre' && !repartoHabilitado ? { ...meta.cierre, eyebrow: 'Paso 7' } : meta[seccion];

  return (
    <div className={integrado ? 'operation-embedded' : 'page operation-page'}>
      {!integrado && <header className="page-head operation-page-head"><div><span className="eyebrow">{vista.eyebrow}</span><h1>{vista.titulo}</h1><p className="page-sub">{vista.descripcion}</p></div></header>}
      {integrado && <header className="embedded-head"><span className="eyebrow">{vista.eyebrow}</span><h2>{vista.titulo}</h2></header>}
      {error && <p className="error-msg">{error}</p>}
      {semanaCerrada && ['compras', 'produccion'].includes(seccion) && <p className="notice notice--warning">La semana {semana.numero} está cerrada y se muestra en modo consulta. Reábrela desde Cierre para hacer correcciones.</p>}
      {seccion === 'compras' && <Compras catalogo={catalogo} resumen={resumen} semana={semana} bloqueada={semanaCerrada} busy={busy} setBusy={setBusy} onDone={async (mensaje = 'Compra registrada e inventario actualizado.') => { await cargar(); toast.ok(mensaje); }} setError={setError} />}
      {seccion === 'produccion' && <Produccion catalogo={catalogo} resumen={resumen} semana={semana} bloqueada={semanaCerrada} busy={busy} setBusy={setBusy} onDone={cargar} setError={setError} />}
      {seccion === 'rutas' && <Rutas catalogo={catalogo} busy={busy} setBusy={setBusy} onDone={async () => { await cargar(); toast.ok('Ruta actualizada.'); }} setError={setError} />}
      {seccion === 'cierre' && <Cierres cierres={cierres} semana={semana} busy={busy} setBusy={setBusy} onDone={cargar} setError={setError} />}
    </div>
  );
}

function Compras({ catalogo, resumen, semana, bloqueada, busy, setBusy, onDone, setError }: { catalogo: Catalogo; resumen: Resumen; semana: SemanaSeleccionada; bloqueada: boolean; busy: boolean; setBusy: (v: boolean) => void; onDone: (mensaje?: string) => Promise<void>; setError: (v: string) => void }) {
  const carniceria = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && u.nombre.toLowerCase().includes('carnicer'));
  const bodega = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && !u.nombre.toLowerCase().includes('carnicer'));
  const [linea, setLinea] = useState<'carne' | 'desechables'>('carne');
  const productosCompra = useMemo(
    () => catalogo.productos
      .filter((p) => p.linea === linea && (linea === 'desechables' || ['materia_prima', 'precio_fijo'].includes(p.tipo)))
      .sort((a, b) => Number(b.tipo === 'materia_prima') - Number(a.tipo === 'materia_prima')),
    [catalogo.productos, linea],
  );
  const [proveedor, setProveedor] = useState(String(catalogo.proveedores[0]?.id ?? ''));
  const [fecha, setFecha] = useState(fechaDentroDeSemana(semana));
  const [referencia, setReferencia] = useState('');
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  type LineaCompra = { clave: number; producto: string; cajas: string; peso: string; costo: string; congelado: boolean };
  const nuevaLinea = (productoId = ''): LineaCompra => ({ clave: Date.now() + Math.random(), producto: productoId, cajas: '', peso: '', costo: '', congelado: false });
  const [lineas, setLineas] = useState<LineaCompra[]>(() => [nuevaLinea(String(catalogo.productos.find((p) => p.tipo === 'materia_prima')?.id ?? ''))]);
  const editarLinea = (clave: number, cambios: Partial<LineaCompra>) => setLineas((actuales) => actuales.map((l) => l.clave === clave ? { ...l, ...cambios } : l));
  useEffect(() => {
    const primero = String(productosCompra[0]?.id ?? '');
    setLineas((actuales) => actuales.map((l) => productosCompra.some((p) => String(p.id) === l.producto) ? l : { ...l, producto: primero, peso: '', congelado: false }));
  }, [linea, productosCompra]);
  useEffect(() => {
    setFecha(fechaDentroDeSemana(semana));
    setEditandoId(null);
    setReferencia('');
    setLineas([nuevaLinea(String(productosCompra[0]?.id ?? ''))]);
  }, [semana.inicio, semana.fin]);
  const almacen = linea === 'carne' ? carniceria : bodega;
  const totalCompra = lineas.reduce((total, l) => total + Number(l.costo || 0), 0);
  const lineasValidas = lineas.length > 0 && lineas.every((l) => {
    const producto = productosCompra.find((p) => String(p.id) === l.producto);
    return Boolean(l.producto && Number(l.cajas) > 0 && Number(l.costo) > 0 && (producto?.tipo !== 'materia_prima' || Number(l.peso) > 0));
  });
  async function guardar() {
    if (!almacen) { setError('Falta configurar el almacén de esta línea.'); return; }
    setBusy(true); setError('');
    try {
      const body = { proveedor_id: Number(proveedor), ubicacion_id: almacen.id, fecha, referencia: referencia || null, lineas: lineas.map((l) => { const p = productosCompra.find((producto) => String(producto.id) === l.producto); const materiaPrima = p?.tipo === 'materia_prima'; return { product_id: Number(l.producto), cajas: Number(l.cajas), peso_total_lb: materiaPrima ? Number(l.peso) : 0, costo_total: Number(l.costo), congelado: materiaPrima && l.congelado }; }) };
      await api(editandoId == null ? '/operacion/compras' : `/operacion/compras/${editandoId}`, { method: editandoId == null ? 'POST' : 'PATCH', body });
      const fueEdicion = editandoId != null;
      setLineas([nuevaLinea(String(productosCompra[0]?.id ?? ''))]); setReferencia(''); setEditandoId(null);
      await onDone(fueEdicion ? 'Compra actualizada e inventario recalculado.' : undefined);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo registrar la compra.'); } finally { setBusy(false); }
  }
  function editarCompra(compra: Resumen['compras'][number]) {
    const primera = catalogo.productos.find((p) => p.id === compra.lineas[0]?.product_id);
    setLinea(primera?.linea === 'desechables' ? 'desechables' : 'carne');
    setProveedor(String(compra.proveedor_id));
    setFecha(compra.fecha);
    setReferencia(compra.referencia ?? '');
    setLineas(compra.lineas.map((l) => ({ clave: Date.now() + Math.random(), producto: String(l.product_id), cajas: String(l.cajas), peso: l.peso_lb > 0 ? String(l.peso_lb) : '', costo: String(l.costo), congelado: l.congelado })));
    setEditandoId(compra.id);
    setError('');
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  function cancelarEdicion() {
    setEditandoId(null); setReferencia(''); setFecha(fechaDentroDeSemana(semana));
    setLineas([nuevaLinea(String(productosCompra[0]?.id ?? ''))]); setError('');
  }
  async function cambiarLote(id: number, valor: boolean) { setBusy(true); setError(''); try { await api(`/operacion/lotes/${id}`, { method: 'PATCH', body: { congelado: valor } }); await onDone('Lote actualizado.'); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo actualizar el lote.'); } finally { setBusy(false); } }
  async function pagarCompra(id: number) { setBusy(true); setError(''); try { await api(`/cierre/compras/${id}/pagar`, { method: 'POST', body: { fecha_pago: hoy() } }); await onDone('Compra marcada como pagada.'); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo marcar la compra pagada.'); } finally { setBusy(false); } }
  async function eliminarCompra(id: number) {
    if (!window.confirm('Se eliminará la compra y se restarán sus cajas, peso y costo del inventario. Solo puede hacerse si todavía no fue utilizada. ¿Continuar?')) return;
    setBusy(true); setError('');
    try {
      await api(`/operacion/compras/${id}`, { method: 'DELETE' });
      await onDone('Compra eliminada e inventario revertido.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo eliminar la compra.'); } finally { setBusy(false); }
  }
  return <div className="operation-stack">
    <section className="workspace-card form-workspace" ref={editorRef}>
        <div className="workspace-card-head"><div><h2>{editandoId == null ? 'Nueva compra' : `Editar compra #${editandoId}`}</h2>{editandoId != null && <p>Actualiza los datos y guarda una sola vez.</p>}</div><div className="segmented segmented--small"><button disabled={editandoId != null} className={linea === 'carne' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setLinea('carne')}>Carne</button><button disabled={editandoId != null} className={linea === 'desechables' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setLinea('desechables')}>Desechables</button></div></div>
        <div className="form-grid form-grid--purchase">
          <label className="field"><span>Proveedor</span><select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>{catalogo.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
          <label className="field"><span>Fecha</span><input type="date" min={semana.inicio} max={semana.fin} value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
          <label className="field field--wide"><span>Factura / referencia</span><input value={referencia} onChange={(e) => setReferencia(e.target.value)} /></label>
        </div>
        <div className="purchase-lines">
          {lineas.map((l, indice) => { const seleccionado = productosCompra.find((p) => String(p.id) === l.producto); const requierePeso = seleccionado?.tipo === 'materia_prima'; const pesoCaja = Number(l.cajas) > 0 ? Number(l.peso) / Number(l.cajas) : 0; return <div className="purchase-line" key={l.clave}>
            <span className="purchase-line__number">{indice + 1}</span>
            <label className="field"><span>Producto</span><select value={l.producto} onChange={(e) => editarLinea(l.clave, { producto: e.target.value })}>{productosCompra.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            <label className="field field--number"><span>{seleccionado?.unidad ?? 'Cantidad'}</span><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={l.cajas} onChange={(e) => editarLinea(l.clave, { cajas: e.target.value })} /></label>
            {requierePeso ? <label className="field field--number"><span>Peso total</span><div className="input-suffix"><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={l.peso} onChange={(e) => editarLinea(l.clave, { peso: e.target.value })} /><span>lb</span></div><small>{pesoCaja.toFixed(2)} lb/caja</small></label> : <span />}
            <label className="field field--number"><span>Total</span><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={l.costo} onChange={(e) => editarLinea(l.clave, { costo: e.target.value })} /></div></label>
            {requierePeso && <label className="check-card"><input type="checkbox" checked={l.congelado} onChange={(e) => editarLinea(l.clave, { congelado: e.target.checked })} /><span><strong>Congelado</strong></span></label>}
            {lineas.length > 1 && <button type="button" className="icon-btn" aria-label="Quitar renglón" onClick={() => setLineas((actuales) => actuales.filter((fila) => fila.clave !== l.clave))}>×</button>}
          </div>; })}
          <button type="button" className="btn btn-secondary btn-sm purchase-add" onClick={() => setLineas((actuales) => [...actuales, nuevaLinea(String(productosCompra[0]?.id ?? ''))])}>+ Agregar producto</button>
        </div>
        <div className="form-submit form-submit--summary"><div className="form-summary"><span>{lineas.length} renglón{lineas.length === 1 ? '' : 'es'}</span><span>Total <strong>{usd(totalCompra)}</strong></span></div><div className="form-actions">{editandoId != null && <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancelarEdicion}>Cancelar</button>}<button className="btn btn-primary" disabled={bloqueada || busy || !proveedor || !lineasValidas} onClick={() => void guardar()}>{busy ? 'Guardando…' : bloqueada ? 'Semana cerrada' : editandoId == null ? 'Guardar compra' : 'Guardar cambios'}</button></div></div>
    </section>

    {semana.actual && resumen.lotes.length > 0 && <CollapsibleSection title="Materia prima disponible" count={`${resumen.lotes.length} lotes`} defaultOpen={false}>
      <div className="lot-grid">{resumen.lotes.map((l) => <article className="lot-card" key={l.id}><div className="card-head"><strong>{l.producto}</strong><span className={`chip ${l.congelado ? 'chip--info' : 'chip--ok'}`}>{l.congelado ? 'Congelado' : 'Fresco'}</span></div><div className="lot-value">{l.cajas} <small>cajas</small></div><p>{l.peso_lb.toLocaleString('es-MX')} lb · {l.cajas > 0 ? (l.peso_lb / l.cajas).toFixed(2) : '0.00'} lb/caja<br />{usd(l.costo)} · {l.cajas > 0 ? usd(l.costo / l.cajas) : usd(0)}/caja</p><footer><span>{l.fecha}</span><button className="link-btn" disabled={busy} onClick={() => void cambiarLote(l.id, !l.congelado)}>{l.congelado ? 'Descongelar' : 'Congelar'}</button></footer></article>)}</div>
    </CollapsibleSection>}

    <CollapsibleSection title="Compras registradas" count={resumen.cantidad_compras} summary={`Total ${usd(resumen.total_compras)}`}>
      <div className="record-list">{resumen.compras.map((c) => <article className="record-row" key={c.id}><div className="record-main"><strong>{c.proveedor}</strong><span>{c.fecha}{c.referencia ? ` · ${c.referencia}` : ''} · vence {c.vence_at}</span>{c.lineas.map((l, i) => <small key={i}>{l.producto} · {l.cajas} cajas{l.peso_lb > 0 ? ` · ${l.peso_lb} lb (${(l.peso_lb / l.cajas).toFixed(2)} lb/caja)` : ''} · {usd(l.costo)}{l.congelado ? ' · congelado' : ''}</small>)}</div><div className="record-total"><strong>{usd(c.total)}</strong><span className={`chip ${c.estado === 'pendiente' ? 'chip--warn' : 'chip--ok'}`}>{c.estado}</span><div className="record-actions">{c.estado === 'pendiente' && <><button className="btn btn-secondary btn-sm" disabled={bloqueada || busy} onClick={() => editarCompra(c)}>Editar</button><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void pagarCompra(c.id)}>Marcar pagada</button></>}<button className="btn btn-danger-ghost btn-sm" disabled={bloqueada || busy} onClick={() => void eliminarCompra(c.id)}>Eliminar</button></div></div></article>)}</div>
    </CollapsibleSection>
  </div>;
}

interface ProduccionBorrador {
  id: number;
  materia: string;
  entrada: string;
  salidas: Record<number, string>;
}

function estimarConsumoDesde(
  lotes: Resumen['lotes'],
  omitirCajas: number,
  tomarCajas: number,
) {
  const desde = Math.max(0, omitirCajas);
  const hasta = desde + Math.max(0, tomarCajas);
  let cursor = 0; let pesoTotal = 0; let costoTotal = 0;
  for (const lote of lotes) {
    const finLote = cursor + lote.cajas;
    const cajas = Math.max(0, Math.min(hasta, finLote) - Math.max(desde, cursor));
    if (cajas > 0 && lote.cajas > 0) {
      pesoTotal += lote.peso_lb * (cajas / lote.cajas);
      costoTotal += lote.costo * (cajas / lote.cajas);
    }
    cursor = finLote;
    if (cursor >= hasta) break;
  }
  return { pesoTotal, costoTotal };
}

function Produccion({ catalogo, resumen, semana, bloqueada, busy, setBusy, onDone, setError }: { catalogo: Catalogo; resumen: Resumen; semana: SemanaSeleccionada; bloqueada: boolean; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const toast = useToast();
  const carniceria = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && u.nombre.toLowerCase().includes('carnicer'));
  const materias = catalogo.productos.filter((p) => p.tipo === 'materia_prima');
  const siguienteId = useRef(2);
  const crearBorrador = (materia = String(materias[0]?.id ?? '')): ProduccionBorrador => ({ id: siguienteId.current++, materia, entrada: '', salidas: {} });
  const [fecha, setFecha] = useState(fechaDentroDeSemana(semana));
  const [borradores, setBorradores] = useState<ProduccionBorrador[]>(() => [{ id: 1, materia: String(materias[0]?.id ?? ''), entrada: '', salidas: {} }]);
  const [produccionesAbiertas, setProduccionesAbiertas] = useState<Set<number>>(() => new Set());
  const fechasProduccion = useMemo(() => {
    const opciones: { fecha: string; dia: string; numero: number; mes: string }[] = [];
    for (let iso = semana.inicio; iso <= semana.fin;) {
      const actual = new Date(`${iso}T12:00:00`);
      opciones.push({ fecha: iso, dia: diasLargos[actual.getDay()], numero: actual.getDate(), mes: actual.toLocaleDateString('es-MX', { month: 'short' }).replace('.', '') });
      actual.setDate(actual.getDate() + 1);
      iso = `${actual.getFullYear()}-${String(actual.getMonth() + 1).padStart(2, '0')}-${String(actual.getDate()).padStart(2, '0')}`;
    }
    return opciones;
  }, [semana.inicio, semana.fin]);

  useEffect(() => {
    setFecha(fechaDentroDeSemana(semana));
    setBorradores([{ id: siguienteId.current++, materia: String(materias[0]?.id ?? ''), entrada: '', salidas: {} }]);
    setProduccionesAbiertas(new Set());
  }, [semana.inicio, semana.fin]);

  function actualizar(idBorrador: number, cambio: Partial<ProduccionBorrador>) {
    setBorradores((actuales) => actuales.map((b) => b.id === idBorrador ? { ...b, ...cambio } : b));
  }

  function agregarProducto() {
    if (borradores.length >= 12) return;
    const materiasUsadas = new Set(borradores.map((b) => b.materia));
    const siguiente = materias.find((m) => !materiasUsadas.has(String(m.id))) ?? materias[0];
    setBorradores((actuales) => [...actuales, crearBorrador(String(siguiente?.id ?? ''))]);
  }

  const calculos = borradores.map((borrador, indice) => {
    const materia = materias.find((p) => String(p.id) === borrador.materia);
    const recetasMateria = catalogo.recetas_produccion.filter((r) => r.materia_prima_id === materia?.id);
    const terminados = recetasMateria.map((r) => catalogo.productos.find((p) => p.id === r.producto_salida_id)).filter((p): p is Catalogo['productos'][number] => Boolean(p));
    const subproductos = new Set(recetasMateria.filter((r) => r.sin_costo).map((r) => r.producto_salida_id));
    const lotesMateria = resumen.lotes.filter((l) => String(l.product_id) === borrador.materia);
    const lotesFrescos = lotesMateria.filter((l) => !l.congelado && l.fecha <= semana.fin).sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id - b.id);
    const cajasFrescas = lotesFrescos.reduce((a, l) => a + l.cajas, 0);
    const cajasCongeladas = lotesMateria.filter((l) => l.congelado).reduce((a, l) => a + l.cajas, 0);
    const entrada = Number(borrador.entrada || 0);
    const entradaAnterior = borradores.slice(0, indice).filter((b) => b.materia === borrador.materia).reduce((a, b) => a + Number(b.entrada || 0), 0);
    const entradaTotal = borradores.filter((b) => b.materia === borrador.materia).reduce((a, b) => a + Number(b.entrada || 0), 0);
    const consumo = estimarConsumoDesde(lotesFrescos, entradaAnterior, entrada);
    const pesoSalida = terminados.reduce((a, p) => a + Number(borrador.salidas[p.id] || 0) * (p.peso_caja_lb ?? 0), 0);
    const cajasSalida = terminados.filter((p) => p.tipo === 'proteina').reduce((a, p) => a + Number(borrador.salidas[p.id] || 0), 0);
    const piezasSubproducto = terminados.filter((p) => subproductos.has(p.id)).reduce((a, p) => a + Number(borrador.salidas[p.id] || 0), 0);
    const insuficiente = entradaTotal > cajasFrescas + 0.0001;
    const pesoExcedido = pesoSalida > consumo.pesoTotal + 0.001;
    const valida = Boolean(materia && entrada > 0 && cajasSalida > 0 && terminados.length && !insuficiente && !pesoExcedido);
    return { borrador, materia, terminados, subproductos, lotesFrescos, cajasFrescas, cajasCongeladas, entrada, consumo, pesoSalida, cajasSalida, piezasSubproducto, insuficiente, pesoExcedido, valida };
  });

  const capturaValida = calculos.length > 0 && calculos.every((c) => c.valida);
  const cajasEntradaTotal = calculos.reduce((a, c) => a + c.entrada, 0);
  const cajasSalidaTotal = calculos.reduce((a, c) => a + c.cajasSalida, 0);
  const piezasSubproductoTotal = calculos.reduce((a, c) => a + c.piezasSubproducto, 0);
  const productosTerminadosTotal = calculos.reduce((a, c) => a + c.terminados.filter((p) => Number(c.borrador.salidas[p.id] || 0) > 0).length, 0);
  const pesoEntradaTotal = calculos.reduce((a, c) => a + c.consumo.pesoTotal, 0);
  const pesoSalidaTotal = calculos.reduce((a, c) => a + c.pesoSalida, 0);

  async function guardar() {
    if (!carniceria) { setError('Falta crear la ubicación Carnicería.'); return; }
    if (!capturaValida) { setError('Completa cada producto y revisa que la producción no exceda la materia prima disponible.'); return; }
    setBusy(true); setError('');
    try {
      await api('/operacion/produccion/lote', {
        method: 'POST',
        body: {
          producciones: calculos.map((c) => ({
            ubicacion_id: carniceria.id,
            materia_prima_id: Number(c.borrador.materia),
            fecha,
            cajas_materia_prima: c.entrada,
            salidas: c.terminados.filter((p) => Number(c.borrador.salidas[p.id] || 0) > 0).map((p) => ({ product_id: p.id, cajas: Number(c.borrador.salidas[p.id]) })),
          })),
        },
      });
      const cantidad = borradores.length;
      setBorradores([crearBorrador()]);
      await onDone();
      toast.ok(`${cantidad} ${cantidad === 1 ? 'producción guardada' : 'producciones guardadas'} correctamente.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la producción.'); } finally { setBusy(false); }
  }
  async function eliminar(id: number) {
    if (!window.confirm('¿Eliminar este batch? Se revertirán la materia prima, las cajas producidas y sus costos.')) return;
    setBusy(true); setError('');
    try {
      await api(`/operacion/produccion/${id}`, { method: 'DELETE' });
      await onDone();
      toast.ok('Producción eliminada y saldos recalculados.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo eliminar la producción.'); }
    finally { setBusy(false); }
  }
  function alternarProduccion(id: number) {
    setProduccionesAbiertas((actuales) => {
      const siguientes = new Set(actuales);
      if (siguientes.has(id)) siguientes.delete(id); else siguientes.add(id);
      return siguientes;
    });
  }
  const todasProduccionesAbiertas = resumen.producciones.length > 0 && resumen.producciones.every((p) => produccionesAbiertas.has(p.id));
  return <div className="operation-stack">
    <section className="workspace-card production-capture">
      <div className="workspace-card-head production-capture-head"><div><h2>Nueva producción</h2></div><div className="production-day-picker"><span>Día · semana {semana.numero}</span><div role="group" aria-label={`Día de producción de la semana ${semana.numero}`}>{fechasProduccion.map((opcion) => <button type="button" key={opcion.fecha} className={fecha === opcion.fecha ? 'is-active' : ''} aria-pressed={fecha === opcion.fecha} onClick={() => setFecha(opcion.fecha)}><strong>{opcion.dia}</strong><small>{opcion.numero} {opcion.mes}</small></button>)}</div></div></div>
      <div className="production-drafts">
        {calculos.map((calculo, indice) => {
          const { borrador, materia, terminados, cajasFrescas, cajasCongeladas, consumo, pesoSalida, insuficiente, pesoExcedido } = calculo;
          const yieldActual = consumo.pesoTotal > 0 ? (pesoSalida / consumo.pesoTotal) * 100 : 0;
          return <article className={`production-draft ${insuficiente || pesoExcedido ? 'is-alert' : ''}`} key={borrador.id}>
            <header><div><span className="step-badge">{indice + 1}</span><div><strong>{materia?.nombre ?? 'Producto'}</strong><small>Batch del {fecha}</small></div></div>{borradores.length > 1 && <button type="button" className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={() => setBorradores((actuales) => actuales.filter((b) => b.id !== borrador.id))}>Quitar</button>}</header>
            <div className="form-grid production-draft-fields">
              <label className="field"><span>Materia prima utilizada</span><select value={borrador.materia} onChange={(e) => actualizar(borrador.id, { materia: e.target.value, salidas: {} })}>{materias.map((p) => { const disponibles = resumen.lotes.filter((l) => l.product_id === p.id && !l.congelado && l.fecha <= semana.fin).reduce((a, l) => a + l.cajas, 0); return <option key={p.id} value={p.id}>{p.nombre} · {disponibles.toLocaleString('es-MX')} frescas</option>; })}</select></label>
              <label className="field field--number"><span>Cajas de materia prima</span><input type="number" min="0" step="0.5" inputMode="decimal" placeholder="0" value={borrador.entrada} onChange={(e) => actualizar(borrador.id, { entrada: e.target.value })} /></label>
            </div>
            <div className={`production-stock-link ${insuficiente ? 'is-alert' : ''}`}><span><strong>Disponible</strong>{cajasFrescas.toLocaleString('es-MX')} cajas frescas{cajasCongeladas > 0 ? ` · ${cajasCongeladas.toLocaleString('es-MX')} congeladas` : ''}</span><span>{consumo.pesoTotal.toFixed(1)} lb usadas · {usd(consumo.costoTotal)}</span></div>
            {insuficiente && <p className="error-msg">La suma de filas con esta materia prima supera las cajas frescas disponibles.</p>}
            <div className="form-divider"><span>Producción terminada y subproductos</span><small>Entrada estimada: {consumo.pesoTotal.toFixed(1)} lb</small></div>
            <div className="production-output-list">{terminados.map((p) => { const esSubproducto = calculo.subproductos.has(p.id); return <label className={`production-output ${esSubproducto ? 'production-output--byproduct' : ''}`} key={p.id}><span><strong>{p.nombre}</strong><small>{esSubproducto ? `Subproducto del remanente · sin costo · venta ${usd(p.precio ?? 0)}/${p.unidad.toLowerCase()}` : `${p.peso_caja_lb ?? '?'} lb/caja · ${p.produccion_dias.map((d) => dias[d]).join(', ') || 'especial'}`}</small></span><div className="input-suffix input-suffix--compact"><input type="number" min="0" step={esSubproducto ? '1' : '0.5'} inputMode="decimal" value={borrador.salidas[p.id] ?? ''} placeholder="0" onChange={(e) => actualizar(borrador.id, { salidas: { ...borrador.salidas, [p.id]: e.target.value } })} /><span>{p.unidad.toLowerCase()}</span></div></label>; })}</div>
            {!terminados.length && <div className="empty-state"><strong>Sin receta configurada</strong><span>Selecciona otra materia prima.</span></div>}
            <footer><span>Salida {pesoSalida.toFixed(1)} lb</span><span className={yieldActual > 100 ? 'text-danger' : ''}>Yield {yieldActual.toFixed(1)}%</span></footer>
            {pesoExcedido && <p className="error-msg">El peso terminado supera el peso de materia prima calculado.</p>}
          </article>;
        })}
      </div>
      <button type="button" className="btn btn-secondary production-add" disabled={busy || bloqueada || borradores.length >= 12 || !materias.length} onClick={agregarProducto}>+ Agregar otro producto</button>
      <div className="production-capture-summary"><div><span><small>Productos</small><strong>{productosTerminadosTotal}</strong></span><span><small>Materia prima</small><strong>{cajasEntradaTotal.toLocaleString('es-MX')} cajas</strong></span><span><small>Producto terminado</small><strong>{cajasSalidaTotal.toLocaleString('es-MX')} cajas{piezasSubproductoTotal > 0 ? ` · ${piezasSubproductoTotal.toLocaleString('es-MX')} piezas` : ''}</strong></span><span><small>Yield principal</small><strong>{pesoEntradaTotal > 0 ? ((pesoSalidaTotal / pesoEntradaTotal) * 100).toFixed(1) : '0.0'}%</strong></span></div><button className="btn btn-primary" disabled={bloqueada || busy || !capturaValida} onClick={() => void guardar()}>{busy ? 'Guardando todo…' : bloqueada ? 'Semana cerrada' : borradores.length === 1 ? 'Guardar producción' : `Guardar ${borradores.length} producciones`}</button></div>
    </section>

    <CollapsibleSection title="Resumen semanal por proteína" count={resumen.resumen_proteinas.length} summary="Costo por caja + $15">
      {resumen.resumen_proteinas.length === 0 ? <div className="empty-state"><strong>Sin producción registrada</strong><span>El resumen aparecerá al guardar las proteínas de esta semana.</span></div> : <div className="protein-summary-list">
        {resumen.resumen_proteinas.map((p) => <article className="protein-summary-row" key={p.product_id}>
          <div className="protein-summary-name"><strong>{p.producto}</strong><span>{p.cajas.toLocaleString('es-MX')} cajas producidas</span></div>
          <div><small>Costo total</small><strong>{usd(p.costo_total)}</strong></div>
          <div><small>Costo por caja</small><strong>{usd(p.costo_caja)}</strong></div>
          <div className="protein-summary-markup"><small>Markup por caja</small><strong>+{usd(p.markup_caja)}</strong></div>
          <div className="protein-summary-sale"><small>Venta por caja</small><strong>{usd(p.precio_venta_caja)}</strong></div>
          <div><small>Venta total</small><strong>{usd(p.venta_total)}</strong></div>
        </article>)}
      </div>}
    </CollapsibleSection>

    <section className="workspace-card"><div className="workspace-card-head batch-list-heading"><div><h2>Producción registrada</h2><p>{resumen.producciones.length} batch{resumen.producciones.length === 1 ? '' : 'es'} esta semana</p></div>{resumen.producciones.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProduccionesAbiertas(todasProduccionesAbiertas ? new Set() : new Set(resumen.producciones.map((p) => p.id)))}>{todasProduccionesAbiertas ? 'Colapsar todo' : 'Expandir todo'}</button>}</div>
      <div className="batch-list">{resumen.producciones.map((p) => {
        const abierta = produccionesAbiertas.has(p.id);
        const resumenSalidas = p.salidas.map((s) => `${s.producto}: ${s.cajas}`).join(' · ');
        return <article className={`batch-card ${abierta ? 'is-open' : 'is-collapsed'}`} key={p.id}>
          <header><button type="button" className="batch-collapse-button" aria-expanded={abierta} aria-controls={`batch-${p.id}`} onClick={() => alternarProduccion(p.id)}><span><strong>{p.materia_prima}</strong><small>{p.fecha}{resumenSalidas ? ` · ${resumenSalidas}` : ''}</small></span><i aria-hidden="true">⌄</i></button><div className="batch-card-actions"><span className="yield-pill">Yield {p.yield.toFixed(1)}%</span><button className="btn btn-danger-ghost btn-sm" disabled={bloqueada || busy} onClick={() => void eliminar(p.id)}>Eliminar</button></div></header>
          {abierta && <div id={`batch-${p.id}`} className="batch-card-detail"><div className="batch-metrics"><span><small>Materia prima</small><strong>{p.cajas_entrada} cajas compradas · {p.peso_entrada_lb} lb</strong></span><span><small>Producto terminado</small><strong>{p.peso_salida_lb} lb</strong></span><span><small>Remanente / subproductos</small><strong>{p.desperdicio_lb} lb</strong></span><span><small>Costo total del batch</small><strong>{usd(p.costo)}</strong></span></div><div className="batch-outputs">{p.salidas.map((s, i) => { const esProteina = s.tipo === 'proteina'; const precioCaja = esProteina ? s.costo_caja + MARKUP_PROTEINA : s.precio; return <div key={i}><span><strong>{s.producto}</strong><small>{s.cajas} {s.unidad.toLowerCase()}{s.cajas === 1 ? '' : 's'} terminada{s.cajas === 1 ? '' : 's'}</small></span><span className="batch-output-prices"><small>Costo por {s.unidad.toLowerCase()}</small><strong>{usd(s.costo_caja)}</strong><small>Venta por {s.unidad.toLowerCase()}</small><strong>{usd(precioCaja)}</strong>{esProteina && <em>+{usd(MARKUP_PROTEINA)} por caja</em>}</span></div>; })}</div></div>}
        </article>;
      })}</div>
    </section>
  </div>;
}

function Rutas({ catalogo, busy, setBusy, onDone, setError }: { catalogo: Catalogo; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [edits, setEdits] = useState<Record<number, Catalogo['plantillas'][number]['paradas']>>({});
  const [conductores, setConductores] = useState<Record<number, string>>({});
  function mover(pid: number, i: number, delta: number) { const a = [...(edits[pid] ?? catalogo.plantillas.find((p) => p.id === pid)!.paradas)]; const j = i + delta; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setEdits({ ...edits, [pid]: a }); }
  function quitar(pid: number, ubicacionId: number) { const p = catalogo.plantillas.find((x) => x.id === pid)!; setEdits({ ...edits, [pid]: (edits[pid] ?? p.paradas).filter((x) => x.ubicacion_id !== ubicacionId) }); }
  function alternarOpcional(pid: number, ubicacionId: number) { const p = catalogo.plantillas.find((x) => x.id === pid)!; setEdits({ ...edits, [pid]: (edits[pid] ?? p.paradas).map((x) => x.ubicacion_id === ubicacionId ? { ...x, opcional: !x.opcional } : x) }); }
  function agregar(pid: number, ubicacionId: number) { if (!ubicacionId) return; const p = catalogo.plantillas.find((x) => x.id === pid)!; const a = edits[pid] ?? p.paradas; if (a.some((x) => x.ubicacion_id === ubicacionId)) return; const u = catalogo.ubicaciones.find((x) => x.id === ubicacionId); if (!u) return; setEdits({ ...edits, [pid]: [...a, { ubicacion_id: u.id, nombre: u.nombre, orden: a.length + 1, opcional: false }] }); }
  async function guardar(p: Catalogo['plantillas'][number]) { setBusy(true); setError(''); try { const a = edits[p.id] ?? p.paradas; await api(`/operacion/plantillas/${p.id}`, { method: 'PATCH', body: { conductor: conductores[p.id] ?? p.conductor, paradas: a.map((x, i) => ({ ubicacion_id: x.ubicacion_id, orden: i + 1, opcional: x.opcional })) } }); setEdits({ ...edits, [p.id]: undefined as never }); setConductores({ ...conductores, [p.id]: undefined as never }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la ruta.'); } finally { setBusy(false); } }
  return <div className="route-template-grid">{catalogo.plantillas.map((p) => { const a = edits[p.id] ?? p.paradas; const cambiado = Boolean(edits[p.id]) || conductores[p.id] != null; return <CollapsibleSection title={p.nombre} count={`${a.length} paradas`} summary={`${p.linea} · ${dias[p.dia_semana]}`} className={`route-template route-template--${p.linea}`} key={p.id}>
    <div className="route-template-actions"><button className="btn btn-primary btn-sm" disabled={busy || !cambiado} onClick={() => void guardar(p)}>Guardar cambios</button></div>
    <label className="field route-driver"><span>Responsable de ruta</span><input value={conductores[p.id] ?? p.conductor} onChange={(e) => setConductores({ ...conductores, [p.id]: e.target.value })} /></label>
    <div className="route-stop-list">{a.map((x, i) => <div className="route-stop" key={x.ubicacion_id}><span className="route-stop-number">{i + 1}</span><span className="route-stop-name"><strong>{x.nombre}</strong><button className={x.opcional ? 'optional-toggle is-on' : 'optional-toggle'} onClick={() => alternarOpcional(p.id, x.ubicacion_id)}>{x.opcional ? 'Parada opcional' : 'Parada fija'}</button></span><span className="route-stop-actions"><button className="icon-btn" aria-label="Subir parada" disabled={i === 0} onClick={() => mover(p.id, i, -1)}>↑</button><button className="icon-btn" aria-label="Bajar parada" disabled={i === a.length - 1} onClick={() => mover(p.id, i, 1)}>↓</button><button className="icon-btn btn-peligro" aria-label="Quitar parada" onClick={() => quitar(p.id, x.ubicacion_id)}>×</button></span></div>)}</div>
    <label className="route-add"><span>Agregar restaurante</span><select value="" onChange={(e) => agregar(p.id, Number(e.target.value))}><option value="">Seleccionar…</option>{catalogo.ubicaciones.filter((u) => u.tipo === 'sucursal' && !a.some((x) => x.ubicacion_id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>
  </CollapsibleSection>; })}</div>;
}

function ConciliacionSemanal({ semana, busy, setBusy, setError }: { semana: SemanaSeleccionada; busy: boolean; setBusy: (v: boolean) => void; setError: (v: string) => void }) {
  const toast = useToast();
  const [reporte, setReporte] = useState<Conciliacion | null>(null);
  async function cargar() {
    try { setReporte(await api<Conciliacion>(`/operacion/conciliacion?desde=${semana.inicio}&hasta=${semana.fin}`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo calcular la conciliación semanal.'); }
  }
  useEffect(() => { setReporte(null); void cargar(); }, [semana.inicio, semana.fin]);
  async function fijarInicio() {
    setBusy(true); setError('');
    try {
      await api('/operacion/conciliacion/inicializar', { method: 'POST', body: { desde: semana.inicio } });
      await cargar(); toast.ok('Inventario inicial fijado sin modificar existencias.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo fijar el inventario inicial.'); }
    finally { setBusy(false); }
  }
  const q = (n: number) => Math.abs(n) < 0.0001 ? '—' : n.toLocaleString('es-MX', { maximumFractionDigits: 3 });
  if (!reporte) return <section className="workspace-card"><Spinner label="Calculando conciliación…" /></section>;
  return <section className="workspace-card weekly-reconciliation">
    <div className="workspace-card-head">
      <div><span className="eyebrow">Auditoría de Carnicería</span><h2>Conciliación semanal</h2><p>Inicio + compras y producción − salidas reales = inventario teórico.</p></div>
      {!reporte.inicial_fijado && <button className="btn btn-primary" disabled={busy} onClick={() => void fijarInicio()}>Fijar inventario inicial</button>}
    </div>
    <div className="reconciliation-status">
      <span className={`chip ${reporte.inicial_fijado ? 'chip--ok' : 'chip--warn'}`}>{reporte.inicial_fijado ? 'Inicio fijado' : reporte.origen_inicial === 'cierre_anterior' ? 'Inicio tomado del sábado anterior' : 'Inicio reconstruido, falta fijar'}</span>
      <span className={`chip ${reporte.final_capturado ? 'chip--ok' : 'chip--warn'}`}>{reporte.final_capturado ? 'Físico final capturado' : 'Falta inventario final'}</span>
      {reporte.resumen.saldos_provisionales > 0 && <span className="chip chip--danger">{reporte.resumen.saldos_provisionales} saldos pendientes</span>}
      {reporte.resumen.diferencias_fisicas > 0 && <span className="chip chip--warn">{reporte.resumen.diferencias_fisicas} diferencias documentadas</span>}
    </div>
    <div className="reconciliation-links"><Link to={`/semana/produccion?semana=${semana.inicio}`}>Corregir producción</Link><Link to={`/semana/inventario?semana=${semana.inicio}`}>Capturar físico final</Link></div>
    <CollapsibleSection title="Detalle de conciliación" count={reporte.filas.length} defaultOpen={false}><div className="reconciliation-table-wrap"><table className="reconciliation-table"><thead><tr><th>Producto</th><th>Inicio</th><th>+ Entradas L–X</th><th>− Uso/salida X</th><th>Saldo miércoles</th><th>+ Entradas J–S</th><th>− Uso/salida S</th><th>Teórico final</th><th>Físico final</th><th>Diferencia</th></tr></thead><tbody>{reporte.filas.map((f) => {
      const entradas1 = f.compras1 + f.produccionSalida1; const salidas1 = f.produccionEntrada1 + f.salidas1;
      const entradas2 = f.compras2 + f.produccionSalida2; const salidas2 = f.produccionEntrada2 + f.salidas2;
      const diferencia = f.diferenciaFinal ?? 0;
      return <tr key={f.product_id} className={Math.abs(diferencia) > 0.0001 || f.actual < -0.0001 ? 'is-different' : ''}><td><strong>{f.nombre}</strong><small>{f.tipo?.replaceAll('_', ' ')} · pedidos {q(f.pedidos1)} / {q(f.pedidos2)}</small></td><td>{q(f.inicial)}</td><td>{q(entradas1)}</td><td>{q(salidas1)}</td><td><strong>{q(f.saldoMiercoles)}</strong></td><td>{q(entradas2)}</td><td>{q(salidas2)}</td><td><strong>{q(f.teoricoFinal)}</strong></td><td>{f.fisico_final == null ? 'Pendiente' : q(f.fisico_final)}</td><td className={Math.abs(diferencia) > 0.0001 ? 'txt-danger' : ''}>{f.diferenciaFinal == null ? '—' : q(diferencia)}</td></tr>;
    })}</tbody></table></div></CollapsibleSection>
    {!reporte.filas.length && <div className="empty-state"><strong>Sin movimiento de carne</strong><span>No hay productos que conciliar en esta semana.</span></div>}
  </section>;
}

function Cierres({ cierres, semana, busy, setBusy, onDone, setError }: { cierres: Cierre[]; semana: SemanaSeleccionada; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const [factura, setFactura] = useState<Factura | null>(null);
  useEffect(() => setFactura(null), [semana.inicio, semana.fin]);
  async function cerrar() { setBusy(true); setError(''); try { await api('/cierre/cerrar', { method: 'POST', body: { fecha_cierre: semana.fin } }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo cerrar la semana.'); } finally { setBusy(false); } }
  const nombresExcel: Record<string, string> = { 'weekly-order': '1. Weekly Order 2026 3Q.xlsx', disposables: '2. Disposables 2026 3Q.xlsx', production: '3. Production 2026 3Q.xlsx', billing: '4. Billing 2026 3Q.xlsx', lbt: '5. LBT 2026 3Q.xlsx', aurora: '6. Taqueria Aurora 2026 3Q.xlsx' };
  async function descargar(id: number, tipo: string) { const res = await fetch(`/api/cierre/${id}/excel/${tipo}`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (!res.ok) { setError('No se pudo generar el Excel.'); return; } const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = nombresExcel[tipo] ?? `${tipo}.xlsx`; a.click(); URL.revokeObjectURL(url); }
  async function pagar(f: Factura) { setBusy(true); setError(''); try { await api(`/cierre/facturas/${f.id}/pagar`, { method: 'POST', body: { fecha_pago: hoy() } }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo registrar el pago.'); } finally { setBusy(false); } }
  async function reabrir(id: number) { if (!window.confirm('Se anularán las facturas y se revertirá el inventario final de esta semana. Después podrás corregir compras o producción y capturar de nuevo el físico final. ¿Continuar?')) return; setBusy(true); setError(''); try { await api(`/cierre/${id}/reabrir`, { method: 'POST' }); await onDone(); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo reabrir la semana.'); } finally { setBusy(false); } }
  const libros = [['weekly-order', 'Weekly Order'], ['disposables', 'Disposables'], ['production', 'Production'], ['billing', 'Billing'], ['lbt', 'LBT'], ['aurora', 'Aurora']] as const;
  const cierreSeleccionado = cierres.find((s) => s.anio === semana.anio && s.semana === semana.numero);
  return <div className="operation-stack">
    <ConciliacionSemanal semana={semana} busy={busy} setBusy={setBusy} setError={setError} />
    <section className="close-week-card"><div><span className="eyebrow">Semana {semana.numero}</span><h2>Cerrar y facturar</h2><p>{semana.inicio} al {semana.fin}</p></div><div className="close-week-action"><button className="btn btn-primary" disabled={busy || semana.fin > hoy() || cierreSeleccionado?.estado === 'cerrada'} onClick={() => void cerrar()}>{busy ? 'Procesando…' : cierreSeleccionado?.estado === 'cerrada' ? 'Semana cerrada' : semana.fin > hoy() ? 'Semana en curso' : 'Cerrar semana'}</button></div></section>

    <div className="week-list">{cierreSeleccionado ? [cierreSeleccionado].map((s) => <section className="week-card" key={s.id}><header><div><span className={`status-dot status-dot--${s.estado}`} /> <strong>Semana {s.semana} · {s.anio}</strong><p>{s.inicia_at} al {s.termina_at}</p></div><div className="week-balance"><span>Balance</span><strong>{usd(s.balance_neto)}</strong></div></header>
      <div className="metric-strip metric-strip--five"><div><span>Carne</span><strong>{usd(s.valor_carne)}</strong></div><div><span>Congelado</span><strong>{usd(s.valor_congelado)}</strong></div><div><span>Desechables</span><strong>{usd(s.valor_desechables)}</strong></div><div><span>Por cobrar</span><strong>{usd(s.cuentas_por_cobrar)}</strong></div><div><span>Por pagar</span><strong>{usd(s.cuentas_por_pagar)}</strong></div></div>
      <div className="week-toolbar"><div className="export-menu">{libros.map(([tipo, label]) => <button className="export-chip" key={tipo} onClick={() => void descargar(s.id, tipo)}>{label}<small>.xlsx</small></button>)}</div>{s.estado === 'cerrada' && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void reabrir(s.id)}>Reabrir semana</button>}</div>
      <CollapsibleSection title="Facturas" count={s.facturas.length}><div className="invoice-list"><div className="invoice-row invoice-row--head"><span>Factura</span><span>Empresa / ubicación</span><span>Vencimiento</span><span>Estado</span><span>Total</span><span /></div>{s.facturas.map((f) => <div className="invoice-row" key={f.id}><button className="invoice-number" onClick={() => setFactura(f)}>{f.numero}<small>v{f.version} · {f.linea}</small></button><span data-label="Ubicación"><strong>{f.ubicacion}</strong><small>{f.empresa}</small></span><span data-label="Vence">{f.vence_at}</span><span data-label="Estado"><span className={`chip ${f.estado === 'pagada' ? 'chip--ok' : 'chip--warn'}`}>{f.estado}</span></span><span data-label="Total"><strong>{usd(f.total)}</strong></span><span>{f.estado === 'emitida' && <button className="link-btn" disabled={busy} onClick={() => void pagar(f)}>Marcar pagada</button>}</span></div>)}</div></CollapsibleSection>
    </section>) : <div className="empty-state workspace-card"><strong>Semana {semana.numero} todavía abierta</strong><span>Al cerrarla se generarán facturas, balances y libros Excel de este periodo.</span></div>}</div>
    {factura && <div className="modal-backdrop" onClick={() => setFactura(null)}><div className="modal-card invoice-print" onClick={(e) => e.stopPropagation()}><div className="card-head"><div><span className="eyebrow">Factura</span><strong>M&amp;G Management and Logistics Inc.</strong></div><button className="icon-btn" aria-label="Cerrar" onClick={() => setFactura(null)}>×</button></div><h2>{factura.ubicacion}</h2><p>{factura.empresa} · {factura.numero} · vence {factura.vence_at}</p><div className="invoice-detail">{factura.lineas.map((l, i) => <div key={i}><span><strong>{l.descripcion}</strong><small>{l.cantidad} × {usd(l.precio)}</small></span><strong>{usd(l.importe)}</strong></div>)}</div><div className="invoice-grand-total"><span>Total</span><strong>{usd(factura.total)}</strong></div><button className="btn btn-primary btn-block" onClick={() => window.print()}>Imprimir / guardar PDF</button></div></div>}
  </div>;
}
