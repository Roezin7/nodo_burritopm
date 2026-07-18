import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Spinner from '../../components/Spinner';
import { useAuth, type Rol } from '../../auth';
import type { Ubicacion } from './Ubicaciones';
import CollapsibleSection from '../../components/CollapsibleSection';

interface UsuarioAdmin {
  id: number;
  nombre: string;
  rol: Rol;
  activo: boolean;
  ubicacion_ids: number[];
}

const ROLES: { valor: Rol; label: string }[] = [
  { valor: 'admin', label: 'Admin' },
  { valor: 'encargado_bodega', label: 'Bodega y reparto' },
  { valor: 'encargado_sucursal', label: 'Sucursal' },
];
const ROL_LABEL = Object.fromEntries(ROLES.map((r) => [r.valor, r.label])) as Record<Rol, string>;

interface FormState {
  id: number | null;
  nombre: string;
  rol: Rol;
  pin: string;
  ubicacion_ids: number[];
}

const VACIO: FormState = { id: null, nombre: '', rol: 'encargado_sucursal', pin: '', ubicacion_ids: [] };

export default function Usuarios() {
  const { usuario } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [form, setForm] = useState<FormState>(VACIO);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setCargando(true);
    try {
      const [us, ubs] = await Promise.all([
        api<UsuarioAdmin[]>('/auth/admin/usuarios'),
        api<Ubicacion[]>('/ubicaciones'),
      ]);
      setUsuarios(us);
      setUbicaciones(ubs);
    } catch {
      setError('No se pudo cargar usuarios y ubicaciones');
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  function editar(u: UsuarioAdmin) {
    setForm({ id: u.id, nombre: u.nombre, rol: u.rol, pin: '', ubicacion_ids: u.ubicacion_ids });
    setError('');
  }

  function toggleUbic(id: number) {
    setForm((f) => ({
      ...f,
      ubicacion_ids: f.ubicacion_ids.includes(id)
        ? f.ubicacion_ids.filter((x) => x !== id)
        : [...f.ubicacion_ids, id],
    }));
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    if (form.id == null && form.pin.length < 4) {
      setError('El PIN debe tener al menos 4 dígitos');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      if (form.id == null) {
        await api('/auth/admin/usuarios', {
          method: 'POST',
          body: { nombre: form.nombre.trim(), rol: form.rol, pin: form.pin, ubicacion_ids: form.ubicacion_ids },
        });
      } else {
        await api(`/auth/admin/usuarios/${form.id}`, {
          method: 'PATCH',
          body: { nombre: form.nombre.trim(), rol: form.rol, ubicacion_ids: form.ubicacion_ids },
        });
      }
      setForm(VACIO);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(u: UsuarioAdmin) {
    try {
      await api(`/auth/admin/usuarios/${u.id}`, { method: 'PATCH', body: { activo: !u.activo } });
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al actualizar');
    }
  }

  async function resetPin(u: UsuarioAdmin) {
    const pin = window.prompt(`Nuevo PIN para ${u.nombre} (4 a 6 dígitos):`);
    if (!pin) return;
    if (!/^\d{4,6}$/.test(pin)) { setError('El PIN debe tener de 4 a 6 dígitos.'); return; }
    try {
      await api(`/auth/admin/usuarios/${u.id}/reset-pin`, { method: 'POST', body: { pin_nuevo: pin } });
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al cambiar PIN');
    }
  }

  async function eliminar(u: UsuarioAdmin) {
    if (!window.confirm(`Eliminar a ${u.nombre}? Esta acción no se puede deshacer.`)) return;
    try {
      await api(`/auth/admin/usuarios/${u.id}`, { method: 'DELETE' });
      setError('');
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error al eliminar');
    }
  }

  const ubicActivas = ubicaciones.filter((u) => u.activo || form.ubicacion_ids.includes(u.id));
  const nombreUbic = (id: number) => ubicaciones.find((u) => u.id === id)?.nombre ?? `#${id}`;

  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const filtrados = usuarios.filter((u) => !t || u.nombre.toLowerCase().includes(t) || ROL_LABEL[u.rol].toLowerCase().includes(t));
  const GRUPOS: { rol: Rol; titulo: string }[] = [
    { rol: 'admin', titulo: 'Administradores' },
    { rol: 'encargado_bodega', titulo: 'Bodega y reparto' },
    { rol: 'encargado_sucursal', titulo: 'Sucursales' },
  ];

  return (
    <div>
      <form className="card" onSubmit={guardar}>
        <div className="card-head">
          <strong>{form.id == null ? 'Nuevo usuario' : 'Editar usuario'}</strong>
        </div>
        <label>
          Nombre
          <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. María" />
        </label>
        <label>
          Rol
          <select value={form.rol} onChange={(e) => setForm({ ...form, rol: e.target.value as Rol })}>
            {ROLES.map((r) => (
              <option key={r.valor} value={r.valor}>{r.label}</option>
            ))}
          </select>
        </label>
        {form.id == null && (
          <label>
            PIN inicial
            <input
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
              inputMode="numeric"
              placeholder="4 a 6 dígitos"
            />
          </label>
        )}
        {form.rol !== 'admin' && (
          <div className="ubic-check-group">
            <span className="ubic-check-title">Ubicaciones asignadas</span>
            {ubicActivas.length === 0 ? (
              <p className="muted">Primero crea ubicaciones en la pestaña Ubicaciones.</p>
            ) : (
              <div className="ubic-checks">
                {ubicActivas.map((u) => (
                  <label key={u.id} className="ubic-check">
                    <input type="checkbox" checked={form.ubicacion_ids.includes(u.id)} onChange={() => toggleUbic(u.id)} />
                    <span>{u.nombre} <small className="muted">({u.tipo})</small></span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
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
      ) : (
        <CollapsibleSection title="Usuarios registrados" count={filtrados.length} className="config-list-section">
          {usuarios.length > 6 && (
            <input className="inv-search" type="search" placeholder="Buscar usuario o rol…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginTop: '0.5rem' }} />
          )}
          {filtrados.length === 0 && <p className="muted">Sin coincidencias.</p>}
          {GRUPOS.map(({ rol, titulo }) => {
            const delGrupo = filtrados.filter((u) => u.rol === rol);
            if (delGrupo.length === 0) return null;
            return (
              <div key={rol}>
                <div className="usuarios-grupo-titulo">{titulo} · {delGrupo.length}</div>
                {delGrupo.map((u) => (
                  <div key={u.id} className={`usuario-fila ${u.activo ? '' : 'card--off'}`}>
                    <div className="usuario-fila-info">
                      <strong>
                        {u.nombre}{' '}
                        {!u.activo && <span className="chip chip--warn">Inactivo</span>}
                      </strong>
                      {u.rol !== 'admin' && (
                        <small className="muted">
                          {u.ubicacion_ids.length === 0 ? 'Sin ubicación' : u.ubicacion_ids.map(nombreUbic).join(', ')}
                        </small>
                      )}
                    </div>
                    <div className="usuario-acciones">
                      <button className="btn btn-secondary btn-sm" onClick={() => editar(u)}>Editar</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void resetPin(u)}>PIN</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => void alternarActivo(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button>
                      {u.id !== usuario?.id && (
                        <button className="btn btn-ghost btn-sm btn-peligro" onClick={() => void eliminar(u)}>Eliminar</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </CollapsibleSection>
      )}
    </div>
  );
}
