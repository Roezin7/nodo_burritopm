import { useEffect, useState } from 'react';
import { useToast, mensajeError } from '../toast';
import { activarAvisos, esIOS, esStandalone, permisoConcedido, pushSoportado, sincronizarAvisosExistentes } from '../push';
import { Icono } from '../icons';

/** Tarjeta para activar los avisos (web push) en este dispositivo. Se puede cerrar. */
export default function ActivarAvisos() {
  const toast = useToast();
  const [cerrado, setCerrado] = useState(() => localStorage.getItem('bpm-avisos-cerrado') === '1');
  const [oculto, setOculto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [suscrito, setSuscrito] = useState<boolean | null>(null);

  useEffect(() => {
    let vigente = true;
    if (!pushSoportado()) { setSuscrito(false); return () => { vigente = false; }; }
    void sincronizarAvisosExistentes()
      .then((registrado) => { if (vigente) setSuscrito(registrado); })
      .catch(() => { if (vigente) setSuscrito(false); });
    return () => { vigente = false; };
  }, []);

  if (!pushSoportado() || suscrito === true || cerrado || oculto) return null;
  const iosSinInstalar = esIOS() && !esStandalone();

  function cerrar() {
    try { localStorage.setItem('bpm-avisos-cerrado', '1'); } catch { /* ignore */ }
    setCerrado(true);
  }

  async function activar() {
    setBusy(true);
    try {
      await activarAvisos();
      toast.ok('Avisos activados ✅');
      setOculto(true);
    } catch (e) {
      toast.error(mensajeError(e, 'No se pudieron activar los avisos.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="avisos-card">
      <span className="avisos-icono"><Icono name="bell" size={22} /></span>
      <div className="avisos-text">
        <strong>Activa los avisos</strong>
        <small className="muted">
          {iosSinInstalar
            ? 'En iPhone: Compartir → Agregar a inicio, y abre la app desde ahí.'
            : 'Te avisamos cuando toque pedido o llegue una entrega.'}
        </small>
      </div>
      {!iosSinInstalar && (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void activar()}>
          {busy ? '…' : permisoConcedido() ? 'Reactivar' : 'Activar'}
        </button>
      )}
      <button className="toast-x" onClick={cerrar} aria-label="Cerrar"><Icono name="x" size={17} /></button>
    </div>
  );
}
