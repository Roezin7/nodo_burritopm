import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';
import CollapsibleSection from '../../components/CollapsibleSection';

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
  const [editandoId, setEditandoId] = useState<number | null>(null);

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
      await api(editandoId == null ? '/catalogo/categorias' : `/catalogo/categorias/${editandoId}`, { method: editandoId == null ? 'POST' : 'PATCH', body: { nombre: nombre.trim() } });
      setNombre('');
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    }
  }

  function editar(c: Categoria) { setEditandoId(c.id); setNombre(c.nombre); setError(''); }

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
        <div className="card-head"><strong>{editandoId == null ? 'Nueva categoría' : 'Editar categoría'}</strong></div>
        <label>
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Desechables" />
        </label>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          {editandoId != null && <button className="btn btn-ghost" type="button" onClick={() => { setEditandoId(null); setNombre(''); }}>Cancelar</button>}
          <button className="btn btn-primary" type="submit">{editandoId == null ? 'Agregar' : 'Guardar cambios'}</button>
        </div>
      </form>
      {cargando ? (
        <Spinner />
      ) : lista.length === 0 ? (
        <p className="muted">Aún no hay categorías.</p>
      ) : (
        <CollapsibleSection title="Categorías registradas" count={lista.length} className="config-list-section"><div className="lista-ubicaciones">
          {lista.map((c) => (
            <div key={c.id} className={`card ${c.activo ? '' : 'card--off'}`}>
              <div className="ubic-row">
                <div>
                  <strong>{c.nombre}</strong>{' '}
                  {!c.activo && <span className="chip chip--warn">Inactiva</span>}
                </div>
                <div className="form-actions">
                  <button className="btn btn-secondary" onClick={() => editar(c)}>Editar</button>
                  <button className="btn btn-ghost" onClick={() => void alternar(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </div>
            </div>
          ))}
        </div></CollapsibleSection>
      )}
    </div>
  );
}
