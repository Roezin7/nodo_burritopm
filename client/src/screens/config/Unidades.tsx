import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';
import CollapsibleSection from '../../components/CollapsibleSection';

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
  const [editandoId, setEditandoId] = useState<number | null>(null);

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
      await api(editandoId == null ? '/catalogo/unidades' : `/catalogo/unidades/${editandoId}`, { method: editandoId == null ? 'POST' : 'PATCH', body: { nombre: nombre.trim() } });
      setNombre('');
      setEditandoId(null);
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
        <div className="card-head"><strong>{editandoId == null ? 'Nueva unidad' : 'Editar unidad'}</strong></div>
        <label>
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Caja, Pieza, Galón" />
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
        <p className="muted">Aún no hay unidades. Crea las que uses (Caja, Pieza, Galón…).</p>
      ) : (
        <CollapsibleSection title="Unidades registradas" count={lista.length} className="config-list-section"><div className="lista-ubicaciones">
          {lista.map((u) => (
            <div key={u.id} className={`card ${u.activo ? '' : 'card--off'}`}>
              <div className="ubic-row">
                <div><strong>{u.nombre}</strong> {!u.activo && <span className="chip chip--warn">Inactiva</span>}</div>
                <div className="form-actions">
                  <button className="btn btn-secondary" onClick={() => { setEditandoId(u.id); setNombre(u.nombre); setError(''); }}>Editar</button>
                  <button className="btn btn-ghost" onClick={() => void alternar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                </div>
              </div>
            </div>
          ))}
        </div></CollapsibleSection>
      )}
    </div>
  );
}
