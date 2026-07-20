import { Icono } from './icons';
import { useOffline } from './offline';

export default function OfflineBanner() {
  const { online, pendientes, sincronizando } = useOffline();

  if (online && pendientes === 0) return null;

  return <div className={`offline-banner ${online ? 'offline-banner--sync' : 'offline-banner--off'}`} role="status" aria-live="polite">
    <Icono name={online ? 'refresh' : 'wifiOff'} size={18} />
    <span>{online
      ? sincronizando ? `Enviando ${pendientes} cambio${pendientes === 1 ? '' : 's'} guardado${pendientes === 1 ? '' : 's'}…` : `${pendientes} cambio${pendientes === 1 ? '' : 's'} listo${pendientes === 1 ? '' : 's'} para sincronizar`
      : 'Sin conexión. Puedes seguir capturando ventas e inventarios; se enviarán al reconectar.'}</span>
    {pendientes > 0 && <strong className="offline-pill">{pendientes}</strong>}
  </div>;
}
