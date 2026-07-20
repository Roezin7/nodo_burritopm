import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import CollapsibleSection from '../../components/CollapsibleSection';

interface Incidencia {
  id: number;
  tipo: string;
  prioridad: string;
  estado: string;
  ubicacion: string | null;
  producto: string | null;
  documento_tipo: string | null;
  documento_id: number | null;
  comentarios: string | null;
  creado_at: string;
}

export default function Incidencias() {
  const [lista, setLista] = useState<Incidencia[]>([]);
  const [estado, setEstado] = useState<'abierta' | 'todas'>('abierta');
  const [error, setError] = useState('');

  async function cargar() {
    setError('');
    try { setLista(await api<Incidencia[]>(`/incidencias?estado=${estado}`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error al cargar'); }
  }
  useEffect(() => { void cargar(); }, [estado]);

  async function resolver(i: Incidencia) {
    const comentario = window.prompt('Resolución (opcional):') ?? undefined;
    try { await api(`/incidencias/${i.id}/resolver`, { method: 'POST', body: { comentario } }); await cargar(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error'); }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Incidencias</h1></div>
      </header>
      <div className="tabs">
        <button className={estado === 'abierta' ? 'tab tab--on' : 'tab'} onClick={() => setEstado('abierta')}>Abiertas</button>
        <button className={estado === 'todas' ? 'tab tab--on' : 'tab'} onClick={() => setEstado('todas')}>Todas</button>
      </div>
      {error && <p className="error-msg">{error}</p>}
      {lista.length === 0 ? (
        <div className="empty-state empty-state--card"><strong>{estado === 'abierta' ? 'Todo está en orden' : 'Sin incidencias registradas'}</strong><span>{estado === 'abierta' ? 'Las diferencias de entrega o inventario aparecerán aquí para darles seguimiento.' : 'No hay resultados en el historial.'}</span></div>
      ) : (
        <CollapsibleSection title={estado === 'abierta' ? 'Incidencias abiertas' : 'Historial de incidencias'} count={lista.length}><div className="lista-ubicaciones">
          {lista.map((i) => (
            <div key={i.id} className={`card ${i.estado === 'abierta' ? 'card--falt' : ''}`}>
              <div className="ubic-row">
                <div>
                  <strong>{i.tipo.replace(/_/g, ' ')}</strong>{' '}
                  <span className={`chip ${i.estado === 'abierta' ? 'chip--warn' : 'chip--ok'}`}>{i.estado}</span>
                  <div className="muted">
                    {[i.producto, i.ubicacion].filter(Boolean).join(' · ')}
                    {i.documento_id ? ` · ${i.documento_tipo} #${i.documento_id}` : ''}
                  </div>
                  {i.comentarios && <div className="muted">{i.comentarios}</div>}
                </div>
                {i.estado === 'abierta' && (
                  <div className="form-actions">
                    <button className="btn btn-secondary" onClick={() => void resolver(i)}>Resolver</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div></CollapsibleSection>
      )}
    </div>
  );
}
