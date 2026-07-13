import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';

export interface Unidad {
  id: number;
  nombre: string;
  activo: boolean;
}

export default function Unidades() {
  const [lista, setLista] = useState<Unidad[]>([]);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setCargando(true);
    try {
      setLista(await api<Unidad[]>('/catalogo/unidades'));
    } catch {
      setError('No se pudieron cargar las unidades');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); }, []);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    try {
      await api('/catalogo/unidades', { method: 'POST', body: { nombre: nombre.trim() } });
      setNombre('');
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    }
  }

  async function alternar(u: Unidad) {
    try {
      await api(`/catalogo/unidades/${u.id}`, { method: 'PATCH', body: { activo: !u.activo } });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error');
    }
  }

  return (
    <div>
      <form className="card" onSubmit={agregar}>
        <div className="card-head"><strong>Nueva unidad</strong></div>
        <label>
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Caja, Pieza, Galón" />
        </label>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit">Agregar</button>
        </div>
      </form>
      {cargando ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <p className="muted">Aún no hay unidades. Crea las que uses (Caja, Pieza, Galón…).</p>
      ) : (
        <div className="lista-ubicaciones">
          {lista.map((u) => (
            <div key={u.id} className={`card ${u.activo ? '' : 'card--off'}`}>
              <div className="ubic-row">
                <div><strong>{u.nombre}</strong> {!u.activo && <span className="chip chip--warn">Inactiva</span>}</div>
                <div className="form-actions">
                  <button className="btn btn-ghost" onClick={() => void alternar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
