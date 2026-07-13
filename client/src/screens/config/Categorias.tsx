import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';

export interface Categoria {
  id: number;
  nombre: string;
  orden: number;
  activo: boolean;
}

export default function Categorias() {
  const [lista, setLista] = useState<Categoria[]>([]);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setCargando(true);
    try {
      setLista(await api<Categoria[]>('/catalogo/categorias'));
    } catch {
      setError('No se pudieron cargar las categorías');
    } finally {
      setCargando(false);
    }
  }
  useEffect(() => { void cargar(); }, []);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    try {
      await api('/catalogo/categorias', { method: 'POST', body: { nombre: nombre.trim() } });
      setNombre('');
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    }
  }

  async function renombrar(c: Categoria) {
    const nuevo = window.prompt('Nuevo nombre de la categoría:', c.nombre);
    if (!nuevo || nuevo.trim() === c.nombre) return;
    try {
      await api(`/catalogo/categorias/${c.id}`, { method: 'PATCH', body: { nombre: nuevo.trim() } });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al renombrar');
    }
  }

  async function alternar(c: Categoria) {
    try {
      await api(`/catalogo/categorias/${c.id}`, { method: 'PATCH', body: { activo: !c.activo } });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error');
    }
  }

  return (
    <div>
      <form className="card" onSubmit={agregar}>
        <div className="card-head"><strong>Nueva categoría</strong></div>
        <label>
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Desechables" />
        </label>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit">Agregar</button>
        </div>
      </form>
      {cargando ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <p className="muted">Aún no hay categorías.</p>
      ) : (
        <div className="lista-ubicaciones">
          {lista.map((c) => (
            <div key={c.id} className={`card ${c.activo ? '' : 'card--off'}`}>
              <div className="ubic-row">
                <div>
                  <strong>{c.nombre}</strong>{' '}
                  {!c.activo && <span className="chip chip--warn">Inactiva</span>}
                </div>
                <div className="form-actions">
                  <button className="btn btn-secondary" onClick={() => void renombrar(c)}>Renombrar</button>
                  <button className="btn btn-ghost" onClick={() => void alternar(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
