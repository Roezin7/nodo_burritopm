import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';
import { crearSemana, fechaDentroDeSemana, type SemanaSeleccionada } from '../../semana';
import { useOperacionConfig } from '../../operacion-config';
import CollapsibleSection from '../../components/CollapsibleSection';

type Linea = 'todas' | 'carne' | 'desechables';

interface Almacen {
  id: number;
  nombre: string;
  codigo: string;
  tipo: string;
}

interface Existencia {
  product_id: number;
  nombre: string;
  sku: string;
  linea: 'carne' | 'desechables' | null;
  tipo: string | null;
  unidad: string;
  disponible: number;
  reservada: number;
  transito: number;
  faltante?: number;
  costo_promedio: number | null;
  valor: number;
}

interface Stock {
  items: Existencia[];
  valor_total: number;
  cajas_perdidas?: number;
  fuente?: 'actual' | 'cierre_semanal';
  semana_estado?: string | null;
}
interface InventarioGuardado {
  id: string;
  fecha: string;
  ubicacion: string;
  ajustes: number;
  tipo: 'trazable' | 'anterior';
  motivo: string | null;
  lineas: { product_id: number; cantidad: number }[] | null;
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function InventarioOperacion({ integrado = false, semana = crearSemana() }: { integrado?: boolean; semana?: SemanaSeleccionada }) {
  const { usuario } = useAuth();
  const { repartoHabilitado } = useOperacionConfig();
  const toast = useToast();
  const admin = usuario?.rol === 'admin';
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [almacenId, setAlmacenId] = useState('');
  const [stock, setStock] = useState<Stock | null>(null);
  const [linea, setLinea] = useState<Linea>('todas');
  const [buscar, setBuscar] = useState('');
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(false);
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [fecha, setFecha] = useState(fechaDentroDeSemana(semana));
  const [observacion, setObservacion] = useState('');
  const [busy, setBusy] = useState(false);
  const [historial, setHistorial] = useState<InventarioGuardado[]>([]);

  useEffect(() => {
    api<{ ubicaciones: Almacen[] }>('/operacion/catalogo').then((c) => {
      const asignadas = new Set(usuario?.ubicaciones?.map((u) => u.id) ?? []);
      const bodegas = c.ubicaciones.filter((u) => u.tipo === 'bodega' && (admin || asignadas.has(u.id)));
      setAlmacenes(bodegas);
      const carniceria = bodegas.find((u) => u.codigo === 'CARN');
      setAlmacenId(String((carniceria ?? bodegas[0])?.id ?? ''));
    }).catch(() => setError('No se pudieron cargar los almacenes.'));
  }, [admin, usuario]);

  useEffect(() => {
    if (!almacenId) return;
    setStock(null); setError('');
    Promise.all([
      api<Stock>(`/existencias?ubicacion=${almacenId}&semana=${semana.inicio}`),
      admin ? api<InventarioGuardado[]>(`/operacion/inventarios-finales?ubicacion_id=${almacenId}`) : Promise.resolve([]),
    ])
      .then(([existencias, inventarios]) => { setStock(existencias); setHistorial(inventarios); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el inventario.'));
  }, [almacenId, admin, semana.inicio]);
  useEffect(() => { setFecha(fechaDentroDeSemana(semana)); setEditando(false); }, [semana.inicio, semana.fin]);

  async function recargar() {
    if (!almacenId) return;
    const [existencias, inventarios] = await Promise.all([
      api<Stock>(`/existencias?ubicacion=${almacenId}&semana=${semana.inicio}`),
      admin ? api<InventarioGuardado[]>(`/operacion/inventarios-finales?ubicacion_id=${almacenId}`) : Promise.resolve([]),
    ]);
    setStock(existencias); setHistorial(inventarios);
  }

  const historialSemana = historial.filter((i) => i.fecha >= semana.inicio && i.fecha <= semana.fin);
  const capturaSemana = !semana.actual ? historialSemana.find((i) => i.tipo === 'trazable' && i.lineas?.length) : undefined;
  const itemsPeriodo = useMemo(() => {
    if (!capturaSemana?.lineas || !stock || stock.fuente === 'cierre_semanal') return stock?.items ?? [];
    const cantidadesCapturadas = new Map(capturaSemana.lineas.map((l) => [l.product_id, l.cantidad]));
    return stock.items.map((i) => {
      const disponible = cantidadesCapturadas.get(i.product_id) ?? 0;
      return { ...i, disponible, reservada: 0, transito: 0, valor: i.costo_promedio == null ? 0 : disponible * i.costo_promedio };
    });
  }, [stock, capturaSemana]);

  const filas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return itemsPeriodo.filter((i) => {
      if (linea !== 'todas' && i.linea !== linea) return false;
      if (!editando && q && !`${i.nombre} ${i.sku} ${i.tipo ?? ''}`.toLowerCase().includes(q)) return false;
      return editando || i.disponible !== 0 || i.reservada !== 0 || i.transito !== 0 || (i.faltante ?? 0) > 0;
    });
  }, [itemsPeriodo, linea, buscar, editando]);

  const totales = filas.reduce((a, i) => ({
    disponible: a.disponible + i.disponible,
    reservado: a.reservado + i.reservada,
    transito: a.transito + i.transito,
    valor: a.valor + i.valor,
  }), { disponible: 0, reservado: 0, transito: 0, valor: 0 });
  const almacenActual = almacenes.find((a) => String(a.id) === almacenId);

  function iniciarCierre() {
    setCantidades(Object.fromEntries((stock?.items ?? []).map((i) => [i.product_id, String(i.disponible)])));
    if (almacenActual?.codigo === 'CARN') setFecha(semana.fin);
    setObservacion('');
    setEditando(true);
  }

  async function guardarCierre() {
    if (!almacenId || !stock) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ ajustes: number }>('/operacion/inventario-final', {
        method: 'PUT',
        body: { ubicacion_id: Number(almacenId), fecha, motivo: observacion.trim() || null, lineas: stock.items.map((i) => ({ product_id: i.product_id, cantidad: Number(cantidades[i.product_id] || 0) })) },
      });
      await recargar();
      setEditando(false);
      toast.ok(`Inventario guardado · ${r.ajustes} ajustes.`);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar el inventario.'); }
    finally { setBusy(false); }
  }

