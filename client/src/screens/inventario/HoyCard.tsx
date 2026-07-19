import { fechaLarga, type Sesion } from './types';

/** Tarjeta de la sesión de inventario de hoy. `discreto` oculta el aviso grande de "abrir". */
export default function HoyCard({ sesion, esAdmin, esPedido = false, busy, onTomar, onAbrir, discreto = false }: { sesion: Sesion; esAdmin: boolean; esPedido?: boolean; busy: boolean; onTomar: () => void; onAbrir: (id: number) => void; discreto?: boolean }) {
  const c = sesion.conteo;
  const cerrado = c?.estado === 'cerrado';
  const nombre = esPedido ? 'Pedido' : 'Inventario';
  const nombreMin = nombre.toLowerCase();

  // Ya existe el inventario de hoy.
  if (c) {
    return (
      <div className={`hoy-card ${cerrado ? 'hoy-card--cerrado' : ''}`}>
        <div className="hoy-card-fecha">{nombre} de hoy · {fechaLarga(sesion.fecha)}</div>
        <p className="muted" style={{ margin: '0.2rem 0 0.8rem' }}>
          {cerrado ? (esPedido ? 'Cerrado — listo para que admin lo apruebe.' : 'Cerrado — es la foto oficial de hoy.') : `En captura · ${c.contadas}/${c.total_lineas} productos`}
        </p>
        <button className="btn btn-primary" onClick={() => onAbrir(c.id)}>
          {cerrado ? `Ver ${nombreMin}` : `Continuar ${nombreMin}`}
        </button>
      </div>
    );
  }

  // Modo discreto (bodega central): sin el aviso grande de "abrir"; solo un botón pequeño.
  if (discreto) {
    return (
      <button className="btn btn-secondary btn-sm btn-conciliar" disabled={busy} onClick={onTomar}>
        Tomar inventario para corregir cantidades
      </button>
    );
  }

  // No existe aún: se ofrece si hoy es día programado (o si es admin, que puede abrir cuando sea).
  if (sesion.programado || esAdmin) {
    return (
      <div className="hoy-card">
        <div className="hoy-card-fecha">{sesion.programado ? `Hoy toca ${nombreMin}` : `Abrir ${nombreMin}`} · {fechaLarga(sesion.fecha)}</div>
        <p className="muted" style={{ margin: '0.2rem 0 0.8rem' }}>
          {sesion.programado ? 'El espacio de hoy está habilitado.' : `Hoy no es día programado, pero puedes abrir ${esPedido ? 'un pedido' : 'un inventario'} como admin.`}
        </p>
        <button className="btn btn-primary" disabled={busy} onClick={onTomar}>
          {esPedido ? 'Hacer pedido de hoy' : 'Tomar inventario de hoy'}
        </button>
      </div>
    );
  }

  // No programado y no admin: solo informativo.
  return (
    <div className="card">
      <strong>{esPedido ? 'Hoy no es día de pedido' : 'Hoy no es día de inventario'}</strong>
      <p className="muted" style={{ margin: '0.3rem 0 0' }}>
        {sesion.proximo ? <>Próximo {nombreMin}: <strong className="inv-fecha-titulo">{fechaLarga(sesion.proximo)}</strong>.</> : `Aún no hay días de ${nombreMin} configurados.`}
      </p>
    </div>
  );
}
