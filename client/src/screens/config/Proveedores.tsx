import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';

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
      await api('/catalogo/proveedores', { method: 'POST', body: { nombre: nombre.trim() } });
      setNombre('');
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el proveedor.');
    } finally {
      setBusy(false);
    }
  }

  async function renombrar(proveedor: Proveedor) {
    const nuevo = window.prompt('Nuevo nombre del proveedor:', proveedor.nombre)?.trim();
    if (!nuevo || nuevo === proveedor.nombre || busy) return;
    setBusy(true); setError('');
    try {
      await api(`/catalogo/proveedores/${proveedor.id}`, { method: 'PATCH', body: { nombre: nuevo } });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo renombrar el proveedor.');
    } finally {
      setBusy(false);
    }
  }

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
        <div className="card-head"><strong>Nuevo proveedor</strong></div>
        <label>
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Preferred Meat" maxLength={120} />
        </label>
        {error && <p className="error-msg">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy || !nombre.trim()}>{busy ? 'Guardando…' : 'Agregar'}</button>
        </div>
      </form>

      {cargando ? <Spinner /> : lista.length === 0 ? <p className="muted">Aún no hay proveedores.</p> : (
        <div className="lista-ubicaciones">
          {lista.map((proveedor) => (
            <div key={proveedor.id} className={`card ${proveedor.activo ? '' : 'card--off'}`}>
              <div className="ubic-row">
                <div><strong>{proveedor.nombre}</strong> {!proveedor.activo && <span className="chip chip--warn">Inactivo</span>}</div>
                <div className="form-actions">
                  <button className="btn btn-secondary" disabled={busy} onClick={() => void renombrar(proveedor)}>Renombrar</button>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void alternar(proveedor)}>{proveedor.activo ? 'Quitar' : 'Restaurar'}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
