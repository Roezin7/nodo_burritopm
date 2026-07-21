import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, getToken, nuevaClaveIdempotencia } from '../../api';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';
import { crearSemana, fechaDentroDeSemana, type SemanaSeleccionada } from '../../semana';
import CollapsibleSection from '../../components/CollapsibleSection';
import { guardarBorradorLocal, leerBorradorLocal, useUnsavedChanges } from '../../use-unsaved';
import { useDialog } from '../../dialog';
import Modal from '../../components/Modal';
import { Icono } from '../../icons';

export type OperacionSeccion = 'compras' | 'produccion' | 'rutas' | 'cierre';
interface Catalogo {
  ubicaciones: { id: number; nombre: string; tipo: string; empresa: { nombre: string } | null }[];
  productos: { id: number; nombre: string; sku: string; linea: string; tipo: string; unidad: string; costo: number | null; precio: number | null; peso_caja_lb: number | null; produccion_dias: number[]; produccion_extraordinaria: boolean; es_cargo_compra: boolean }[];
  proveedores: { id: number; nombre: string }[];
  plantillas: { id: number; nombre: string; codigo: string; linea: string; dia_semana: number; conductor: string; paradas: { ubicacion_id: number; nombre: string; orden: number; opcional: boolean }[] }[];
  recetas_produccion: { materia_prima_id: number; producto_salida_id: number; sin_costo: boolean; orden: number }[];
}
interface Resumen {
  total_compras: number;
  cantidad_compras: number;
  resumen_proteinas: { product_id: number; producto: string; cajas: number; costo_total: number; costo_caja: number; markup_caja: number; precio_venta_caja: number; venta_total: number }[];
  compras: { id: number; fecha: string; vence_at: string; proveedor_id: number; ubicacion_id: number; proveedor: string; referencia: string | null; total: number; estado: string; lineas: { product_id: number; producto: string; cajas: number; peso_lb: number; costo: number; congelado: boolean; es_cargo_compra: boolean }[] }[];
  producciones: { id: number; token: string; extraordinaria: boolean; fecha: string; materia_prima: string; cajas_entrada: number; peso_entrada_lb: number; peso_salida_lb: number; desperdicio_lb: number; yield: number; costo: number; notas: string | null; salidas: { producto: string; sku: string; unidad: string; tipo: string | null; cajas: number; costo_caja: number; precio: number }[] }[];
  lotes: { id: number; fecha: string; producto: string; product_id: number; cajas: number; peso_lb: number; costo: number; congelado: boolean }[];
}
interface Cierre {
  id: number; anio: number; semana: number; inicia_at: string; termina_at: string; estado: string;
  valor_carne: number; valor_congelado: number; valor_desechables: number; cuentas_por_cobrar: number; cuentas_por_pagar: number; balance_neto: number;
  facturas: Factura[];
}
interface Factura { id: number; numero: string; version: number; empresa: string; ubicacion: string; linea: string; emitida_at: string; vence_at: string; estado: string; total: number; pagado: number; lineas: { descripcion: string; cantidad: number; precio: number; importe: number }[] }
interface VistaPreviaCierre {
  semana: { anio: number; numero: number; inicia_at: string; termina_at: string };
  generado_at: string;
  ventas: { carne: number; desechables: number; total: number };
  inventario: { valor_carne: number; valor_congelado: number; valor_desechables: number; total: number };
  cartera: { por_cobrar_actual: number; por_cobrar_al_cierre: number; por_pagar: number };
  balance_estimado: number;
  cajas_perdidas: number;
  productos_con_faltante: number;
  ajustes: { id: number; tipo: string; descripcion: string; ubicacion: string; linea: string; monto: number }[];
  facturas: { numero: string; empresa: string; ubicacion: string; linea: string; vence_at: string; productos: number; unidades: number; total: number }[];
}
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
  resumen: { saldos_provisionales: number; cajas_perdidas: number; diferencias_fisicas: number; producciones: number; pedidos: number };
}
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const MARKUP_PROTEINA = 15;
const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const diasLargos = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const meta: Record<OperacionSeccion, { eyebrow: string; titulo: string; descripcion: string }> = {
  compras: { eyebrow: 'Control semanal', titulo: 'Compras', descripcion: 'Registra lo recibido esta semana.' },
  produccion: { eyebrow: 'Control semanal', titulo: 'Producción', descripcion: 'Captura la materia prima usada y las cajas producidas.' },
  rutas: { eyebrow: 'Entregas', titulo: 'Rutas', descripcion: 'Orden de entrega por día.' },
  cierre: { eyebrow: 'Control semanal', titulo: 'Cierre', descripcion: 'Genera facturas y libros semanales.' },
};

