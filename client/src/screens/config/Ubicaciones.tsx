import { useEffect, useState } from 'react';
import { api, ApiError, fueEncolado } from '../../api';
import Spinner from '../../components/Spinner';

export interface Ubicacion {
  id: number;
  nombre: string;
  codigo: string;
  direccion: string | null;
  tipo: 'bodega' | 'sucursal';
  activo: boolean;
}

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
}

const VACIO: FormState = { id: null, nombre: '', codigo: '', direccion: '', tipo: 'sucursal' };

export default function Ubicaciones() {
  const [lista, setLista] = useState<Ubicacion[]>([]);
  const [form, setForm] = useState<FormState>(VACIO);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      setLista(await api<Ubicacion[]>('/ubicaciones'));
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
    setForm({ id: u.id, nombre: u.nombre, codigo: u.codigo, direccion: u.direccion ?? '', tipo: u.tipo });
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
        <div className="lista-ubicaciones">
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
        </div>
      )}
    </div>
  );
}
