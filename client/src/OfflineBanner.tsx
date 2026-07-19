import { useEffect, useState } from 'react';
import { suscribir, sincronizar, descartarFallos, reintentarFallo, descartarOperacionFallida, type FalloSync } from './offline';

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pendientes, setPendientes] = useState(0);
  const [fallidos, setFallidos] = useState<FalloSync[]>([]);

  useEffect(() => suscribir((e) => { setOnline(e.online); setPendientes(e.pendientes); setFallidos(e.fallidos); }), []);

  // Nada que mostrar: en línea, sin cola y sin fallos.
  if (online && pendientes === 0 && fallidos.length === 0) return null;

  return (
    <>
      {(!online || pendientes > 0) && (
        <div className={`offline-banner ${online ? 'offline-banner--sync' : 'offline-banner--off'}`}>
          {!online && <span>Sin conexión — ventas y conteos pueden quedar pendientes; las demás acciones requieren reconectar.</span>}
          {online && pendientes > 0 && (
            <span onClick={() => void sincronizar()}>
              🔄 {fallidos.some((fallo) => fallo.reintentable) ? `${pendientes} cambio${pendientes !== 1 ? 's' : ''} pendiente${pendientes !== 1 ? 's' : ''} de revisión` : `Sincronizando ${pendientes} cambio${pendientes !== 1 ? 's' : ''}…`}
            </span>
          )}
          {pendientes > 0 && <strong className="offline-pill">{pendientes}</strong>}
        </div>
      )}
      {fallidos.map((f) => (
        <div key={f.id} className="offline-banner offline-banner--error">
          <span>⚠️ {f.error}</span>
          {f.reintentable ? <>
            <button className="offline-pill" onClick={() => reintentarFallo(f.id)} style={{ border: 'none', cursor: 'pointer' }}>Reintentar</button>
            <button className="offline-pill" onClick={() => descartarOperacionFallida(f.id)} style={{ border: 'none', cursor: 'pointer' }}>Descartar</button>
          </> : <button className="offline-pill" onClick={() => descartarFallos(f.id)} style={{ border: 'none', cursor: 'pointer' }}>Entendido</button>}
        </div>
      ))}
    </>
  );
}
