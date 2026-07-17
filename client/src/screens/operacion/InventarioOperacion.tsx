import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import Spinner from '../../components/Spinner';
import { useToast } from '../../toast';

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
  costo_promedio: number | null;
  valor: number;
}

interface Stock {
  items: Existencia[];
  valor_total: number;
}
interface InventarioGuardado {
  id: string;
  fecha: string;
  ubicacion: string;
  ajustes: number;
  tipo: 'trazable' | 'anterior';
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

export default function InventarioOperacion({ integrado = false }: { integrado?: boolean }) {
  const { usuario } = useAuth();
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
  const [fecha, setFecha] = useState(hoy());
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
      api<Stock>(`/existencias?ubicacion=${almacenId}`),
      admin ? api<InventarioGuardado[]>(`/operacion/inventarios-finales?ubicacion_id=${almacenId}`) : Promise.resolve([]),
    ])
      .then(([existencias, inventarios]) => { setStock(existencias); setHistorial(inventarios); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el inventario.'));
  }, [almacenId, admin]);

  async function recargar() {
    if (!almacenId) return;
    const [existencias, inventarios] = await Promise.all([
      api<Stock>(`/existencias?ubicacion=${almacenId}`),
      admin ? api<InventarioGuardado[]>(`/operacion/inventarios-finales?ubicacion_id=${almacenId}`) : Promise.resolve([]),
    ]);
    setStock(existencias); setHistorial(inventarios);
  }

  const filas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (stock?.items ?? []).filter((i) => {
      if (linea !== 'todas' && i.linea !== linea) return false;
      if (!editando && q && !`${i.nombre} ${i.sku} ${i.tipo ?? ''}`.toLowerCase().includes(q)) return false;
      return editando || i.disponible !== 0 || i.reservada !== 0 || i.transito !== 0;
    });
  }, [stock, linea, buscar, editando]);

  const totales = filas.reduce((a, i) => ({
    disponible: a.disponible + i.disponible,
    reservado: a.reservado + i.reservada,
    transito: a.transito + i.transito,
    valor: a.valor + i.valor,
  }), { disponible: 0, reservado: 0, transito: 0, valor: 0 });

  function iniciarCierre() {
    setCantidades(Object.fromEntries((stock?.items ?? []).map((i) => [i.product_id, String(i.disponible)])));
    setEditando(true);
  }

  async function guardarCierre() {
    if (!almacenId || !stock) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ ajustes: number }>('/operacion/inventario-final', {
        method: 'PUT',
        body: { ubicacion_id: Number(almacenId), fecha, lineas: stock.items.map((i) => ({ product_id: i.product_id, cantidad: Number(cantidades[i.product_id] || 0) })) },
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
      {admin && <div className="page-actions"><Link className="btn btn-secondary" to="/semana/compras">Compra</Link><Link className="btn btn-primary" to="/semana/produccion">Producción</Link></div>}
    </header>}
    {integrado && <header className="embedded-head embedded-head--status"><div><span className="eyebrow">Paso 8</span><h2>Inventario final</h2></div>{admin && !editando && <button className="btn btn-primary" onClick={iniciarCierre}>Capturar inventario</button>}</header>}

    <div className="workspace-toolbar">
      <div className="segmented" aria-label="Almacén">
        {almacenes.map((a) => <button key={a.id} className={String(a.id) === almacenId ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setAlmacenId(String(a.id))}>{a.nombre}</button>)}
      </div>
      <div className="segmented segmented--small" aria-label="Línea de inventario">
        {([['todas', 'Todo'], ['carne', 'Carne'], ['desechables', 'Desechables']] as [Linea, string][]).map(([k, label]) => <button key={k} className={linea === k ? 'segmented-btn is-active' : 'segmented-btn'} onClick={() => setLinea(k)}>{label}</button>)}
      </div>
    </div>

    {error && <p className="error-msg">{error}</p>}
    {!stock && !error ? <Spinner label="Calculando inventario…" /> : stock && <>
      <div className="metric-strip metric-strip--four">
        <div><span>Valor</span><strong>{usd(totales.valor)}</strong></div>
        <div><span>Existencia</span><strong>{totales.disponible.toLocaleString('es-MX')}</strong></div>
        <div><span>En reserva</span><strong>{totales.reservado.toLocaleString('es-MX')}</strong></div>
        <div><span>En tránsito / hold</span><strong>{totales.transito.toLocaleString('es-MX')}</strong></div>
      </div>

      <section className="workspace-card">
        <div className="workspace-card-head">
          <div><h2>{editando ? 'Captura física' : 'Productos'}</h2><p>{filas.length} renglones</p></div>
          {!editando && <input className="compact-search" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar" />}
        </div>
        <div className="data-list data-list--inventory">
          <div className="data-row data-row--head"><span>Producto</span><span>Disponible</span><span>Reserva</span><span>Tránsito</span><span>Costo</span><span>Valor</span></div>
          {filas.map((i) => <div className="data-row" key={i.product_id}>
            <span className="data-primary"><strong>{i.nombre}</strong><small>{i.sku} · {i.tipo?.replaceAll('_', ' ') ?? i.linea}</small></span>
            <span data-label="Disponible">{editando ? <div className="input-suffix input-suffix--compact"><input type="number" min="0" step={i.unidad.toLowerCase().includes('pieza') ? '1' : '0.5'} value={cantidades[i.product_id] ?? ''} onChange={(e) => setCantidades({ ...cantidades, [i.product_id]: e.target.value })} /><span>{i.unidad}</span></div> : <><strong>{i.disponible.toLocaleString('es-MX')}</strong> <small>{i.unidad}</small></>}</span>
            <span data-label="Reserva">{i.reservada.toLocaleString('es-MX')}</span>
            <span data-label="Tránsito">{i.transito.toLocaleString('es-MX')}</span>
            <span data-label="Costo">{i.costo_promedio == null ? '—' : usd(i.costo_promedio)}</span>
            <span data-label="Valor"><strong>{usd(i.valor)}</strong></span>
          </div>)}
          {!filas.length && <div className="empty-state"><strong>Sin existencias para este filtro</strong><span>Cambia de almacén o línea.</span></div>}
        </div>
      </section>
      {admin && historial.length > 0 && <section className="workspace-card inventory-history"><div className="workspace-card-head"><div><h2>Inventarios guardados</h2><p>Elimina una captura completa para regresar al saldo anterior.</p></div><span>{historial.length}</span></div><div className="record-list">{historial.map((inventario) => <article className="record-row" key={inventario.id}><div className="record-main"><strong>{inventario.fecha}</strong><span>{inventario.ubicacion} · {inventario.ajustes} renglones</span>{inventario.tipo === 'anterior' && <small>Captura de la versión anterior; también puede revertirse.</small>}</div><div className="record-total"><span className={`chip ${inventario.tipo === 'anterior' ? 'chip--warn' : 'chip--ok'}`}>{inventario.tipo === 'anterior' ? 'Anterior' : 'Trazable'}</span><button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void eliminarInventario(inventario)}>Eliminar</button></div></article>)}</div></section>}
      {editando && <div className="inventory-capture-actions"><label className="field"><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label><button className="btn btn-secondary" disabled={busy} onClick={() => setEditando(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={() => void guardarCierre()}>{busy ? 'Guardando…' : 'Guardar inventario final'}</button></div>}
      {admin && !integrado && <p className="operation-footnote"><Link to="/conteos">Ver historial y ajustes</Link></p>}
    </>}
  </div>;
}
