import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';
import CollapsibleSection from '../../components/CollapsibleSection';
import type { Categoria } from './Categorias';
import type { Unidad } from './Unidades';

export interface Producto {
  id: number;
  nombre: string;
  sku: string;
  codigo_barras: string | null;
  categoria_id: number | null;
  categoria: string | null;
  unidad_distribucion_id: number;
  unidad_distribucion: string;
  unidad_compra_id: number | null;
  unidad_almacen_id: number | null;
  factor_compra_almacen: number | null;
  factor_almacen_distribucion: number | null;
  costo_promedio: number | null;
  ultimo_costo: number | null;
  administrado_bodega: boolean;
  requiere_refrigeracion: boolean;
  stock_min_bodega: number | null;
  stock_seguridad_bodega: number | null;
  lead_time_dias: number | null;
  linea_operacion: 'carne' | 'desechables' | null;
  tipo_operativo: 'desechable' | 'materia_prima' | 'proteina' | 'precio_fijo' | 'servicio' | null;
  precio_venta_fijo: number | null;
  markup_caja: number;
  peso_caja_lb: number | null;
  produccion_dias: number[];
  orden_operativo: number;
  activo: boolean;
  materia_prima_id: number | null;
  subproducto_sin_costo: boolean;
}

interface FormState {
  id: number | null;
  nombre: string;
  sku: string;
  categoria_id: string;
  unidad_distribucion_id: string;
  unidad_compra_id: string;
  unidad_almacen_id: string;
  factor_compra_almacen: string;
  factor_almacen_distribucion: string;
  ultimo_costo: string;
  administrado_bodega: boolean;
  requiere_refrigeracion: boolean;
  stock_min_bodega: string;
  stock_seguridad_bodega: string;
  linea_operacion: string;
  tipo_operativo: string;
  precio_venta_fijo: string;
  markup_caja: string;
  peso_caja_lb: string;
  produccion_dias: number[];
  orden_operativo: string;
  materia_prima_id: string;
  subproducto_sin_costo: boolean;
}

const VACIO: FormState = {
  id: null, nombre: '', sku: '', categoria_id: '', unidad_distribucion_id: '', unidad_compra_id: '',
  unidad_almacen_id: '', factor_compra_almacen: '1', factor_almacen_distribucion: '1', ultimo_costo: '',
  administrado_bodega: true, requiere_refrigeracion: false, stock_min_bodega: '', stock_seguridad_bodega: '',
  linea_operacion: '', tipo_operativo: '', precio_venta_fijo: '', markup_caja: '0', peso_caja_lb: '', produccion_dias: [], orden_operativo: '999', materia_prima_id: '', subproducto_sin_costo: false,
};

const numOrUndef = (s: string) => (s.trim() === '' ? undefined : Number(s));

