import { useEffect, useState } from 'react';
import { api, ApiError, fueEncolado } from '../../api';
import Spinner from '../../components/Spinner';
import CollapsibleSection from '../../components/CollapsibleSection';

export interface Ubicacion {
  id: number;
  nombre: string;
  codigo: string;
  direccion: string | null;
  tipo: 'bodega' | 'sucursal';
  activo: boolean;
  empresa_cliente_id: number | null;
  entrega_en_ubicacion_id: number | null;
  orden_operativo: number;
}
interface Empresa { id: number; codigo: string; nombre: string }

const TIPO_LABEL: Record<Ubicacion['tipo'], string> = {
  bodega: 'Bodega',
  sucursal: 'Sucursal',
};

interface FormState {
  id: number | null;
  nombre: string;
  codigo: string;
  direccion: string;
  tipo: 'bodega' | 'sucursal';
  empresa: string;
  entregaEn: string;
  orden: string;
}

const VACIO: FormState = { id: null, nombre: '', codigo: '', direccion: '', tipo: 'sucursal', empresa: '', entregaEn: '', orden: '999' };

export default function Ubicaciones() {
  const [lista, setLista] = useState<Ubicacion[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [form, setForm] = useState<FormState>(VACIO);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const [ubicaciones, empresasActivas] = await Promise.all([api<Ubicacion[]>('/ubicaciones'), api<Empresa[]>('/ubicaciones/empresas')]);
      setLista(ubicaciones); setEmpresas(empresasActivas);
    } catch {
      setError('No se pudo cargar la lista de ubicaciones');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  function editar(u: Ubicacion) {
    setForm({ id: u.id, nombre: u.nombre, codigo: u.codigo, direccion: u.direccion ?? '', tipo: u.tipo, empresa: String(u.empresa_cliente_id ?? ''), entregaEn: String(u.entrega_en_ubicacion_id ?? ''), orden: String(u.orden_operativo) });
    setError('');
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim() || !form.codigo.trim()) {
      setError('Nombre y código son obligatorios');
      return;
    }
    setGuardando(true);
    setError('');
    const body = {
      nombre: form.nombre.trim(),
      codigo: form.codigo.trim(),
      direccion: form.direccion.trim() || undefined,
      tipo: form.tipo,
      empresa_cliente_id: form.tipo === 'sucursal' && form.empresa ? Number(form.empresa) : null,
      entrega_en_ubicacion_id: form.tipo === 'sucursal' && form.entregaEn ? Number(form.entregaEn) : null,
      orden_operativo: Number(form.orden || 999),
    };
    try {
      if (form.id == null) {
        await api('/ubicaciones', { method: 'POST', body });
      } else {
        await api(`/ubicaciones/${form.id}`, { method: 'PATCH', body });
      }
      setForm(VACIO);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(u: Ubicacion) {
    try {
      const r = await api(`/ubicaciones/${u.id}`, { method: 'PATCH', body: { activo: !u.activo } });
      if (fueEncolado(r)) return;
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al actualizar');
    }
  }

  return (
    <div>
      <form className="card" onSubmit={guardar}>
        <div className="card-head">
          <strong>{form.id == null ? 'Nueva ubicación' : 'Editar ubicación'}</strong>
        </div>
        <label>
          Nombre
          <input
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            placeholder="Ej. Sucursal Pilsen"
          />
        </label>
        <label>
          Código
          <input
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
            placeholder="Ej. PIL"
            maxLength={20}
          />
        </label>
        <label>
          Tipo
          <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as FormState['tipo'] })}>
            <option value="sucursal">Sucursal</option>
            <option value="bodega">Bodega</option>
          </select>
        </label>
        <label>
          Dirección (opcional)
          <input
            value={form.direccion}
            onChange={(e) => setForm({ ...form, direccion: e.target.value })}
            placeholder="Calle, ciudad"
          />
        </label>
        {form.tipo === 'sucursal' && <>
          <label>
            Empresa que recibe la factura
            <select value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })}>
              <option value="">Sin empresa</option>
              {empresas.map((empresa) => <option value={empresa.id} key={empresa.id}>{empresa.codigo} · {empresa.nombre}</option>)}
            </select>
          </label>
          <label>
            Entregar físicamente en
            <select value={form.entregaEn} onChange={(e) => setForm({ ...form, entregaEn: e.target.value })}>
              <option value="">Esta misma ubicación</option>
              {lista.filter((u) => u.tipo === 'sucursal' && u.activo && u.id !== form.id).map((u) => <option value={u.id} key={u.id}>{u.nombre}</option>)}
            </select>
          </label>
        </>}
        <label>
          Orden operativo
          <input type="number" min="0" max="9999" value={form.orden} onChange={(e) => setForm({ ...form, orden: e.target.value })} />
        </label>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={guardando}>
            {form.id == null ? 'Agregar' : 'Guardar cambios'}
          </button>
          {form.id != null && (
            <button className="btn btn-ghost" type="button" onClick={() => { setForm(VACIO); setError(''); }}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      {cargando ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <p className="muted">Aún no hay ubicaciones. Agrega la bodega central y tus sucursales.</p>
      ) : (
        <CollapsibleSection title="Ubicaciones registradas" count={lista.length} className="config-list-section"><div className="lista-ubicaciones">
          {lista.map((u) => (
            <div key={u.id} className={`card ${u.activo ? '' : 'card--off'}`}>
              <div className="ubic-row">
                <div>
                  <strong>{u.nombre}</strong>{' '}
                  <span className={`chip ${u.tipo === 'bodega' ? 'chip--info' : 'chip--ok'}`}>{TIPO_LABEL[u.tipo]}</span>
                  {!u.activo && <span className="chip chip--warn">Inactiva</span>}
                  <div className="muted">
                    {u.codigo}
                    {u.direccion ? ` · ${u.direccion}` : ''}
                    {u.empresa_cliente_id ? ` · ${empresas.find((e) => e.id === u.empresa_cliente_id)?.codigo ?? 'Empresa'}` : ''}
                    {u.entrega_en_ubicacion_id ? ` · entrega en ${lista.find((x) => x.id === u.entrega_en_ubicacion_id)?.nombre ?? 'otra ubicación'}` : ''}
                  </div>
                </div>
                <div className="form-actions">
                  <button className="btn btn-secondary" onClick={() => editar(u)}>Editar</button>
                  <button className="btn btn-ghost" onClick={() => void alternarActivo(u)}>
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div></CollapsibleSection>
      )}
    </div>
  );
}
