import { useEffect, useState } from 'react';
import { suscribir, sincronizar, descartarFallos, type FalloSync } from './offline';

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
          {!online && <span>Sin conexión — tus cambios se guardan y se sincronizan al reconectar.</span>}
          {online && pendientes > 0 && (
            <span onClick={() => void sincronizar()}>
              🔄 Sincronizando {pendientes} cambio{pendientes !== 1 ? 's' : ''}…
            </span>
          )}
          {pendientes > 0 && <strong className="offline-pill">{pendientes}</strong>}
        </div>
      )}
      {fallidos.length > 0 && (
        <div className="offline-banner offline-banner--error">
          <span>
            ⚠️ {fallidos.length} cambio{fallidos.length !== 1 ? 's' : ''} no se guardó: {fallidos[fallidos.length - 1]!.error}. Revísalo y vuelve a capturarlo.
          </span>
          <button className="offline-pill" onClick={descartarFallos} style={{ border: 'none', cursor: 'pointer' }}>Entendido</button>
        </div>
      )}
    </>
  );
}
