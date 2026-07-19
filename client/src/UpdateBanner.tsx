import { useEffect, useState } from 'react';
import { aplicarActualizacionPWA, suscribirActualizacionPWA } from './pwaUpdate';

export default function UpdateBanner() {
  const [disponible, setDisponible] = useState(false);
  useEffect(() => suscribirActualizacionPWA(setDisponible), []);

  if (!disponible) return null;
  return (
    <div className="offline-banner offline-banner--sync">
      <span>🆕 Hay una nueva versión de la app.</span>
      <button className="offline-pill" style={{ border: 'none', cursor: 'pointer' }} onClick={aplicarActualizacionPWA}>
        Actualizar
      </button>
    </div>
  );
}
