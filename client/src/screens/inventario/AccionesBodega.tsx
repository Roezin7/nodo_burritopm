import { Icono } from '../../icons';

/** Tres acciones claras de inventario central: entrada, salida y conteo físico. */
export default function AccionesBodega({ busy, entradaAbierta, salidaAbierta, onToggleEntrada, onToggleSalida, onTomarInventario }: {
  busy: boolean; entradaAbierta: boolean; salidaAbierta: boolean;
  onToggleEntrada: () => void; onToggleSalida: () => void; onTomarInventario: () => void;
}) {
  return (
    <div className="acciones-bodega">
      <button type="button" className={`accion-tile ${entradaAbierta ? 'accion-tile--on' : ''}`} onClick={onToggleEntrada}>
        <span className="accion-ico accion-ico--in" aria-hidden="true">＋</span>
        <span className="accion-tx">
          <strong>Registrar entrada</strong>
          <small>Llegó mercancía o compra. Suma al stock.</small>
        </span>
      </button>
      <button type="button" className={`accion-tile ${salidaAbierta ? 'accion-tile--on' : ''}`} onClick={onToggleSalida}>
        <span className="accion-ico accion-ico--out" aria-hidden="true">−</span>
        <span className="accion-tx">
          <strong>Registrar salida</strong>
          <small>Salió producto sin pedido regular. Resta del stock.</small>
        </span>
      </button>
      <button type="button" className="accion-tile" disabled={busy} onClick={onTomarInventario}>
        <span className="accion-ico accion-ico--count" aria-hidden="true"><Icono name="clipboard" size={20} /></span>
        <span className="accion-tx">
          <strong>Contar inventario</strong>
          <small>Conteo físico completo para fijar las cantidades exactas.</small>
        </span>
      </button>
    </div>
  );
}