  async function eliminarInventario(inventario: InventarioGuardado) {
    if (!window.confirm(`¿Eliminar el inventario del ${inventario.fecha}? Se revertirán todos sus ajustes.`)) return;
    setBusy(true); setError('');
    try {
      await api(`/operacion/inventarios-finales/${inventario.id}`, { method: 'DELETE' });
      await recargar();
      toast.ok('Inventario eliminado y saldos restaurados.');
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo eliminar el inventario.'); }
    finally { setBusy(false); }
  }

  return <div className={integrado ? 'operation-embedded inventory-embedded' : 'page operation-page'}>
    {!integrado && <header className="page-head operation-page-head">
      <div><span className="eyebrow">Inventario</span><h1>Existencias</h1></div>
      {admin && <div className="page-actions"><Link className="btn btn-secondary" to={`/semana/compras?semana=${semana.inicio}`}>Compra</Link><Link className="btn btn-primary" to={`/semana/produccion?semana=${semana.inicio}`}>Producción</Link></div>}
    </header>}
    {integrado && <header className="embedded-head embedded-head--status"><div><span className="eyebrow">Paso {repartoHabilitado ? 6 : 5}</span><h2>Inventario final</h2></div>{admin && !editando && <button className="btn btn-primary" onClick={iniciarCierre}>Capturar inventario</button>}</header>}

    <div className="workspace-toolbar">
      <div className="segmented" aria-label="Almacén">
        {almacenes.map((a) => <button key={a.id} className={String(a.id) === almacenId ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setAlmacenId(String(a.id))}>{a.nombre}</button>)}
      </div>
      <div className="segmented segmented--small" aria-label="Línea de inventario">
        {([['todas', 'Todo'], ['carne', 'Carne'], ['desechables', 'Desechables']] as [Linea, string][]).map(([k, label]) => <button key={k} className={linea === k ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setLinea(k)}>{label}</button>)}
      </div>
    </div>

    {error && <p className="error-msg">{error}</p>}
    {(stock?.cajas_perdidas ?? 0) > 0 && <p className="notice notice--warning"><strong>{stock!.cajas_perdidas!.toLocaleString('es-MX')} cajas perdidas:</strong> se muestran como existencia 0 y no impedirán cerrar la semana. Al cerrar se creará una incidencia para el administrador.</p>}
    {!semana.actual && <p className="notice">{stock?.fuente === 'cierre_semanal' ? <><strong>Cierre de semana {semana.numero}:</strong> cantidades y costos provienen de la fotografía contable.</> : capturaSemana ? <><strong>Inventario final de semana {semana.numero}:</strong> se muestra la captura física del {capturaSemana.fecha}; la valuación todavía corresponde al costo vigente.</> : <><strong>Sin fotografía histórica:</strong> la semana no tiene un cierre disponible y el saldo mostrado es el actual.</>}</p>}
    {!stock && !error ? <Spinner label="Calculando inventario…" /> : stock && <>
      <div className="metric-strip metric-strip--four">
        <div><span>Valor</span><strong>{usd(totales.valor)}</strong></div>
        <div><span>Existencia</span><strong>{totales.disponible.toLocaleString('es-MX')}</strong></div>
        <div><span>En reserva</span><strong>{totales.reservado.toLocaleString('es-MX')}</strong></div>
        <div><span>En tránsito / hold</span><strong>{totales.transito.toLocaleString('es-MX')}</strong></div>
      </div>

      <CollapsibleSection title={editando ? 'Captura física' : 'Productos'} count={filas.length} className="inventory-product-list">
        <div className="workspace-card-head collapsible-inner-toolbar">
          <div />
          {!editando && <input className="compact-search" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar" />}
        </div>
        <div className="data-list data-list--inventory">
          <div className="data-row data-row--head"><span>Producto</span><span>Disponible</span><span>Reserva</span><span>Tránsito</span><span>Costo</span><span>Valor</span></div>
          {filas.map((i) => <div className="data-row" key={i.product_id}>
            <span className="data-primary"><strong>{i.nombre}</strong><small>{i.sku} · {i.tipo?.replaceAll('_', ' ') ?? i.linea}{(i.faltante ?? 0) > 0 && <span className="txt-danger"> · faltan {i.faltante?.toLocaleString('es-MX')}</span>}</small></span>
            <span data-label="Disponible">{editando ? <div className="input-suffix input-suffix--compact"><input type="number" min="0" step={i.unidad.toLowerCase().includes('pieza') ? '1' : '0.5'} value={cantidades[i.product_id] ?? ''} onChange={(e) => setCantidades({ ...cantidades, [i.product_id]: e.target.value })} /><span>{i.unidad}</span></div> : <><strong>{i.disponible.toLocaleString('es-MX')}</strong> <small>{i.unidad}</small></>}</span>
            <span data-label="Reserva">{i.reservada.toLocaleString('es-MX')}</span>
            <span data-label="Tránsito">{i.transito.toLocaleString('es-MX')}</span>
            <span data-label="Costo">{i.costo_promedio == null ? '—' : usd(i.costo_promedio)}</span>
            <span data-label="Valor"><strong>{usd(i.valor)}</strong></span>
          </div>)}
          {!filas.length && <div className="empty-state"><strong>Sin existencias para este filtro</strong><span>Cambia de almacén o línea.</span></div>}
        </div>
      </CollapsibleSection>
      {admin && <CollapsibleSection title={`Inventarios de semana ${semana.numero}`} count={historialSemana.length} defaultOpen={false} className="inventory-history">{historialSemana.length ? <div className="record-list">{historialSemana.map((inventario) => <article className="record-row" key={inventario.id}><div className="record-main"><strong>{inventario.fecha}</strong><span>{inventario.ubicacion} · {inventario.ajustes} renglones</span>{inventario.motivo && <small>{inventario.motivo}</small>}</div><div className="record-total"><span className={`chip ${inventario.tipo === 'anterior' ? 'chip--warn' : 'chip--ok'}`}>{inventario.tipo === 'anterior' ? 'Anterior' : 'Trazable'}</span><button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void eliminarInventario(inventario)}>Eliminar</button></div></article>)}</div> : <div className="empty-state"><strong>Sin inventario final</strong></div>}</CollapsibleSection>}
      {editando && <div className="inventory-capture-actions"><label className="field"><span>{almacenActual?.codigo === 'CARN' ? 'Cierre del sábado' : `Fecha dentro de semana ${semana.numero}`}</span><input type="date" min={semana.inicio} max={semana.fin} value={fecha} disabled={almacenActual?.codigo === 'CARN'} onChange={(e) => setFecha(e.target.value)} /></label><label className="field field--wide"><span>Observación del ajuste</span><input value={observacion} maxLength={500} placeholder="Ej. diferencia de conteo reportada por producción" onChange={(e) => setObservacion(e.target.value)} /></label><button className="btn btn-secondary" disabled={busy} onClick={() => setEditando(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={() => void guardarCierre()}>{busy ? 'Guardando…' : 'Guardar inventario final'}</button></div>}
      {admin && !integrado && <p className="operation-footnote"><Link to="/conteos">Ver historial y ajustes</Link></p>}
    </>}
  </div>;
}
