import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { useAuth, type UbicacionAsignada } from '../../auth';
import { EstadoDistChip, FlujoStepper } from '../../flujo';

interface LineaRec {
  linea_id: number;
  product_id: number;
  nombre: string;
  unidad: string;
  esperado: number;
  recibida: number | null;
  estado_linea: string | null;
}
interface DistRec { id: number; estado: string; creado_at: string; lineas: LineaRec[] }

export default function Recepcion() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const [ubicaciones, setUbicaciones] = useState<UbicacionAsignada[]>([]);
  const [ubicId, setUbicId] = useState('');
  const [dists, setDists] = useState<DistRec[]>([]);
  const [recibido, setRecibido] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function cargarUbic() {
      if (esAdmin) {
        const us = await api<{ id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }[]>('/ubicaciones');
        const suc = us.filter((u) => u.activo && u.tipo === 'sucursal').map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, activo: u.activo }));
        setUbicaciones(suc);
        if (suc[0]) setUbicId(String(suc[0].id));
      } else {
        const suc = (usuario?.ubicaciones ?? []).filter((u) => u.tipo === 'sucursal');
        setUbicaciones(suc);
        if (suc[0]) setUbicId(String(suc[0].id));
      }
    }
    void cargarUbic();
  }, [esAdmin, usuario]);

  async function cargar() {
    if (!ubicId) return;
    setError('');
    try { setDists(await api<DistRec[]>(`/distribuciones/recepciones?ubicacion=${ubicId}`)); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Error al cargar'); }
  }
  useEffect(() => { void cargar(); }, [ubicId]);

  async function recibir(d: DistRec) {
    if (!window.confirm('Confirmar la recepción. Las diferencias generarán una incidencia. ¿Continuar?')) return;
    setBusy(true); setError('');
    try {
      const items = d.lineas
        .filter((l) => l.recibida == null)
        .map((l) => ({ linea_id: l.linea_id, cantidad: Number(recibido[l.linea_id] ?? l.esperado) || 0 }));
      await api(`/distribuciones/${d.id}/recibir`, { method: 'POST', body: { ubicacion_id: Number(ubicId), items } });
      setRecibido({});
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al recibir');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page conteo-page">
      <header className="page-head">
        <div><h1>Recepción 📥</h1><p className="page-sub">Confirma lo que llega del camión.</p></div>
      </header>
      <FlujoStepper activo="recepcion" />

      {ubicaciones.length === 0 ? (
        <p className="muted">No tienes una sucursal asignada.</p>
      ) : (
        <>
          {ubicaciones.length > 1 && (
            <label className="so-ubic">Sucursal
              <select value={ubicId} onChange={(e) => setUbicId(e.target.value)}>
                {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </label>
          )}
          {error && <p className="error-msg">{error}</p>}
          {dists.length === 0 ? (
            <p className="muted">No hay entregas en tránsito para esta sucursal.</p>
          ) : (
            dists.map((d) => (
              <div key={d.id} className="card">
                <div className="card-head"><strong>Distribución #{d.id}</strong> <EstadoDistChip estado={d.estado} /></div>
                {d.lineas.map((l) => (
                  <div key={l.linea_id} className="dist-row">
                    <div className="conteo-prod">
                      <strong>{l.nombre}</strong>
                      <small className="muted">{l.unidad} · esperado {l.esperado}{l.recibida != null ? ` · recibido ${l.recibida}` : ''}</small>
                    </div>
                    {l.recibida == null ? (
                      <input className="conteo-input2 dist-input" inputMode="decimal"
                        value={recibido[l.linea_id] ?? String(l.esperado)}
                        onChange={(e) => setRecibido({ ...recibido, [l.linea_id]: e.target.value })} />
                    ) : (
                      <span className="dist-aprob">{l.recibida}</span>
                    )}
                  </div>
                ))}
                {d.lineas.some((l) => l.recibida == null) && (
                  <div className="form-actions">
                    <button className="btn btn-primary" disabled={busy} onClick={() => void recibir(d)}>Confirmar recepción</button>
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