export default function Productos() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [form, setForm] = useState<FormState>(VACIO);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [buscar, setBuscar] = useState('');

  async function cargar() {
    setCargando(true);
    try {
      const [ps, cs, us] = await Promise.all([
        api<Producto[]>('/catalogo/productos'),
        api<Categoria[]>('/catalogo/categorias'),
        api<Unidad[]>('/catalogo/unidades'),
      ]);
      setProductos(ps);
      setCats(cs);
      setUnidades(us);
    } catch {
      setError('No se pudo cargar el catálogo');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); }, []);

  function editar(p: Producto) {
    setForm({
      id: p.id, nombre: p.nombre, sku: p.sku, categoria_id: p.categoria_id?.toString() ?? '',
      unidad_distribucion_id: p.unidad_distribucion_id.toString(),
      unidad_compra_id: p.unidad_compra_id?.toString() ?? '',
      unidad_almacen_id: p.unidad_almacen_id?.toString() ?? '',
      factor_compra_almacen: (p.factor_compra_almacen ?? 1).toString(),
      factor_almacen_distribucion: (p.factor_almacen_distribucion ?? 1).toString(),
      ultimo_costo: p.ultimo_costo?.toString() ?? '',
      administrado_bodega: p.administrado_bodega, requiere_refrigeracion: p.requiere_refrigeracion,
      stock_min_bodega: p.stock_min_bodega?.toString() ?? '', stock_seguridad_bodega: p.stock_seguridad_bodega?.toString() ?? '',
      linea_operacion: p.linea_operacion ?? '', tipo_operativo: p.tipo_operativo ?? '', precio_venta_fijo: p.precio_venta_fijo?.toString() ?? '',
      markup_caja: p.markup_caja.toString(), peso_caja_lb: p.peso_caja_lb?.toString() ?? '', produccion_dias: p.produccion_dias,
      orden_operativo: p.orden_operativo.toString(),
      materia_prima_id: p.materia_prima_id?.toString() ?? '', subproducto_sin_costo: p.subproducto_sin_costo,
    });
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim() || !form.sku.trim() || !form.unidad_distribucion_id) {
      setError('Nombre, SKU y unidad de distribución son obligatorios');
      return;
    }
    setGuardando(true);
    setError('');
    const body = {
      nombre: form.nombre.trim(),
      sku: form.sku.trim(),
      categoria_id: form.categoria_id ? Number(form.categoria_id) : null,
      unidad_distribucion_id: Number(form.unidad_distribucion_id),
      unidad_compra_id: form.unidad_compra_id ? Number(form.unidad_compra_id) : null,
      unidad_almacen_id: form.unidad_almacen_id ? Number(form.unidad_almacen_id) : null,
      factor_compra_almacen: numOrUndef(form.factor_compra_almacen),
      factor_almacen_distribucion: numOrUndef(form.factor_almacen_distribucion),
      ultimo_costo: form.ultimo_costo.trim() === '' ? null : Number(form.ultimo_costo),
      administrado_bodega: form.administrado_bodega,
      requiere_refrigeracion: form.requiere_refrigeracion,
      stock_min_bodega: form.stock_min_bodega.trim() === '' ? null : Number(form.stock_min_bodega),
      stock_seguridad_bodega: form.stock_seguridad_bodega.trim() === '' ? null : Number(form.stock_seguridad_bodega),
      linea_operacion: form.linea_operacion || null,
      tipo_operativo: form.tipo_operativo || null,
      precio_venta_fijo: form.precio_venta_fijo.trim() === '' ? null : Number(form.precio_venta_fijo),
      markup_caja: form.tipo_operativo === 'proteina' ? 15 : Number(form.markup_caja || 0),
      peso_caja_lb: form.peso_caja_lb.trim() === '' ? null : Number(form.peso_caja_lb),
      produccion_dias: form.produccion_dias,
      orden_operativo: Number(form.orden_operativo || 999),
      materia_prima_id: form.materia_prima_id ? Number(form.materia_prima_id) : null,
      subproducto_sin_costo: form.subproducto_sin_costo,
    };
    try {
      if (form.id == null) await api('/catalogo/productos', { method: 'POST', body });
      else await api(`/catalogo/productos/${form.id}`, { method: 'PATCH', body });
      setForm(VACIO);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function alternar(p: Producto) {
    try {
      await api(`/catalogo/productos/${p.id}`, { method: 'PATCH', body: { activo: !p.activo } });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error');
    }
  }

  const unidadesActivas = unidades.filter((u) => u.activo);
  const catsActivas = cats.filter((c) => c.activo);
  const sinUnidades = unidadesActivas.length === 0;
  const consulta = buscar.trim().toLowerCase();
  const productosVisibles = productos.filter((producto) => !consulta || `${producto.nombre} ${producto.sku} ${producto.linea_operacion ?? ''} ${producto.tipo_operativo ?? ''}`.toLowerCase().includes(consulta));

  return (
    <div>
      {sinUnidades && <p className="muted">Primero crea al menos una unidad en la pestaña Unidades.</p>}
      <form className="card" onSubmit={guardar}>
        <div className="card-head"><strong>{form.id == null ? 'Nuevo producto' : 'Editar producto'}</strong></div>
        <label>Nombre<input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Servilletas" /></label>
        <label>SKU<input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Ej. SERV-001" maxLength={40} /></label>
        <label>
          Categoría
          <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: e.target.value })}>
            <option value="">— Sin categoría —</option>
            {catsActivas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>
          Unidad de venta
          <select value={form.unidad_distribucion_id} onChange={(e) => setForm({ ...form, unidad_distribucion_id: e.target.value })}>
            <option value="">— Elegir —</option>
            {unidadesActivas.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </label>

        <details className="prod-extra">
          <summary>Conversiones de compra</summary>
          <label>
            Unidad de compra
            <select value={form.unidad_compra_id} onChange={(e) => setForm({ ...form, unidad_compra_id: e.target.value })}>
              <option value="">— Ninguna —</option>
              {unidadesActivas.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </label>
          <label>Factor compra → almacén (ej. 1 caja = 12)
            <input value={form.factor_compra_almacen} onChange={(e) => setForm({ ...form, factor_compra_almacen: e.target.value })} inputMode="decimal" />
          </label>
          <label>
            Unidad de almacén
            <select value={form.unidad_almacen_id} onChange={(e) => setForm({ ...form, unidad_almacen_id: e.target.value })}>
              <option value="">— Ninguna —</option>
              {unidadesActivas.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </label>
          <label>Factor almacén → distribución
            <input value={form.factor_almacen_distribucion} onChange={(e) => setForm({ ...form, factor_almacen_distribucion: e.target.value })} inputMode="decimal" />
          </label>
        </details>

        <label>Costo por unidad de distribución (USD)
          <input value={form.ultimo_costo} onChange={(e) => setForm({ ...form, ultimo_costo: e.target.value })} inputMode="decimal" placeholder="0.00" />
        </label>

        <details className="prod-extra" open={form.linea_operacion === 'carne'}>
          <summary>Operación semanal y facturación</summary>
          <label>Línea
            <select value={form.linea_operacion} onChange={(e) => setForm({ ...form, linea_operacion: e.target.value })}>
              <option value="">— Catálogo general —</option><option value="carne">Carne</option><option value="desechables">Desechables</option>
            </select>
          </label>
          <label>Tipo operativo
            <select value={form.tipo_operativo} onChange={(e) => setForm({ ...form, tipo_operativo: e.target.value, markup_caja: e.target.value === 'proteina' ? '15' : form.markup_caja, materia_prima_id: e.target.value === 'materia_prima' ? '' : form.materia_prima_id, subproducto_sin_costo: e.target.value === 'proteina' ? false : form.subproducto_sin_costo })}>
              <option value="">— Ninguno —</option><option value="desechable">Desechable</option><option value="materia_prima">Materia prima</option><option value="proteina">Proteína producida</option><option value="precio_fijo">Precio fijo</option><option value="servicio">Servicio / catering</option>
            </select>
          </label>
          <label>Precio fijo de venta<input value={form.precio_venta_fijo} onChange={(e) => setForm({ ...form, precio_venta_fijo: e.target.value })} inputMode="decimal" placeholder="Vacío = costo" /></label>
          <label>Markup por caja {form.tipo_operativo === 'proteina' ? '(fijo)' : ''}<input value={form.tipo_operativo === 'proteina' ? '15' : form.markup_caja} disabled={form.tipo_operativo === 'proteina'} onChange={(e) => setForm({ ...form, markup_caja: e.target.value })} inputMode="decimal" /></label>
          <label>{form.tipo_operativo === 'materia_prima' ? 'Peso promedio de caja comprada (lb)' : form.tipo_operativo === 'proteina' ? 'Peso de caja terminada (lb)' : 'Peso por caja (lb)'}<input value={form.peso_caja_lb} onChange={(e) => setForm({ ...form, peso_caja_lb: e.target.value })} inputMode="decimal" /></label>
          <label>Orden en pedidos y libros<input type="number" min="0" value={form.orden_operativo} onChange={(e) => setForm({ ...form, orden_operativo: e.target.value })} inputMode="numeric" /></label>
          {form.linea_operacion === 'carne' && form.tipo_operativo !== 'materia_prima' && <>
            <label>Se produce a partir de
              <select value={form.materia_prima_id} onChange={(e) => setForm({ ...form, materia_prima_id: e.target.value })}>
                <option value="">— No es producto de producción —</option>
                {productos.filter((p) => p.activo && p.tipo_operativo === 'materia_prima').map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>
            {form.materia_prima_id && form.tipo_operativo !== 'proteina' && <label className="ubic-check"><input type="checkbox" checked={form.subproducto_sin_costo} onChange={(e) => setForm({ ...form, subproducto_sin_costo: e.target.checked })} /><span>Subproducto vendible sin costo del batch</span></label>}
          </>}
          <div><span className="muted">Días sugeridos de producción</span><div className="dist-suc-mini">{['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((dia, i) => <label className="chip" key={dia}><input type="checkbox" checked={form.produccion_dias.includes(i)} onChange={(e) => setForm({ ...form, produccion_dias: e.target.checked ? [...form.produccion_dias, i].sort() : form.produccion_dias.filter((d) => d !== i) })} /> {dia}</label>)}</div></div>
        </details>

        <label className="ubic-check">
          <input type="checkbox" checked={form.administrado_bodega} onChange={(e) => setForm({ ...form, administrado_bodega: e.target.checked })} />
          <span>Se administra desde la bodega central</span>
        </label>
        <label className="ubic-check">
          <input type="checkbox" checked={form.requiere_refrigeracion} onChange={(e) => setForm({ ...form, requiere_refrigeracion: e.target.checked })} />
          <span>Requiere refrigeración</span>
        </label>

        <details className="prod-extra">
          <summary>Niveles de bodega (opcional)</summary>
          <label>Stock mínimo de bodega<input value={form.stock_min_bodega} onChange={(e) => setForm({ ...form, stock_min_bodega: e.target.value })} inputMode="decimal" /></label>
          <label>Stock de seguridad de bodega<input value={form.stock_seguridad_bodega} onChange={(e) => setForm({ ...form, stock_seguridad_bodega: e.target.value })} inputMode="decimal" /></label>
        </details>

        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={guardando || sinUnidades}>
            {form.id == null ? 'Agregar' : 'Guardar cambios'}
          </button>
          {form.id != null && <button className="btn btn-ghost" type="button" onClick={() => { setForm(VACIO); setError(''); }}>Cancelar</button>}
        </div>
      </form>

      {cargando ? (
        <Spinner />
      ) : productos.length === 0 ? (
        <p className="muted">Aún no hay productos.</p>
      ) : (
        <CollapsibleSection title="Productos registrados" count={productosVisibles.length} summary={`${productos.length} totales`} className="config-list-section"><input className="compact-search config-list-search" type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto o SKU" /><div className="lista-ubicaciones">
          {productosVisibles.map((p) => (
            <div key={p.id} className={`card ${p.activo ? '' : 'card--off'}`}>
              <div className="ubic-row">
                <div>
                  <strong>{p.nombre}</strong>{' '}
                  <span className="chip chip--info">{p.unidad_distribucion}</span>
                  {p.categoria && <span className="chip chip--ok">{p.categoria}</span>}
                  {p.requiere_refrigeracion && <span className="chip chip--warn">🧊</span>}
                  {!p.activo && <span className="chip chip--warn">Inactivo</span>}
                  <div className="muted">
                    {p.sku}
                    {p.ultimo_costo != null ? ` · $${p.ultimo_costo.toFixed(2)}` : ' · sin costo'}
                    {p.linea_operacion ? ` · ${p.linea_operacion}` : ''}{p.peso_caja_lb ? ` · ${p.peso_caja_lb} lb/${p.tipo_operativo === 'materia_prima' ? 'caja comprada' : 'caja terminada'}` : ''}
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn btn-secondary" onClick={() => editar(p)}>Editar</button>
                  <button className="btn btn-ghost" onClick={() => void alternar(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </div>
            </div>
          ))}
          {!productosVisibles.length && <div className="empty-state"><strong>Sin coincidencias</strong></div>}
        </div></CollapsibleSection>
      )}
    </div>
  );
}
