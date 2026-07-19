import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { UbicacionAsignada } from '../../auth';
import CollapsibleSection from '../../components/CollapsibleSection';
import { usd, type ValuacionResp } from './types';

/** Lista compacta de sucursales con su dinero en inventario; tocar una abre su detalle. */
export default function SucursalesOverview({ sucursales, onElegir }: { sucursales: UbicacionAsignada[]; onElegir: (id: string) => void }) {
  const [val, setVal] = useState<ValuacionResp | null>(null);
  useEffect(() => { api<ValuacionResp>('/existencias/valuacion').then(setVal).catch(() => {}); }, []);
  const valorDe = new Map((val?.ubicaciones ?? []).map((u) => [u.id, u]));
  const lista = [...sucursales].sort((a, b) => (valorDe.get(b.id)?.valor ?? 0) - (valorDe.get(a.id)?.valor ?? 0));

  return (
    <CollapsibleSection title="Sucursales" count={lista.length}><div className="lista-ubicaciones">
      {lista.length === 0 ? (
        <p className="muted">No hay sucursales activas.</p>
      ) : (
        lista.map((s) => {
          const v = valorDe.get(s.id);
          return (
            <button key={s.id} className="card card-click suc-row" onClick={() => onElegir(String(s.id))}>
              <span className="suc-row-name"><strong>{s.nombre}</strong>{v && <small className="muted"> · {v.skus} prod.</small>}</span>
              <span className="suc-row-val">{v ? usd(v.valor) : '—'}</span>
            </button>
          );
        })
      )}
    </div></CollapsibleSection>
  );
}
