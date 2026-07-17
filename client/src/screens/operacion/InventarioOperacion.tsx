import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import Spinner from '../../components/Spinner';

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

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function InventarioOperacion() {
  const { usuario } = useAuth();
  const admin = usuario?.rol === 'admin';
  const [almacenes, setAlmacenes] = useState<Almacen[]>([]);
  const [almacenId, setAlmacenId] = useState('');
  const [stock, setStock] = useState<Stock | null>(null);
  const [linea, setLinea] = useState<Linea>('todas');
  const [buscar, setBuscar] = useState('');
  const [error, setError] = useState('');

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
    api<Stock>(`/existencias?ubicacion=${almacenId}`)
      .then(setStock)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar el inventario.'));
  }, [almacenId]);

  const filas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (stock?.items ?? []).filter((i) => {
      if (linea !== 'todas' && i.linea !== linea) return false;
      if (q && !`${i.nombre} ${i.sku} ${i.tipo ?? ''}`.toLowerCase().includes(q)) return false;
      return i.disponible !== 0 || i.reservada !== 0 || i.transito !== 0;
    });
  }, [stock, linea, buscar]);

  const totales = filas.reduce((a, i) => ({
    disponible: a.disponible + i.disponible,
    reservado: a.reservado + i.reservada,
    transito: a.transito + i.transito,
    valor: a.valor + i.valor,
  }), { disponible: 0, reservado: 0, transito: 0, valor: 0 });

  return <div className="page operation-page">
    <header className="page-head operation-page-head">
      <div><span className="eyebrow">Control de existencias</span><h1>Inventarios</h1><p className="page-sub">Bodega Addison y Carnicería, separadas por línea y estado físico.</p></div>
      {admin && <div className="page-actions"><Link className="btn btn-secondary" to="/compras">Registrar compra</Link><Link className="btn btn-primary" to="/produccion">Registrar producción</Link></div>}
    </header>

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
        <div><span>Disponible</span><strong>{totales.disponible.toLocaleString('es-MX')}</strong></div>
        <div><span>En reserva</span><strong>{totales.reservado.toLocaleString('es-MX')}</strong></div>
        <div><span>En tránsito / hold</span><strong>{totales.transito.toLocaleString('es-MX')}</strong></div>
      </div>

      <section className="workspace-card">
        <div className="workspace-card-head">
          <div><h2>Existencias por producto</h2><p>{filas.length} productos con movimiento</p></div>
          <input className="compact-search" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto o SKU" />
        </div>
        <div className="data-list data-list--inventory">
          <div className="data-row data-row--head"><span>Producto</span><span>Disponible</span><span>Reserva</span><span>Tránsito</span><span>Costo</span><span>Valor</span></div>
          {filas.map((i) => <div className="data-row" key={i.product_id}>
            <span className="data-primary"><strong>{i.nombre}</strong><small>{i.sku} · {i.tipo?.replaceAll('_', ' ') ?? i.linea}</small></span>
            <span data-label="Disponible"><strong>{i.disponible.toLocaleString('es-MX')}</strong> <small>{i.unidad}</small></span>
            <span data-label="Reserva">{i.reservada.toLocaleString('es-MX')}</span>
            <span data-label="Tránsito">{i.transito.toLocaleString('es-MX')}</span>
            <span data-label="Costo">{i.costo_promedio == null ? '—' : usd(i.costo_promedio)}</span>
            <span data-label="Valor"><strong>{usd(i.valor)}</strong></span>
          </div>)}
          {!filas.length && <div className="empty-state"><strong>Sin existencias para este filtro</strong><span>Cambia de almacén o línea.</span></div>}
        </div>
      </section>
      {admin && <p className="operation-footnote">Los conteos físicos y ajustes extraordinarios siguen disponibles en <Link to="/conteos">Ajustes de inventario</Link>.</p>}
    </>}
  </div>;
}
