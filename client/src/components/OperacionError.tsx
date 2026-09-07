import { Link } from 'react-router-dom';

/** Error operativo con un enlace directo al módulo que puede resolverlo. */
export default function OperacionError({ mensaje, semana }: { mensaje: string; semana: string }) {
  const esFaltanteFifo = mensaje.includes('FIFO') && mensaje.includes('faltan');
  const esDespachoPendiente = mensaje.includes('despacho(s) pendiente(s)');
  return (
    <div className="error-msg error-msg--action" role="alert">
      <span>{mensaje}</span>
      {esFaltanteFifo && (
        <div className="error-msg__actions">
          <Link className="error-msg__link" to={`/semana/compras?semana=${semana}`}>Registrar o editar compra →</Link>
          <Link className="error-msg__link error-msg__link--secondary" to={`/semana/entregas?semana=${semana}`}>Ajustar despacho →</Link>
        </div>
      )}
      {esDespachoPendiente && !esFaltanteFifo && (
        <div className="error-msg__actions">
          <Link className="error-msg__link" to={`/semana/entregas?semana=${semana}`}>Abrir despachos →</Link>
        </div>
      )}
    </div>
  );
}