export default function OperacionAdmin({ seccion, integrado = false, semana = crearSemana() }: { seccion: OperacionSeccion; integrado?: boolean; semana?: SemanaSeleccionada }) {
  const toast = useToast();
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
  const vista = meta[seccion];

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
  const dialog = useDialog();
  const carniceria = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && u.nombre.toLowerCase().includes('carnicer'));
  const bodega = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && !u.nombre.toLowerCase().includes('carnicer'));
  const [linea, setLinea] = useState<'carne' | 'desechables'>('carne');
  const productosCompra = useMemo(
    () => catalogo.productos
      .filter((p) => p.es_cargo_compra || (p.linea === linea && (linea === 'desechables' || ['materia_prima', 'precio_fijo'].includes(p.tipo))))
      .sort((a, b) => Number(a.es_cargo_compra) - Number(b.es_cargo_compra) || Number(b.tipo === 'materia_prima') - Number(a.tipo === 'materia_prima')),
    [catalogo.productos, linea],
  );
  const [proveedor, setProveedor] = useState(String(catalogo.proveedores[0]?.id ?? ''));
  const [fecha, setFecha] = useState(fechaDentroDeSemana(semana));
  const [referencia, setReferencia] = useState('');
  const [totalFactura, setTotalFactura] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => nuevaClaveIdempotencia('compra'));
  const [borradorHidratado, setBorradorHidratado] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  type LineaCompra = { clave: number; producto: string; cajas: string; peso: string; costo: string; congelado: boolean };
  const nuevaLinea = (productoId = ''): LineaCompra => ({ clave: Date.now() + Math.random(), producto: productoId, cajas: '', peso: '', costo: '', congelado: false });
  const [lineas, setLineas] = useState<LineaCompra[]>(() => [nuevaLinea(String(catalogo.productos.find((p) => p.tipo === 'materia_prima')?.id ?? ''))]);
  const capturaPendiente = editandoId != null || Boolean(referencia.trim() || totalFactura) || lineas.some((l) => Boolean(l.cajas || l.peso || l.costo));
  const claveBorradorCompra = `bpm-borrador-compra:${semana.inicio}`;
  useUnsavedChanges(capturaPendiente);
  const editarLinea = (clave: number, cambios: Partial<LineaCompra>) => setLineas((actuales) => actuales.map((l) => l.clave === clave ? { ...l, ...cambios } : l));
  useEffect(() => {
    const primero = String(productosCompra[0]?.id ?? '');
    setLineas((actuales) => actuales.map((l) => productosCompra.some((p) => String(p.id) === l.producto) ? l : { ...l, producto: primero, peso: '', congelado: false }));
  }, [linea, productosCompra]);
  useEffect(() => {
    const guardado = leerBorradorLocal<{ linea: 'carne' | 'desechables'; proveedor: string; fecha: string; referencia: string; totalFactura?: string; lineas: LineaCompra[]; idempotencyKey?: string }>(claveBorradorCompra);
    setLinea(guardado?.valor.linea ?? 'carne');
    setProveedor(guardado?.valor.proveedor ?? String(catalogo.proveedores[0]?.id ?? ''));
    setFecha(guardado?.valor.fecha ?? fechaDentroDeSemana(semana));
    setEditandoId(null);
    setReferencia(guardado?.valor.referencia ?? '');
    setTotalFactura(guardado?.valor.totalFactura ?? '');
    setIdempotencyKey(guardado?.valor.idempotencyKey ?? nuevaClaveIdempotencia('compra'));
    setLineas(guardado?.valor.lineas?.length ? guardado.valor.lineas : [nuevaLinea(String(catalogo.productos.find((p) => p.linea === 'carne' && ['materia_prima', 'precio_fijo'].includes(p.tipo))?.id ?? ''))]);
    setBorradorHidratado(claveBorradorCompra);
  }, [semana.inicio, semana.fin, claveBorradorCompra]);
  useEffect(() => {
    if (borradorHidratado !== claveBorradorCompra) return;
    if (capturaPendiente && editandoId == null) guardarBorradorLocal(claveBorradorCompra, { linea, proveedor, fecha, referencia, totalFactura, lineas, idempotencyKey });
  }, [capturaPendiente, claveBorradorCompra, borradorHidratado, editandoId, linea, proveedor, fecha, referencia, totalFactura, lineas, idempotencyKey]);
  const almacen = linea === 'carne' ? carniceria : bodega;
  const costoInventario = lineas.reduce((total, l) => total + (productosCompra.find((p) => String(p.id) === l.producto)?.es_cargo_compra ? 0 : Number(l.costo || 0)), 0);
  const cargosContables = lineas.reduce((total, l) => total + (productosCompra.find((p) => String(p.id) === l.producto)?.es_cargo_compra ? Number(l.costo || 0) : 0), 0);
  const totalRenglones = costoInventario + cargosContables;
  const totalCompra = totalFactura === '' ? totalRenglones : Number(totalFactura || 0);
  const lineasValidas = lineas.length > 0 && lineas.every((l) => {
    const producto = productosCompra.find((p) => String(p.id) === l.producto);
    if (producto?.es_cargo_compra) return Number(l.costo) > 0;
    return Boolean(l.producto && Number(l.cajas) > 0 && Number(l.costo) > 0 && (producto?.tipo !== 'materia_prima' || Number(l.peso) > 0));
  });
  async function guardar() {
    if (!almacen) { setError('Falta configurar el almacén de esta línea.'); return; }
    setBusy(true); setError('');
    try {
      const body = { proveedor_id: Number(proveedor), ubicacion_id: almacen.id, fecha, referencia: referencia || null, total_factura: totalFactura === '' ? null : Number(totalFactura), ...(editandoId == null ? { idempotency_key: idempotencyKey } : {}), lineas: lineas.map((l) => { const p = productosCompra.find((producto) => String(producto.id) === l.producto); const materiaPrima = p?.tipo === 'materia_prima'; return { product_id: Number(l.producto), cajas: p?.es_cargo_compra ? 1 : Number(l.cajas), peso_total_lb: materiaPrima ? Number(l.peso) : 0, costo_total: Number(l.costo), congelado: materiaPrima && l.congelado }; }) };
      await api(editandoId == null ? '/operacion/compras' : `/operacion/compras/${editandoId}`, { method: editandoId == null ? 'POST' : 'PATCH', body });
      const fueEdicion = editandoId != null;
      setLineas([nuevaLinea(String(productosCompra[0]?.id ?? ''))]); setReferencia(''); setTotalFactura(''); setEditandoId(null); setIdempotencyKey(nuevaClaveIdempotencia('compra'));
      if (!fueEdicion) guardarBorradorLocal(claveBorradorCompra, null);
      await onDone(fueEdicion ? 'Compra actualizada e inventario recalculado.' : undefined);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo registrar la compra.'); } finally { setBusy(false); }
  }
  function lineaDeCompra(compra: Resumen['compras'][number]): 'carne' | 'desechables' {
    const productoInventariable = compra.lineas
      .map((lineaCompra) => catalogo.productos.find((producto) => producto.id === lineaCompra.product_id))
      .find((producto) => producto && !producto.es_cargo_compra);
    if (productoInventariable) return productoInventariable.linea === 'desechables' ? 'desechables' : 'carne';
    return compra.ubicacion_id === bodega?.id ? 'desechables' : 'carne';
  }
  function editarCompra(compra: Resumen['compras'][number]) {
    setLinea(lineaDeCompra(compra));
    setProveedor(String(compra.proveedor_id));
    setFecha(compra.fecha);
    setReferencia(compra.referencia ?? '');
    const costoLineas = compra.lineas.reduce((total, lineaCompra) => total + lineaCompra.costo, 0);
    setTotalFactura(Math.abs(costoLineas - compra.total) > 0.009 ? String(compra.total) : '');
    setLineas(compra.lineas.map((l) => ({ clave: Date.now() + Math.random(), producto: String(l.product_id), cajas: l.es_cargo_compra ? '1' : String(l.cajas), peso: l.peso_lb > 0 ? String(l.peso_lb) : '', costo: String(l.costo), congelado: l.congelado })));
    setEditandoId(compra.id);
    setError('');
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  function cancelarEdicion() {
    setEditandoId(null); setReferencia(''); setTotalFactura(''); setFecha(fechaDentroDeSemana(semana));
    setLineas([nuevaLinea(String(productosCompra[0]?.id ?? ''))]); setIdempotencyKey(nuevaClaveIdempotencia('compra')); setError('');
  }
  async function limpiarCompra() {
    if (capturaPendiente && !await dialog.confirm({ title: 'Limpiar compra', description: 'Se descartarán todos los renglones y datos que estás capturando.', confirmLabel: 'Limpiar captura', tone: 'danger' })) return;
    setReferencia(''); setTotalFactura(''); setFecha(fechaDentroDeSemana(semana)); setEditandoId(null);
    setLineas([nuevaLinea(String(productosCompra[0]?.id ?? ''))]); setIdempotencyKey(nuevaClaveIdempotencia('compra')); setError('');
    guardarBorradorLocal(claveBorradorCompra, null);
  }
  function repetirUltima() {
    const compra = resumen.compras.find((c) => lineaDeCompra(c) === linea);
    if (!compra) { setError(`No hay una compra anterior de ${linea}.`); return; }
    setProveedor(String(compra.proveedor_id));
    setReferencia('');
    setTotalFactura('');
    setIdempotencyKey(nuevaClaveIdempotencia('compra'));
    setLineas(compra.lineas.map((l) => ({ clave: Date.now() + Math.random(), producto: String(l.product_id), cajas: l.es_cargo_compra ? '1' : String(l.cajas), peso: l.peso_lb > 0 ? String(l.peso_lb) : '', costo: String(l.costo), congelado: l.congelado })));
    setError('');
  }
  async function cambiarLineaCompra(siguiente: 'carne' | 'desechables') {
    if (siguiente === linea) return;
    if (capturaPendiente && !await dialog.confirm({ title: 'Cambiar línea de compra', description: 'Hay una compra sin guardar. La captura actual se descartará.', confirmLabel: 'Descartar y cambiar', tone: 'danger' })) return;
    setLinea(siguiente); setReferencia(''); setTotalFactura(''); setEditandoId(null);
    setIdempotencyKey(nuevaClaveIdempotencia('compra'));
    guardarBorradorLocal(claveBorradorCompra, null);
    const primero = catalogo.productos.find((p) => p.linea === siguiente && (siguiente === 'desechables' || ['materia_prima', 'precio_fijo'].includes(p.tipo)));
    setLineas([nuevaLinea(String(primero?.id ?? ''))]);
  }
  function avanzarConEnter(evento: ReactKeyboardEvent<HTMLElement>) {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    const campos = [...document.querySelectorAll<HTMLElement>('[data-purchase-entry]:not(:disabled)')];
    const indice = campos.indexOf(evento.currentTarget);
    const siguiente = campos[indice + (evento.shiftKey ? -1 : 1)];
    siguiente?.focus();
    if (siguiente instanceof HTMLInputElement) siguiente.select();
  }
  async function cambiarLote(id: number, valor: boolean) { setBusy(true); setError(''); try { await api(`/operacion/lotes/${id}`, { method: 'PATCH', body: { congelado: valor } }); await onDone('Lote actualizado.'); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo actualizar el lote.'); } finally { setBusy(false); } }
  async function eliminarCompra(id: number) {
    if (!await dialog.confirm({ title: 'Eliminar compra', description: 'Se restarán sus cajas, peso y costo del inventario. Sólo puede eliminarse si todavía no fue utilizada.', confirmLabel: 'Eliminar compra', tone: 'danger' })) return;
    setBusy(true); setError('');
    try {
      await api(`/operacion/compras/${id}`, { method: 'DELETE' });
      await onDone('Compra eliminada e inventario revertido.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo eliminar la compra.'); } finally { setBusy(false); }
  }

  const comprasAgrupadas = [...resumen.compras]
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
    .reduce<{ fecha: string; compras: Resumen['compras']; total: number }[]>((grupos, compra) => {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo?.fecha === compra.fecha) {
        ultimo.compras.push(compra);
        ultimo.total += compra.total;
      } else grupos.push({ fecha: compra.fecha, compras: [compra], total: compra.total });
      return grupos;
    }, []);
  const totalCarne = resumen.compras.filter((compra) => lineaDeCompra(compra) === 'carne').reduce((total, compra) => total + compra.total, 0);
  const totalDesechables = resumen.compras.filter((compra) => lineaDeCompra(compra) === 'desechables').reduce((total, compra) => total + compra.total, 0);

  return <div className="operation-stack">
    <section className="workspace-card form-workspace purchase-workspace" ref={editorRef}>
        <div className="workspace-card-head purchase-capture-head"><div><span className="eyebrow">{editandoId == null ? 'Entrada' : 'Corrección'}</span><h2>{editandoId == null ? 'Registrar compra' : `Editar compra #${editandoId}`}</h2><p>{almacen?.nombre ?? 'Almacén pendiente'}</p></div><div className="purchase-head-actions"><div className="segmented segmented--small"><button disabled={editandoId != null} className={linea === 'carne' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => void cambiarLineaCompra('carne')}>Carne</button><button disabled={editandoId != null} className={linea === 'desechables' ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => void cambiarLineaCompra('desechables')}>Desechables</button></div><button type="button" className="btn btn-secondary btn-sm" disabled={editandoId != null || busy} onClick={repetirUltima}>Repetir última</button></div></div>
        <div className="form-grid form-grid--purchase purchase-entry-meta">
          <label className="field"><span>Proveedor</span><select data-purchase-entry value={proveedor} onKeyDown={avanzarConEnter} onChange={(e) => setProveedor(e.target.value)}>{catalogo.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
          <label className="field"><span>Fecha</span><input data-purchase-entry type="date" min={semana.inicio} max={semana.fin} value={fecha} onKeyDown={avanzarConEnter} onChange={(e) => setFecha(e.target.value)} /></label>
          <label className="field"><span>Factura / referencia</span><input data-purchase-entry value={referencia} onKeyDown={avanzarConEnter} onChange={(e) => setReferencia(e.target.value)} /></label>
          <label className="field field--number"><span>Total factura <em>opcional</em></span><div className="input-prefix"><span>$</span><input data-purchase-entry type="number" min="0" step="0.01" inputMode="decimal" placeholder={totalRenglones.toFixed(2)} value={totalFactura} onKeyDown={avanzarConEnter} onChange={(e) => setTotalFactura(e.target.value)} /></div></label>
        </div>
        <div className="purchase-lines">
          <div className="purchase-lines__head" aria-hidden="true"><span>#</span><span>Producto</span><span>Cantidad</span><span>Peso</span><span>Importe</span><span>Lote</span><span /></div>
          {lineas.map((l, indice) => { const seleccionado = productosCompra.find((p) => String(p.id) === l.producto); const requierePeso = seleccionado?.tipo === 'materia_prima'; const esCargo = Boolean(seleccionado?.es_cargo_compra); const pesoCaja = Number(l.cajas) > 0 ? Number(l.peso) / Number(l.cajas) : 0; return <div className="purchase-line" key={l.clave}>
            <span className="purchase-line__number">{indice + 1}</span>
            <label className="field purchase-line__product"><span className="purchase-line__field-label">Producto</span><select data-purchase-entry value={l.producto} onKeyDown={avanzarConEnter} onChange={(e) => { const siguiente = productosCompra.find((p) => String(p.id) === e.target.value); editarLinea(l.clave, { producto: e.target.value, cajas: siguiente?.es_cargo_compra ? '1' : esCargo ? '' : l.cajas, peso: '', congelado: false }); }}>{productosCompra.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            {esCargo ? <div className="purchase-line__static purchase-line__quantity"><strong>Cargo</strong><small>Sin inventario</small></div> : <label className="field field--number purchase-line__quantity"><span className="purchase-line__field-label">{seleccionado?.unidad ?? 'Cantidad'}</span><input data-purchase-entry type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={l.cajas} onKeyDown={avanzarConEnter} onChange={(e) => editarLinea(l.clave, { cajas: e.target.value })} /></label>}
            {requierePeso ? <label className="field field--number purchase-line__weight"><span className="purchase-line__field-label">Peso total</span><div className="input-suffix"><input data-purchase-entry type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={l.peso} onKeyDown={avanzarConEnter} onChange={(e) => editarLinea(l.clave, { peso: e.target.value })} /><span>lb</span></div><small>{pesoCaja.toFixed(2)} lb/caja</small></label> : <span className="purchase-line__empty">—</span>}
            <label className="field field--number purchase-line__cost"><span className="purchase-line__field-label">Importe</span><div className="input-prefix"><span>$</span><input data-purchase-entry type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={l.costo} onKeyDown={avanzarConEnter} onChange={(e) => editarLinea(l.clave, { costo: e.target.value })} /></div></label>
            {requierePeso ? <label className="purchase-line__freeze"><input type="checkbox" checked={l.congelado} onChange={(e) => editarLinea(l.clave, { congelado: e.target.checked })} /><span>Congelado</span></label> : <span className="purchase-line__empty">—</span>}
            {lineas.length > 1 ? <button type="button" className="icon-btn" aria-label="Quitar renglón" onClick={() => setLineas((actuales) => actuales.filter((fila) => fila.clave !== l.clave))}><Icono name="x" /></button> : <span />}
          </div>; })}
          <button type="button" className="btn btn-secondary btn-sm purchase-add" onClick={() => setLineas((actuales) => [...actuales, nuevaLinea(String(productosCompra[0]?.id ?? ''))])}>+ Agregar producto</button>
        </div>
        <div className="form-submit form-submit--summary purchase-submit"><div className="purchase-form-totals"><span><small>Inventario</small><strong>{usd(costoInventario)}</strong></span>{cargosContables > 0 && <span><small>Cargos contables</small><strong>{usd(cargosContables)}</strong></span>}<span className="purchase-form-grand-total"><small>{totalFactura === '' ? 'Total' : 'Total factura'}</small><strong>{usd(totalCompra)}</strong></span></div><div className="form-actions">{editandoId != null ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={cancelarEdicion}>Cancelar</button> : capturaPendiente && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void limpiarCompra()}>Limpiar</button>}<button className="btn btn-primary" disabled={bloqueada || busy || !proveedor || !lineasValidas} onClick={() => void guardar()}>{busy ? 'Guardando…' : bloqueada ? 'Semana cerrada' : editandoId == null ? 'Guardar compra' : 'Guardar cambios'}</button></div></div>
    </section>

    {semana.actual && resumen.lotes.length > 0 && <CollapsibleSection title="Materia prima disponible" count={`${resumen.lotes.length} lotes`} defaultOpen={false}>
      <div className="lot-grid">{resumen.lotes.map((l) => <article className="lot-card" key={l.id}><div className="card-head"><strong>{l.producto}</strong><span className={`chip ${l.congelado ? 'chip--info' : 'chip--ok'}`}>{l.congelado ? 'Congelado' : 'Fresco'}</span></div><div className="lot-value">{l.cajas} <small>cajas</small></div><p>{l.peso_lb.toLocaleString('es-MX')} lb · {l.cajas > 0 ? (l.peso_lb / l.cajas).toFixed(2) : '0.00'} lb/caja<br />{usd(l.costo)} · {l.cajas > 0 ? usd(l.costo / l.cajas) : usd(0)}/caja</p><footer><span>{l.fecha}</span><button className="link-btn" disabled={busy} onClick={() => void cambiarLote(l.id, !l.congelado)}>{l.congelado ? 'Descongelar' : 'Congelar'}</button></footer></article>)}</div>
    </CollapsibleSection>}

    <CollapsibleSection title="Compras registradas" count={resumen.cantidad_compras} summary={`Semana ${semana.numero} · ${usd(resumen.total_compras)}`} className="purchase-history">
      <div className="purchase-history-totals"><span><small>Carne</small><strong>{usd(totalCarne)}</strong></span><span><small>Desechables</small><strong>{usd(totalDesechables)}</strong></span><span><small>Total semanal</small><strong>{usd(resumen.total_compras)}</strong></span></div>
      {comprasAgrupadas.length === 0 ? <div className="empty-state"><strong>Sin compras registradas</strong></div> : <div className="purchase-day-groups">{comprasAgrupadas.map((grupo) => <section className="purchase-day-group" key={grupo.fecha}>
        <header><div><strong>{new Date(`${grupo.fecha}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}</strong><small>{grupo.compras.length} compra{grupo.compras.length === 1 ? '' : 's'}</small></div><strong>{usd(grupo.total)}</strong></header>
        <div className="purchase-records">{grupo.compras.map((c) => { const costoInventarioCompra = c.lineas.reduce((total, lineaCompra) => total + (lineaCompra.es_cargo_compra ? 0 : lineaCompra.costo), 0); const cargosCompra = c.lineas.reduce((total, lineaCompra) => total + (lineaCompra.es_cargo_compra ? lineaCompra.costo : 0), 0); const totalLineas = costoInventarioCompra + cargosCompra; const tipoCompra = lineaDeCompra(c); return <article className="purchase-record" key={c.id}>
          <div className="purchase-record__main"><div><span className={`chip ${tipoCompra === 'carne' ? 'chip--warn' : 'chip--info'}`}>{tipoCompra === 'carne' ? 'Carne' : 'Desechables'}</span><strong>{c.proveedor}</strong></div><span>{c.referencia || `Compra #${c.id}`} · vence {c.vence_at}</span></div>
          <div className="purchase-record__amount"><strong>{usd(c.total)}</strong><span className={`chip ${c.estado === 'pendiente' ? 'chip--warn' : 'chip--ok'}`}>{c.estado}</span></div>
          <details className="purchase-record__detail"><summary><span>{c.lineas.length} producto{c.lineas.length === 1 ? '' : 's'}</span><small>{cargosCompra > 0 ? `Inventario ${usd(costoInventarioCompra)} · cargos ${usd(cargosCompra)}` : `Inventario ${usd(costoInventarioCompra)}`}</small><i>⌄</i></summary><div>{c.lineas.map((l, i) => <div key={i}><span><strong>{l.producto}</strong><small>{l.es_cargo_compra ? 'Cargo contable · sin inventario' : `${l.cajas} cajas${l.peso_lb > 0 ? ` · ${l.peso_lb.toLocaleString('es-MX')} lb · ${(l.peso_lb / l.cajas).toFixed(2)} lb/caja` : ''}`}{l.congelado ? ' · congelado' : ''}</small></span><strong>{usd(l.costo)}</strong></div>)}{Math.abs(c.total - totalLineas) > 0.009 && <p>Renglones {usd(totalLineas)} · factura {usd(c.total)}</p>}</div></details>
          <div className="purchase-record__actions">{c.estado === 'pendiente' && <button className="btn btn-secondary btn-sm" disabled={bloqueada || busy} onClick={() => editarCompra(c)}>Editar</button>}<button className="btn btn-danger-ghost btn-sm" disabled={bloqueada || busy} onClick={() => void eliminarCompra(c.id)}>Eliminar</button></div>
        </article>; })}</div>
      </section>)}</div>}
    </CollapsibleSection>
  </div>;
}

interface ProduccionBorrador {
  id: number;
  idempotencyKey: string;
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
  const dialog = useDialog();
  const carniceria = catalogo.ubicaciones.find((u) => u.tipo === 'bodega' && u.nombre.toLowerCase().includes('carnicer'));
  const materias = catalogo.productos.filter((p) => p.tipo === 'materia_prima');
  const productosExtraordinarios = catalogo.productos.filter((p) => p.produccion_extraordinaria);
  const siguienteId = useRef(2);
  const crearBorrador = (materia = String(materias[0]?.id ?? '')): ProduccionBorrador => ({ id: siguienteId.current++, idempotencyKey: nuevaClaveIdempotencia('produccion'), materia, entrada: '', salidas: {} });
  const [fecha, setFecha] = useState(fechaDentroDeSemana(semana));
  const [borradores, setBorradores] = useState<ProduccionBorrador[]>(() => [{ id: 1, idempotencyKey: nuevaClaveIdempotencia('produccion'), materia: String(materias[0]?.id ?? ''), entrada: '', salidas: {} }]);
  const [borradorHidratado, setBorradorHidratado] = useState<string | null>(null);
  const [produccionesAbiertas, setProduccionesAbiertas] = useState<Set<string>>(() => new Set());
  const [extraordinariaAbierta, setExtraordinariaAbierta] = useState(false);
  const [cantidadesExtraordinarias, setCantidadesExtraordinarias] = useState<Record<number, string>>({});
  const [notaExtraordinaria, setNotaExtraordinaria] = useState('');
  const [claveExtraordinaria, setClaveExtraordinaria] = useState(() => nuevaClaveIdempotencia('produccion-extraordinaria'));
  const capturaProduccionPendiente = borradores.some((borrador) => Boolean(borrador.entrada) || Object.values(borrador.salidas).some(Boolean));
  const capturaExtraordinariaPendiente = Object.values(cantidadesExtraordinarias).some((cantidad) => Number(cantidad) > 0) || Boolean(notaExtraordinaria.trim());
  const claveBorradorProduccion = `bpm-borrador-produccion:${semana.inicio}`;
  useUnsavedChanges(capturaProduccionPendiente || capturaExtraordinariaPendiente);
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
    const guardado = leerBorradorLocal<{ fecha: string; borradores: ProduccionBorrador[] }>(claveBorradorProduccion);
    setFecha(guardado?.valor.fecha ?? fechaDentroDeSemana(semana));
    const filasGuardadas = guardado?.valor.borradores?.map((fila) => ({ ...fila, idempotencyKey: fila.idempotencyKey ?? nuevaClaveIdempotencia('produccion') }));
    if (filasGuardadas?.length) siguienteId.current = Math.max(...filasGuardadas.map((fila) => fila.id)) + 1;
    setBorradores(filasGuardadas ?? [crearBorrador()]);
    setProduccionesAbiertas(new Set());
    setExtraordinariaAbierta(false);
    setCantidadesExtraordinarias({});
    setNotaExtraordinaria('');
    setClaveExtraordinaria(nuevaClaveIdempotencia('produccion-extraordinaria'));
    setBorradorHidratado(claveBorradorProduccion);
  }, [semana.inicio, semana.fin, claveBorradorProduccion]);

  useEffect(() => {
    if (borradorHidratado === claveBorradorProduccion && capturaProduccionPendiente) guardarBorradorLocal(claveBorradorProduccion, { fecha, borradores });
  }, [claveBorradorProduccion, borradorHidratado, capturaProduccionPendiente, fecha, borradores]);

  function actualizar(idBorrador: number, cambio: Partial<ProduccionBorrador>) {
    setBorradores((actuales) => actuales.map((b) => b.id === idBorrador ? { ...b, ...cambio } : b));
  }

  function agregarProducto() {
    if (borradores.length >= 12) return;
    const materiasUsadas = new Set(borradores.map((b) => b.materia));
    const siguiente = materias.find((m) => !materiasUsadas.has(String(m.id))) ?? materias[0];
    setBorradores((actuales) => [...actuales, crearBorrador(String(siguiente?.id ?? ''))]);
  }

  async function cargarPlanDelDia() {
    if (capturaProduccionPendiente && !await dialog.confirm({
      title: 'Cargar el plan habitual',
      description: 'La captura actual se reemplazará por el plan habitual de este día.',
      confirmLabel: 'Reemplazar captura',
    })) return;
    const dia = new Date(`${fecha}T12:00:00`).getDay();
    const idsMaterias = [...new Set(catalogo.recetas_produccion.filter((receta) => {
      const salida = catalogo.productos.find((producto) => producto.id === receta.producto_salida_id);
      return salida?.produccion_dias.includes(dia);
    }).map((receta) => receta.materia_prima_id))];
    setBorradores((idsMaterias.length ? idsMaterias : materias.slice(0, 1).map((materia) => materia.id)).map((materiaId) => crearBorrador(String(materiaId))));
    setError('');
  }

  function avanzarProduccion(evento: ReactKeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    const campos = [...document.querySelectorAll<HTMLElement>('[data-production-entry]:not(:disabled)')];
    const indice = campos.indexOf(evento.currentTarget);
    const siguiente = campos[indice + (evento.shiftKey ? -1 : 1)];
    siguiente?.focus();
    if (siguiente instanceof HTMLInputElement) siguiente.select();
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
            idempotency_key: c.borrador.idempotencyKey,
            salidas: c.terminados.filter((p) => Number(c.borrador.salidas[p.id] || 0) > 0).map((p) => ({ product_id: p.id, cajas: Number(c.borrador.salidas[p.id]) })),
          })),
        },
      });
      const cantidad = borradores.length;
      setBorradores([crearBorrador()]);
      guardarBorradorLocal(claveBorradorProduccion, null);
      await onDone();
      toast.ok(`${cantidad} ${cantidad === 1 ? 'producción guardada' : 'producciones guardadas'} correctamente.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la producción.'); } finally { setBusy(false); }
  }
  async function guardarExtraordinaria() {
    if (!carniceria) { setError('Falta crear la ubicación Carnicería.'); return; }
    const salidas = productosExtraordinarios.flatMap((producto) => {
      const cajas = Number(cantidadesExtraordinarias[producto.id] || 0);
      return cajas > 0 ? [{ product_id: producto.id, cajas }] : [];
    });
    if (!salidas.length) { setError('Captura al menos una cantidad extraordinaria.'); return; }
    setBusy(true); setError('');
    try {
      await api('/operacion/produccion-extraordinaria', {
        method: 'POST',
        body: {
          ubicacion_id: carniceria.id, fecha, salidas,
          notas: notaExtraordinaria.trim() || null, idempotency_key: claveExtraordinaria,
        },
      });
      setExtraordinariaAbierta(false);
      setCantidadesExtraordinarias({});
      setNotaExtraordinaria('');
      setClaveExtraordinaria(nuevaClaveIdempotencia('produccion-extraordinaria'));
      await onDone();
      toast.ok('Producción extraordinaria registrada sin costo contable.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la producción extraordinaria.'); }
    finally { setBusy(false); }
  }
  const rutaEliminarProduccion = (produccion: Resumen['producciones'][number]) => produccion.extraordinaria
    ? `/operacion/produccion-extraordinaria/${produccion.id}`
    : `/operacion/produccion/${produccion.id}`;
  async function eliminar(produccion: Resumen['producciones'][number]) {
    if (!await dialog.confirm({
      title: produccion.extraordinaria ? 'Eliminar producción extraordinaria' : 'Eliminar batch de producción',
      description: produccion.extraordinaria
        ? 'Se retirarán del inventario las cantidades extraordinarias registradas. Esta acción no se puede deshacer.'
        : 'Se revertirán la materia prima, las cajas producidas y sus costos. Esta acción no se puede deshacer.',
      confirmLabel: produccion.extraordinaria ? 'Eliminar captura' : 'Eliminar batch',
      tone: 'danger',
    })) return;
    setBusy(true); setError('');
    try {
      await api(rutaEliminarProduccion(produccion), { method: 'DELETE' });
      await onDone();
      toast.ok(produccion.extraordinaria ? 'Producción extraordinaria eliminada y existencias restauradas.' : 'Producción eliminada y saldos recalculados.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo eliminar la producción.'); }
    finally { setBusy(false); }
  }
  async function eliminarDia(fechaGrupo: string, producciones: Resumen['producciones']) {
    if (!await dialog.confirm({
      title: `Eliminar ${producciones.length} producciones`,
      description: `Se revertirán juntas las capturas del ${fechaGrupo}. Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar día',
      tone: 'danger',
    })) return;
    setBusy(true); setError('');
    try {
      for (const produccion of producciones) await api(rutaEliminarProduccion(produccion), { method: 'DELETE' });
      await onDone(); toast.ok(`${producciones.length} producciones del día eliminadas y saldos recalculados.`);
    } catch (e) { await onDone(); setError(e instanceof ApiError ? e.message : 'No se pudo completar la eliminación del día. Revisa los batches restantes.'); }
    finally { setBusy(false); }
  }
  function alternarProduccion(token: string) {
    setProduccionesAbiertas((actuales) => {
      const siguientes = new Set(actuales);
      if (siguientes.has(token)) siguientes.delete(token); else siguientes.add(token);
      return siguientes;
    });
  }
  const produccionesPorDia = useMemo(() => {
    const grupos = new Map<string, Resumen['producciones']>();
    for (const produccion of resumen.producciones) {
      const grupo = grupos.get(produccion.fecha) ?? [];
      grupo.push(produccion);
      grupos.set(produccion.fecha, grupo);
    }
    return [...grupos.entries()]
      .sort(([fechaA], [fechaB]) => fechaA.localeCompare(fechaB))
      .map(([fechaGrupo, producciones]) => {
        const fechaLocal = new Date(`${fechaGrupo}T12:00:00`);
        return {
          fecha: fechaGrupo,
          dia: diasLargos[fechaLocal.getDay()],
          fechaCorta: fechaLocal.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', ''),
          producciones,
          cajasEntrada: producciones.reduce((total, produccion) => total + produccion.cajas_entrada, 0),
          costo: producciones.reduce((total, produccion) => total + produccion.costo, 0),
        };
      });
  }, [resumen.producciones]);
  const todasProduccionesAbiertas = resumen.producciones.length > 0 && resumen.producciones.every((p) => produccionesAbiertas.has(p.token));
  return <div className="operation-stack">
    <section className="workspace-card production-capture">
      <div className="workspace-card-head production-capture-head"><div><h2>Nueva producción</h2><div className="production-head-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={busy || bloqueada || !productosExtraordinarios.length} onClick={() => setExtraordinariaAbierta(true)}>+ Extraordinaria</button><button type="button" className="btn btn-secondary btn-sm" onClick={cargarPlanDelDia}>Cargar plan del día</button></div></div><div className="production-day-picker"><span>Día · semana {semana.numero}</span><div role="group" aria-label={`Día de producción de la semana ${semana.numero}`}>{fechasProduccion.map((opcion) => <button type="button" key={opcion.fecha} className={fecha === opcion.fecha ? 'is-active' : ''} aria-pressed={fecha === opcion.fecha} onClick={() => setFecha(opcion.fecha)}><strong>{opcion.dia}</strong><small>{opcion.numero} {opcion.mes}</small></button>)}</div></div></div>
      <div className="production-drafts">
        {calculos.map((calculo, indice) => {
          const { borrador, materia, terminados, cajasFrescas, cajasCongeladas, consumo, pesoSalida, insuficiente, pesoExcedido } = calculo;
          const yieldActual = consumo.pesoTotal > 0 ? (pesoSalida / consumo.pesoTotal) * 100 : 0;
          return <article className={`production-draft ${insuficiente || pesoExcedido ? 'is-alert' : ''}`} key={borrador.id}>
            <header><div><span className="step-badge">{indice + 1}</span><div><strong>{materia?.nombre ?? 'Producto'}</strong><small>Batch del {fecha}</small></div></div>{borradores.length > 1 && <button type="button" className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={() => setBorradores((actuales) => actuales.filter((b) => b.id !== borrador.id))}>Quitar</button>}</header>
            <div className="form-grid production-draft-fields">
              <label className="field"><span>Materia prima utilizada</span><select data-production-entry value={borrador.materia} onKeyDown={avanzarProduccion} onChange={(e) => actualizar(borrador.id, { materia: e.target.value, salidas: {} })}>{materias.map((p) => { const disponibles = resumen.lotes.filter((l) => l.product_id === p.id && !l.congelado && l.fecha <= semana.fin).reduce((a, l) => a + l.cajas, 0); return <option key={p.id} value={p.id}>{p.nombre} · {disponibles.toLocaleString('es-MX')} frescas</option>; })}</select></label>
              <label className="field field--number"><span>Cajas de materia prima</span><input data-production-entry type="number" min="0" step="0.5" inputMode="decimal" placeholder="0" value={borrador.entrada} onKeyDown={avanzarProduccion} onChange={(e) => actualizar(borrador.id, { entrada: e.target.value })} /></label>
            </div>
            <div className={`production-stock-link ${insuficiente ? 'is-alert' : ''}`}><span><strong>Disponible</strong>{cajasFrescas.toLocaleString('es-MX')} cajas frescas{cajasCongeladas > 0 ? ` · ${cajasCongeladas.toLocaleString('es-MX')} congeladas` : ''}</span><span>{consumo.pesoTotal.toFixed(1)} lb usadas · {usd(consumo.costoTotal)}</span></div>
            {insuficiente && <p className="error-msg">La suma de filas con esta materia prima supera las cajas frescas disponibles.</p>}
            <div className="form-divider"><span>Producción terminada y subproductos</span><small>Entrada estimada: {consumo.pesoTotal.toFixed(1)} lb</small></div>
            <div className="production-output-list">{terminados.map((p) => { const esSubproducto = calculo.subproductos.has(p.id); return <label className={`production-output ${esSubproducto ? 'production-output--byproduct' : ''}`} key={p.id}><span><strong>{p.nombre}</strong><small>{esSubproducto ? `Subproducto del remanente · sin costo · venta ${usd(p.precio ?? 0)}/${p.unidad.toLowerCase()}` : `${p.peso_caja_lb ?? '?'} lb/caja · ${p.produccion_dias.map((d) => dias[d]).join(', ') || 'especial'}`}</small></span><div className="input-suffix input-suffix--compact"><input data-production-entry type="number" min="0" step={esSubproducto ? '1' : '0.5'} inputMode="decimal" value={borrador.salidas[p.id] ?? ''} placeholder="0" onKeyDown={avanzarProduccion} onChange={(e) => actualizar(borrador.id, { salidas: { ...borrador.salidas, [p.id]: e.target.value } })} /><span>{p.unidad.toLowerCase()}</span></div></label>; })}</div>
            {!terminados.length && <div className="empty-state"><strong>Sin receta configurada</strong><span>Selecciona otra materia prima.</span></div>}
            <footer><span>Salida {pesoSalida.toFixed(1)} lb</span><span className={yieldActual > 100 ? 'text-danger' : ''}>Yield {yieldActual.toFixed(1)}%</span></footer>
            {pesoExcedido && <p className="error-msg">El peso terminado supera el peso de materia prima calculado.</p>}
          </article>;
        })}
      </div>
      <button type="button" className="btn btn-secondary production-add" disabled={busy || bloqueada || borradores.length >= 12 || !materias.length} onClick={agregarProducto}>+ Agregar otro producto</button>
      <div className="production-capture-summary"><div><span><small>Productos</small><strong>{productosTerminadosTotal}</strong></span><span><small>Materia prima</small><strong>{cajasEntradaTotal.toLocaleString('es-MX')} cajas</strong></span><span><small>Producto terminado</small><strong>{cajasSalidaTotal.toLocaleString('es-MX')} cajas{piezasSubproductoTotal > 0 ? ` · ${piezasSubproductoTotal.toLocaleString('es-MX')} piezas` : ''}</strong></span><span><small>Yield principal</small><strong>{pesoEntradaTotal > 0 ? ((pesoSalidaTotal / pesoEntradaTotal) * 100).toFixed(1) : '0.0'}%</strong></span></div><button className="btn btn-primary" disabled={bloqueada || busy || !capturaValida} onClick={() => void guardar()}>{busy ? 'Guardando todo…' : bloqueada ? 'Semana cerrada' : borradores.length === 1 ? 'Guardar producción' : `Guardar ${borradores.length} producciones`}</button></div>
    </section>

    {extraordinariaAbierta && <Modal className="payment-dialog extraordinary-production-modal" ariaLabelledBy="extraordinary-production-title" closeOnBackdrop={!busy} closeOnEscape={!busy} onClose={() => !busy && setExtraordinariaAbierta(false)}>
      <div className="card-head"><div><span className="eyebrow">Sin costo contable</span><strong id="extraordinary-production-title">Producción extraordinaria</strong></div><button type="button" className="icon-btn" aria-label="Cerrar" disabled={busy} onClick={() => setExtraordinariaAbierta(false)}><Icono name="x" /></button></div>
      <p className="page-sub">Registra únicamente la cantidad terminada del {fecha}. No consume materia prima ni distribuye costos de producción.</p>
      <div className="extraordinary-production-fields">{productosExtraordinarios.map((producto) => <label className="field" key={producto.id}><span>{producto.nombre}</span><div className="input-suffix"><input type="number" min="0" step="1" inputMode="numeric" placeholder="0" value={cantidadesExtraordinarias[producto.id] ?? ''} onChange={(e) => setCantidadesExtraordinarias((actuales) => ({ ...actuales, [producto.id]: e.target.value }))} /><span>{producto.unidad.toLowerCase()}</span></div></label>)}</div>
      <label className="field"><span>Nota <small>(opcional)</small></span><textarea rows={2} maxLength={500} placeholder="Ej. producción especial para evento" value={notaExtraordinaria} onChange={(e) => setNotaExtraordinaria(e.target.value)} /></label>
      <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setExtraordinariaAbierta(false)}>Cancelar</button><button type="button" className="btn btn-primary" disabled={busy || !productosExtraordinarios.some((producto) => Number(cantidadesExtraordinarias[producto.id] || 0) > 0)} onClick={() => void guardarExtraordinaria()}>{busy ? 'Guardando…' : 'Registrar producción'}</button></div>
    </Modal>}

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

    <section className="workspace-card"><div className="workspace-card-head batch-list-heading"><div><h2>Producción registrada</h2><p>{resumen.producciones.length} captura{resumen.producciones.length === 1 ? '' : 's'} en {produccionesPorDia.length} día{produccionesPorDia.length === 1 ? '' : 's'}</p></div>{resumen.producciones.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProduccionesAbiertas(todasProduccionesAbiertas ? new Set() : new Set(resumen.producciones.map((p) => p.token)))}>{todasProduccionesAbiertas ? 'Colapsar todo' : 'Expandir todo'}</button>}</div>
      {produccionesPorDia.length === 0 ? <div className="empty-state"><strong>Sin producción registrada</strong><span>Las capturas guardadas aparecerán separadas por día.</span></div> : <div className="batch-day-list">{produccionesPorDia.map((grupo) => <section className="batch-day" key={grupo.fecha}>
        <header className="batch-day-heading"><div><span>{grupo.dia}</span><strong>{grupo.fechaCorta}</strong></div><p>{grupo.producciones.length} captura{grupo.producciones.length === 1 ? '' : 's'} · {grupo.cajasEntrada.toLocaleString('es-MX')} cajas de materia prima · {usd(grupo.costo)}</p><button type="button" className="btn btn-danger-ghost btn-sm" disabled={bloqueada || busy} onClick={() => void eliminarDia(grupo.fecha, grupo.producciones)}>Eliminar día</button></header>
        <div className="batch-list">{grupo.producciones.map((p) => {
          const abierta = produccionesAbiertas.has(p.token);
          const resumenSalidas = p.salidas.map((s) => `${s.producto}: ${s.cajas}`).join(' · ');
          return <article className={`batch-card ${p.extraordinaria ? 'batch-card--extraordinary' : ''} ${abierta ? 'is-open' : 'is-collapsed'}`} key={p.token}>
            <header><button type="button" className="batch-collapse-button" aria-expanded={abierta} aria-controls={`batch-${p.token}`} onClick={() => alternarProduccion(p.token)}><span><strong>{p.materia_prima}</strong><small>{resumenSalidas || 'Sin salidas registradas'}</small></span><i aria-hidden="true">⌄</i></button><div className="batch-card-actions"><span className={`yield-pill ${p.extraordinaria ? 'yield-pill--extraordinary' : ''}`}>{p.extraordinaria ? 'Sin costo' : `Yield ${p.yield.toFixed(1)}%`}</span><button className="btn btn-danger-ghost btn-sm" disabled={bloqueada || busy} onClick={() => void eliminar(p)}>Eliminar</button></div></header>
            {abierta && <div id={`batch-${p.token}`} className="batch-card-detail">{p.extraordinaria ? <div className="batch-metrics"><span><small>Tipo</small><strong>Producción extraordinaria</strong></span><span><small>Costo asignado</small><strong>{usd(0)}</strong></span>{p.notas && <span><small>Nota</small><strong>{p.notas}</strong></span>}</div> : <div className="batch-metrics"><span><small>Materia prima</small><strong>{p.cajas_entrada} cajas compradas · {p.peso_entrada_lb} lb</strong></span><span><small>Producto terminado</small><strong>{p.peso_salida_lb} lb</strong></span><span><small>Remanente / subproductos</small><strong>{p.desperdicio_lb} lb</strong></span><span><small>Costo total del batch</small><strong>{usd(p.costo)}</strong></span></div>}<div className="batch-outputs">{p.salidas.map((s, i) => { const esProteina = s.tipo === 'proteina'; const precioCaja = esProteina ? s.costo_caja + MARKUP_PROTEINA : s.precio; return <div key={i}><span><strong>{s.producto}</strong><small>{s.cajas} {s.unidad.toLowerCase()}{s.cajas === 1 ? '' : 's'} terminada{s.cajas === 1 ? '' : 's'}</small></span><span className="batch-output-prices"><small>Costo por {s.unidad.toLowerCase()}</small><strong>{usd(s.costo_caja)}</strong><small>Venta por {s.unidad.toLowerCase()}</small><strong>{usd(precioCaja)}</strong>{esProteina && <em>+{usd(MARKUP_PROTEINA)} por caja</em>}</span></div>; })}</div></div>}
          </article>;
        })}</div>
      </section>)}</div>}
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
    <div className="route-stop-list">{a.map((x, i) => <div className="route-stop" key={x.ubicacion_id}><span className="route-stop-number">{i + 1}</span><span className="route-stop-name"><strong>{x.nombre}</strong><button className={x.opcional ? 'optional-toggle is-on' : 'optional-toggle'} onClick={() => alternarOpcional(p.id, x.ubicacion_id)}>{x.opcional ? 'Parada opcional' : 'Parada fija'}</button></span><span className="route-stop-actions"><button className="icon-btn" aria-label="Subir parada" disabled={i === 0} onClick={() => mover(p.id, i, -1)}><Icono name="up" /></button><button className="icon-btn" aria-label="Bajar parada" disabled={i === a.length - 1} onClick={() => mover(p.id, i, 1)}><Icono name="down" /></button><button className="icon-btn btn-peligro" aria-label="Quitar parada" onClick={() => quitar(p.id, x.ubicacion_id)}><Icono name="x" /></button></span></div>)}</div>
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
      <div><span className="eyebrow">Auditoría de Carnicería</span><h2>Conciliación semanal</h2><p>Inicio + compras y producción − salidas reales = inventario final calculado. El conteo físico es opcional.</p></div>
      {!reporte.inicial_fijado && <button className="btn btn-primary" disabled={busy} onClick={() => void fijarInicio()}>Fijar inventario inicial</button>}
    </div>
    <div className="reconciliation-status">
      <span className={`chip ${reporte.inicial_fijado ? 'chip--ok' : 'chip--warn'}`}>{reporte.inicial_fijado ? 'Inicio fijado' : reporte.origen_inicial === 'cierre_anterior' ? 'Inicio tomado del sábado anterior' : 'Inicio reconstruido, falta fijar'}</span>
      <span className={`chip ${reporte.final_capturado ? 'chip--ok' : 'chip--muted'}`}>{reporte.final_capturado ? 'Doble check físico capturado' : 'Sin conteo físico · opcional'}</span>
      {reporte.resumen.saldos_provisionales > 0 && <span className="chip chip--warn">{reporte.resumen.cajas_perdidas.toLocaleString('es-MX')} cajas perdidas · no bloquean cierre</span>}
      {reporte.resumen.diferencias_fisicas > 0 && <span className="chip chip--warn">{reporte.resumen.diferencias_fisicas} diferencias documentadas</span>}
    </div>
    <div className="reconciliation-links"><Link to={`/semana/produccion?semana=${semana.inicio}`}>Corregir producción</Link><Link to={`/semana/inventario?semana=${semana.inicio}`}>Hacer doble check físico (opcional)</Link></div>
    <CollapsibleSection title="Detalle de conciliación" count={reporte.filas.length} defaultOpen={false}><div className="reconciliation-table-wrap"><table className="reconciliation-table"><thead><tr><th>Producto</th><th>Inicio</th><th>+ Entradas L–X</th><th>− Uso/salida X</th><th>Saldo miércoles</th><th>+ Entradas J–S</th><th>− Uso/salida S</th><th>Final calculado</th><th>Físico opcional</th><th>Diferencia</th></tr></thead><tbody>{reporte.filas.map((f) => {
      const entradas1 = f.compras1 + f.produccionSalida1; const salidas1 = f.produccionEntrada1 + f.salidas1;
      const entradas2 = f.compras2 + f.produccionSalida2; const salidas2 = f.produccionEntrada2 + f.salidas2;
      const diferencia = f.diferenciaFinal ?? 0;
      return <tr key={f.product_id} className={Math.abs(diferencia) > 0.0001 || f.actual < -0.0001 ? 'is-different' : ''}><td><strong>{f.nombre}</strong><small>{f.tipo?.replaceAll('_', ' ')} · pedidos {q(f.pedidos1)} / {q(f.pedidos2)}</small></td><td>{q(f.inicial)}</td><td>{q(entradas1)}</td><td>{q(salidas1)}</td><td><strong>{q(f.saldoMiercoles)}</strong></td><td>{q(entradas2)}</td><td>{q(salidas2)}</td><td><strong>{q(f.teoricoFinal)}</strong></td><td>{f.fisico_final == null ? 'Sin conteo' : q(f.fisico_final)}</td><td className={Math.abs(diferencia) > 0.0001 ? 'txt-danger' : ''}>{f.diferenciaFinal == null ? '—' : q(diferencia)}</td></tr>;
    })}</tbody></table></div></CollapsibleSection>
    {!reporte.filas.length && <div className="empty-state"><strong>Sin movimiento de carne</strong><span>No hay productos que conciliar en esta semana.</span></div>}
  </section>;
}

