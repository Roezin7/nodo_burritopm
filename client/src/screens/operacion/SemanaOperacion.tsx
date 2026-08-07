import { Navigate, NavLink, useParams } from 'react-router-dom';
import { lazy } from 'react';
import { useAuth, type Rol } from '../../auth';
import WeekPicker from '../../components/WeekPicker';
import { useSemanaGlobal } from '../../semana-context';

// La operación semanal es grande. Cada área se descarga solo al abrirla para que capturar
// pedidos no cargue módulos administrativos innecesarios.
const Pedidos = lazy(() => import('./Pedidos'));
const OperacionAdmin = lazy(() => import('./OperacionAdmin'));
const InventarioOperacion = lazy(() => import('./InventarioOperacion'));

const operacionDiaria = [
  { clave: 'ventas', label: 'Pedidos' },
] as const;

const controlSemanal = [
  { clave: 'compras', label: 'Compras' },
  { clave: 'produccion', label: 'Producción' },
  { clave: 'inventario', label: 'Inventario' },
  { clave: 'cierre', label: 'Cierre' },
] as const;

const tareasPorRol = [
  { clave: 'ventas', label: 'Pedidos', roles: ['encargado_sucursal'] },
  { clave: 'inventario', label: 'Inventario', roles: ['encargado_bodega'] },
] as const;

type AreaAdmin = (typeof operacionDiaria)[number]['clave'] | (typeof controlSemanal)[number]['clave'];
type Tarea = (typeof tareasPorRol)[number]['clave'];

function CadenciaSemanal({ actual, semana, rutaSemana }: { actual: AreaAdmin; semana: ReturnType<typeof useSemanaGlobal>['semana']; rutaSemana: (ruta: string) => string }) {
  const fechaChicago = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const diaChicago = new Date(`${fechaChicago}T12:00:00`).getDay();
  const esSabadoActual = semana.actual && diaChicago === 6;
  const esOperacion = operacionDiaria.some((item) => item.clave === actual);

  return <section className="weekly-cadence" aria-labelledby="weekly-cadence-title">
    <div className="weekly-cadence__message">
      <span className="eyebrow">Cadencia de la semana</span>
      <h1 id="weekly-cadence-title">{!semana.actual ? 'Consulta histórica' : esSabadoActual ? 'Sábado de regularización' : 'Operación diaria'}</h1>
      <p>{!semana.actual
        ? 'Estás consultando una semana anterior. Sus registros y resultados se conservan sin cambios.'
        : esSabadoActual
          ? 'Continúan los pedidos; hoy también se registran compras y producción para conciliar y cerrar.'
          : 'Captura pedidos. El sistema vincula el despacho automáticamente y el inventario puede ser negativo provisionalmente hasta la regularización del sábado.'}</p>
    </div>
    <div className="weekly-cadence__groups">
      <div className={esOperacion ? 'cadence-group cadence-group--active' : 'cadence-group'}>
        <div className="cadence-group__head"><span>Durante la semana</span><strong>Operación diaria</strong></div>
        <nav aria-label="Operación diaria">
          <NavLink to={rutaSemana('/semana/ventas')} className={actual === 'ventas' ? 'is-active' : ''}>Pedidos</NavLink>
        </nav>
      </div>
      <div className={!esOperacion ? 'cadence-group cadence-group--active' : 'cadence-group'}>
        <div className="cadence-group__head"><span>Principalmente el sábado</span><strong>Regularización</strong></div>
        <nav aria-label="Regularización del sábado">
          <NavLink to={rutaSemana('/semana/compras')} className={actual === 'compras' ? 'is-active' : ''}>Compras</NavLink>
          <NavLink to={rutaSemana('/semana/produccion')} className={actual === 'produccion' ? 'is-active' : ''}>Producción</NavLink>
          <NavLink to={rutaSemana('/semana/inventario')} className={actual === 'inventario' ? 'is-active' : ''}>Conciliación</NavLink>
          <NavLink to={rutaSemana('/semana/cierre')} className={actual === 'cierre' ? 'is-active' : ''}>Cierre</NavLink>
        </nav>
      </div>
    </div>
  </section>;
}

export default function SemanaOperacion() {
  const { usuario } = useAuth();
  const { paso } = useParams();
  const { semana, seleccionarSemana: cambiarSemana, rutaSemana } = useSemanaGlobal();
  if (!usuario) return null;
  if (paso === 'despacho' || paso === 'reparto' || paso === 'seguimiento' || paso === 'recepcion') {
    return <Navigate to={rutaSemana('/semana/ventas')} replace />;
  }

  if (usuario.rol === 'admin') {
    if (paso === 'pedidos') return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    if (paso === 'preparacion') return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    const actual = (paso ?? 'ventas') as AreaAdmin;
    const todos = [...operacionDiaria, ...controlSemanal];
    if (!todos.some((p) => p.clave === actual)) return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    return <div className="page weekly-operation weekly-operation--simple">
      <WeekPicker semana={semana} onChange={cambiarSemana} />
      <CadenciaSemanal actual={actual} semana={semana} rutaSemana={rutaSemana} />

      <div className="weekly-operation__content">
        {actual === 'compras' && <OperacionAdmin seccion="compras" integrado semana={semana} />}
        {actual === 'produccion' && <OperacionAdmin seccion="produccion" integrado semana={semana} />}
        {actual === 'ventas' && <Pedidos integrado semana={semana} />}
        {actual === 'inventario' && <InventarioOperacion integrado semana={semana} />}
        {actual === 'cierre' && <OperacionAdmin seccion="cierre" integrado semana={semana} />}
      </div>
    </div>;
  }

  const permitidos = tareasPorRol.filter((p) =>
    (p.roles as readonly Rol[]).includes(usuario.rol)
    );
  const alias = paso === 'pedidos' ? 'ventas' : paso;
  const inicio = permitidos[0]?.clave ?? 'ventas';
  if (!alias || !permitidos.some((p) => p.clave === alias)) return <Navigate to={rutaSemana(`/semana/${inicio}`)} replace />;
  const actual = alias as Tarea;
  const tareasNavegacion = permitidos;

  const tituloRol = usuario.rol === 'encargado_sucursal' ? 'Pedido' : 'Operación';
  return <div className="page weekly-operation weekly-operation--simple weekly-operation--field">
    {permitidos.length > 1 && <header className="weekly-operation__head weekly-operation__head--simple"><div><span className="eyebrow">Trabajo del día</span><h1>{tituloRol}</h1></div></header>}
    <WeekPicker semana={semana} onChange={cambiarSemana} />
    {tareasNavegacion.length > 1 && <nav className="capture-tabs capture-tabs--role capture-tabs--plain" aria-label="Trabajo disponible">
      {tareasNavegacion.map((p) => <NavLink key={p.clave} to={rutaSemana(`/semana/${p.clave}`)} className={p.clave === actual ? 'is-active' : ''}><strong>{p.label}</strong></NavLink>)}
    </nav>}
    <div className="weekly-operation__content">
      {actual === 'ventas' && <Pedidos integrado semana={semana} />}
      {actual === 'inventario' && <InventarioOperacion integrado semana={semana} />}
    </div>
  </div>;
}
