import { useState } from 'react';
import { useDialog } from '../dialog';
import { Icono } from '../icons';
import { useOffline } from '../offline';
import Modal from './Modal';

function hora(fecha: number | null) {
  if (!fecha) return 'No hay cambios pendientes en este dispositivo';
  return `Última sincronización ${new Intl.DateTimeFormat('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(fecha)}`;
}

export default function SyncCenter() {
  const estado = useOffline();
  const dialog = useDialog();
  const [abierto, setAbierto] = useState(false);
  const requiereAtencion = estado.fallidos.length > 0;
  const clase = !estado.online ? 'ctx-chip--off' : requiereAtencion ? 'ctx-chip--error' : estado.sincronizando || estado.pendientes > 0 ? 'ctx-chip--sync' : 'ctx-chip--ok';
  const etiqueta = !estado.online
    ? 'Sin conexión'
    : requiereAtencion
      ? `${estado.fallidos.length} por revisar`
      : estado.sincronizando
        ? 'Sincronizando'
        : estado.pendientes > 0
          ? `${estado.pendientes} pendiente${estado.pendientes === 1 ? '' : 's'}`
          : 'Al día';

  async function descartar(id: number) {
    if (!await dialog.confirm({
      title: 'Descartar cambio guardado',
      description: 'Este cambio se quitará del dispositivo y deberá capturarse nuevamente.',
      confirmLabel: 'Descartar cambio',
      tone: 'danger',
    })) return;
    estado.descartarOperacionFallida(id);
  }

  return <>
    <button
      type="button"
      className={`ctx-chip sync-center-trigger ${clase}`}
      onClick={() => setAbierto(true)}
      aria-label={`Estado de sincronización: ${etiqueta}`}
      aria-haspopup="dialog"
    >
      <span className="dot-status" />
      <span>{etiqueta}</span>
      {(estado.pendientes > 0 || requiereAtencion) && <strong>{requiereAtencion ? estado.fallidos.length : estado.pendientes}</strong>}
    </button>

    {abierto && <Modal className="sync-center" ariaLabelledBy="sync-center-title" onClose={() => setAbierto(false)}>
      <header className="sync-center__head">
        <div><span className="eyebrow">Este dispositivo</span><h2 id="sync-center-title">Sincronización</h2></div>
        <button className="icon-btn" aria-label="Cerrar" onClick={() => setAbierto(false)}><Icono name="x" /></button>
      </header>

      <div className={`sync-center__status ${!estado.online ? 'is-offline' : requiereAtencion ? 'needs-attention' : ''}`} role="status" aria-live="polite">
        <span className="sync-center__status-icon"><Icono name={!estado.online ? 'wifiOff' : requiereAtencion ? 'alert' : estado.sincronizando ? 'refresh' : 'checks'} size={22} /></span>
        <div>
          <strong>{!estado.online ? 'Trabajando sin conexión' : requiereAtencion ? 'Hay cambios que necesitan revisión' : estado.sincronizando ? 'Enviando cambios…' : estado.pendientes > 0 ? 'Cambios listos para enviar' : 'Todo está al día'}</strong>
          <span>{!estado.online ? 'Ventas e inventarios seguros se enviarán al recuperar la conexión.' : hora(estado.ultimaSincronizacion)}</span>
        </div>
      </div>

      <div className="sync-center__metrics">
        <div><strong>{estado.pendientes}</strong><span>Cambios pendientes</span></div>
        <div><strong>{estado.fallidos.length}</strong><span>Por revisar</span></div>
      </div>

      {estado.fallidos.length > 0 && <div className="sync-center__issues">
        <h3>Cambios que necesitan atención</h3>
        {estado.fallidos.map((fallo) => <article key={fallo.id}>
          <span className="sync-center__issue-icon"><Icono name="alert" size={18} /></span>
          <div><strong>No se pudo enviar un cambio</strong><p>{fallo.error}</p><small>{new Date(fallo.ts).toLocaleString('es-MX')}</small></div>
          <div className="sync-center__issue-actions">
            {fallo.reintentable
              ? <><button className="btn btn-secondary btn-sm" onClick={() => estado.reintentarFallo(fallo.id)}>Reintentar</button><button className="btn btn-ghost btn-sm txt-danger" onClick={() => void descartar(fallo.id)}>Descartar</button></>
              : <button className="btn btn-secondary btn-sm" onClick={() => estado.descartarFallos(fallo.id)}>Entendido</button>}
          </div>
        </article>)}
      </div>}

      <footer className="sync-center__actions">
        <button className="btn btn-secondary" onClick={() => setAbierto(false)}>Cerrar</button>
        <button className="btn btn-primary" disabled={!estado.online || estado.sincronizando} onClick={() => void estado.sincronizar()}><Icono name="refresh" size={17} />{estado.sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
      </footer>
    </Modal>}
  </>;
}