function Cierres({ cierres, semana, busy, setBusy, onDone, setError }: { cierres: Cierre[]; semana: SemanaSeleccionada; busy: boolean; setBusy: (v: boolean) => void; onDone: () => Promise<void>; setError: (v: string) => void }) {
  const toast = useToast();
  const dialog = useDialog();
  const [factura, setFactura] = useState<Factura | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<VistaPreviaCierre | null>(null);
  useEffect(() => { setFactura(null); setVistaPrevia(null); }, [semana.inicio, semana.fin]);
  async function revisarCierre() { setBusy(true); setError(''); try { setVistaPrevia(await api<VistaPreviaCierre>('/cierre/vista-previa', { method: 'POST', body: { fecha_cierre: semana.fin } })); } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo calcular la vista previa del cierre.'); } finally { setBusy(false); } }
  async function cerrar() { setBusy(true); setError(''); try { const r = await api<{ cajas_perdidas: number; productos_con_faltante: number }>('/cierre/cerrar', { method: 'POST', body: { fecha_cierre: semana.fin } }); setVistaPrevia(null); await onDone(); toast.ok(r.cajas_perdidas > 0 ? `Semana cerrada · ${r.cajas_perdidas.toLocaleString('es-MX')} cajas perdidas registradas en Incidencias.` : 'Semana cerrada correctamente.'); } catch (e) { setVistaPrevia(null); setError(e instanceof ApiError ? e.message : 'No se pudo cerrar la semana.'); } finally { setBusy(false); } }
  const nombresExcel: Record<string, string> = { 'weekly-order': '1. Weekly Order 2026 3Q.xlsx', disposables: '2. Disposables 2026 3Q.xlsx', production: '3. Production 2026 3Q.xlsx', billing: '4. Billing 2026 3Q.xlsx', lbt: '5. LBT 2026 3Q.xlsx', aurora: '6. Taqueria Aurora 2026 3Q.xlsx' };
  async function descargar(id: number, tipo: string) { const res = await fetch(`/api/cierre/${id}/excel/${tipo}`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (!res.ok) { setError('No se pudo generar el Excel.'); return; } const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = nombresExcel[tipo] ?? `${tipo}.xlsx`; a.click(); URL.revokeObjectURL(url); }
  async function reabrir(id: number) {
    if (!await dialog.confirm({
      title: 'Reabrir esta semana',
      description: 'Se anularán las facturas y, si existió un conteo físico, se revertirán sus ajustes. Después podrás corregir compras o producción y cerrar nuevamente.',
      confirmLabel: 'Reabrir semana',
      tone: 'danger',
    })) return;
    setBusy(true); setError('');
    try { await api(`/cierre/${id}/reabrir`, { method: 'POST' }); await onDone(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo reabrir la semana.'); }
    finally { setBusy(false); }
  }
  const libros = [['weekly-order', 'Weekly Order'], ['disposables', 'Disposables'], ['production', 'Production'], ['billing', 'Billing'], ['lbt', 'LBT'], ['aurora', 'Aurora']] as const;
  const cierreSeleccionado = cierres.find((s) => s.anio === semana.anio && s.semana === semana.numero);
  return <div className="operation-stack">
    <ConciliacionSemanal semana={semana} busy={busy} setBusy={setBusy} setError={setError} />
    <section className="close-week-card"><div><span className="eyebrow">Semana {semana.numero}</span><h2>Revisar y cerrar</h2><p>{semana.inicio} al {semana.fin} · consulta el resultado antes de generar facturas.</p></div><div className="close-week-action"><button className="btn btn-primary" disabled={busy || semana.fin > hoy() || cierreSeleccionado?.estado === 'cerrada'} onClick={() => void revisarCierre()}>{busy ? 'Calculando…' : cierreSeleccionado?.estado === 'cerrada' ? 'Semana cerrada' : semana.fin > hoy() ? 'Semana en curso' : 'Vista previa del cierre'}</button></div></section>

    <div className="week-list">{cierreSeleccionado ? [cierreSeleccionado].map((s) => <section className="week-card" key={s.id}><header><div><span className={`status-dot status-dot--${s.estado}`} /> <strong>Semana {s.semana} · {s.anio}</strong><p>{s.inicia_at} al {s.termina_at}</p></div><div className="week-balance"><span>Balance</span><strong>{usd(s.balance_neto)}</strong></div></header>
      <div className="metric-strip metric-strip--five"><div><span>Carne</span><strong>{usd(s.valor_carne)}</strong></div><div><span>Congelado</span><strong>{usd(s.valor_congelado)}</strong></div><div><span>Desechables</span><strong>{usd(s.valor_desechables)}</strong></div><div><span>Por cobrar · 3 semanas</span><strong>{usd(s.cuentas_por_cobrar)}</strong></div><div><span>Por pagar</span><strong>{usd(s.cuentas_por_pagar)}</strong></div></div>
      <div className="week-toolbar"><div className="export-menu">{libros.map(([tipo, label]) => <button className="export-chip" key={tipo} onClick={() => void descargar(s.id, tipo)}>{label}<small>.xlsx</small></button>)}</div>{s.estado === 'cerrada' && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void reabrir(s.id)}>Reabrir semana</button>}</div>
      <CollapsibleSection title="Facturas" count={s.facturas.length}><div className="invoice-list"><div className="invoice-row invoice-row--head"><span>Factura</span><span>Empresa / ubicación</span><span>Vencimiento</span><span>Estado</span><span>Total</span><span /></div>{s.facturas.map((f) => <div className="invoice-row" key={f.id}><button className="invoice-number" onClick={() => setFactura(f)}>{f.numero}<small>v{f.version} · {f.linea}</small></button><span data-label="Ubicación"><strong>{f.ubicacion}</strong><small>{f.empresa}</small></span><span data-label="Vence">{f.vence_at}</span><span data-label="Estado"><span className="chip chip--info">Ciclo automático</span></span><span data-label="Total"><strong>{usd(f.total)}</strong></span><span /></div>)}</div></CollapsibleSection>
    </section>) : <div className="empty-state workspace-card"><strong>Semana {semana.numero} todavía abierta</strong><span>Al cerrarla se generarán facturas, balances y libros Excel de este periodo.</span></div>}</div>
    {vistaPrevia && <Modal className="close-preview-modal" ariaLabelledBy="close-preview-title" closeOnBackdrop={!busy} closeOnEscape={!busy} onClose={() => setVistaPrevia(null)}>
      <div className="card-head"><div><span className="eyebrow">Vista previa · Semana {vistaPrevia.semana.numero}</span><h2 id="close-preview-title">Resultado estimado del cierre</h2><p>{vistaPrevia.semana.inicia_at} al {vistaPrevia.semana.termina_at}</p></div><button className="icon-btn" disabled={busy} aria-label="Cerrar" onClick={() => setVistaPrevia(null)}><Icono name="x" /></button></div>
      <div className="close-preview-total"><span>Venta que se facturará</span><strong>{usd(vistaPrevia.ventas.total)}</strong><small>Carne {usd(vistaPrevia.ventas.carne)} · Desechables {usd(vistaPrevia.ventas.desechables)}</small></div>
      {vistaPrevia.ajustes.length > 0 && <div className="notice"><strong>Ajustes incluidos:</strong> {vistaPrevia.ajustes.map((ajuste) => `${ajuste.ubicacion}: ${ajuste.descripcion} (${usd(ajuste.monto)})`).join(' · ')}</div>}
      <details className="operation-help"><summary>Cómo se calcula el inventario</summary><p>Saldo inicial + compras + producción − ventas. El conteo físico es opcional; los saldos negativos se reportan como cajas perdidas y se valúan en cero.</p></details>
      <div className="metric-strip metric-strip--three"><div><span>Inventario final</span><strong>{usd(vistaPrevia.inventario.total)}</strong><small>Incluye carne, congelado y desechables</small></div><div><span>Por cobrar · ciclo 3 semanas</span><strong>{usd(vistaPrevia.cartera.por_cobrar_al_cierre)}</strong><small>Dos semanas anteriores {usd(vistaPrevia.cartera.por_cobrar_actual)} + semana actual</small></div><div><span>Por pagar</span><strong>{usd(vistaPrevia.cartera.por_pagar)}</strong><small>Compras pendientes</small></div></div>
      <div className="close-preview-balance"><span>Balance estimado</span><strong>{usd(vistaPrevia.balance_estimado)}</strong></div>
      {vistaPrevia.cajas_perdidas > 0 && <p className="notice notice--warning"><strong>{vistaPrevia.cajas_perdidas.toLocaleString('es-MX')} cajas perdidas</strong> en {vistaPrevia.productos_con_faltante} {vistaPrevia.productos_con_faltante === 1 ? 'producto' : 'productos'}. Se valuarán como cero y se crearán incidencias; no bloquean el cierre.</p>}
      <CollapsibleSection title="Facturas por generar" count={vistaPrevia.facturas.length}><div className="invoice-list close-preview-invoices"><div className="invoice-row invoice-row--head"><span>Factura</span><span>Empresa / ubicación</span><span>Vencimiento</span><span>Línea</span><span>Total</span></div>{vistaPrevia.facturas.map((f) => <div className="invoice-row" key={f.numero}><span className="invoice-number">{f.numero}<small>{f.productos} productos · {f.unidades.toLocaleString('es-MX')} unidades</small></span><span data-label="Ubicación"><strong>{f.ubicacion}</strong><small>{f.empresa}</small></span><span data-label="Vence">{f.vence_at}</span><span data-label="Línea"><span className="chip">{f.linea}</span></span><span data-label="Total"><strong>{usd(f.total)}</strong></span></div>)}</div></CollapsibleSection>
      <div className="close-preview-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => setVistaPrevia(null)}>Seguir revisando</button><button className="btn btn-primary" disabled={busy} onClick={() => void cerrar()}>{busy ? 'Cerrando…' : `Confirmar cierre · ${usd(vistaPrevia.ventas.total)}`}</button></div>
    </Modal>}
    {factura && <Modal className="invoice-print" ariaLabelledBy="invoice-preview-title" onClose={() => setFactura(null)}><div className="card-head"><div><span className="eyebrow">Factura</span><strong id="invoice-preview-title">M&amp;G Management and Logistics Inc.</strong></div><button className="icon-btn" aria-label="Cerrar" onClick={() => setFactura(null)}><Icono name="x" /></button></div><h2>{factura.ubicacion}</h2><p>{factura.empresa} · {factura.numero} · vence {factura.vence_at}</p><div className="invoice-detail">{factura.lineas.map((l, i) => <div key={i}><span><strong>{l.descripcion}</strong><small>{l.cantidad} × {usd(l.precio)}</small></span><strong>{usd(l.importe)}</strong></div>)}</div><div className="invoice-grand-total"><span>Total</span><strong>{usd(factura.total)}</strong></div><button className="btn btn-primary btn-block" onClick={() => window.print()}>Imprimir / guardar PDF</button></Modal>}
  </div>;
}
