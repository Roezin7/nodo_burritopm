import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';
import CollapsibleSection from '../../components/CollapsibleSection';

interface Proveedor {
  id: number;
  nombre: string;
  activo: boolean;
}

export default function Proveedores() {
  const [lista, setLista] = useState<Proveedor[]>([]);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);

  async function cargar() {
    setCargando(true);
    setError('');
    try {
      setLista(await api<Proveedor[]>('/catalogo/proveedores'));
    } catch {
      setError('No se pudieron cargar los proveedores.');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { void cargar(); }, []);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await api(editandoId == null ? '/catalogo/proveedores' : `/catalogo/proveedores/${editandoId}`, { method: editandoId == null ? 'POST' : 'PATCH', body: { nombre: nombre.trim() } });
      setNombre('');
      setEditandoId(null);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el proveedor.');
    } finally {
      setBusy(false);
    }
  }

  function editar(proveedor: Proveedor) { setEditandoId(proveedor.id); setNombre(proveedor.nombre); setError(''); }

  async function alternar(proveedor: Proveedor) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api(`/catalogo/proveedores/${proveedor.id}`, { method: 'PATCH', body: { activo: !proveedor.activo } });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo actualizar el proveedor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form className="card" onSubmit={agregar}>
        <div className="card-head"><strong>{editandoId == null ? 'Nuevo proveedor' : 'Editar proveedor'}</strong></div>
        <label>
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Preferred Meat" maxLength={120} />
        </label>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          {editandoId != null && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setEditandoId(null); setNombre(''); }}>Cancelar</button>}
          <button className="btn btn-primary" type="submit" disabled={busy || !nombre.trim()}>{busy ? 'Guardando…' : editandoId == null ? 'Agregar' : 'Guardar cambios'}</button>
        </div>
      </form>

      {cargando ? <Spinner /> : lista.length === 0 ? <p className="muted">Aún no hay proveedores.</p> : (
        <CollapsibleSection title="Proveedores registrados" count={lista.length} className="config-list-section"><div className="lista-ubicaciones">
          {lista.map((proveedor) => (
            <div key={proveedor.id} className={`card ${proveedor.activo ? '' : 'card--off'}`}>
              <div className="ubic-row">
                <div><strong>{proveedor.nombre}</strong> {!proveedor.activo && <span className="chip chip--warn">Inactivo</span>}</div>
                <div className="form-actions">
                  <button className="btn btn-secondary" disabled={busy} onClick={() => editar(proveedor)}>Editar</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void alternar(proveedor)}>{proveedor.activo ? 'Quitar' : 'Restaurar'}</button>
                </div>
              </div>
            </div>
          ))}
        </div></CollapsibleSection>
      )}
    </div>
  );
}
