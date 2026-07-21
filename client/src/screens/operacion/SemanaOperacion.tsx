import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useAuth, type Rol } from '../../auth';
import Pedidos from './Pedidos';
import OperacionAdmin from './OperacionAdmin';
import InventarioOperacion from './InventarioOperacion';
import Bodega from '../bodega/Bodega';
import Ruta from '../ruta/Ruta';
import Recepcion from '../recepcion/Recepcion';
import { useOperacionConfig } from '../../operacion-config';
import Spinner from '../../components/Spinner';
import WeekPicker from '../../components/WeekPicker';
import { useSemanaGlobal } from '../../semana-context';

const operacionDiaria = [
  { clave: 'ventas', label: 'Ventas' },
  { clave: 'despacho', label: 'Despacho' },
  { clave: 'reparto', label: 'Reparto' },
] as const;

const controlSemanal = [
  { clave: 'compras', label: 'Compras' },
  { clave: 'produccion', label: 'Producción' },
  { clave: 'inventario', label: 'Inventario' },
  { clave: 'cierre', label: 'Cierre' },
] as const;

const tareasPorRol = [
  { clave: 'ventas', label: 'Ventas', roles: ['encargado_sucursal'] },
  { clave: 'despacho', label: 'Despacho', roles: ['encargado_bodega'] },
  { clave: 'reparto', label: 'Reparto', roles: ['encargado_bodega'] },
  { clave: 'recepcion', label: 'Recepción', roles: ['encargado_sucursal'] },
  { clave: 'inventario', label: 'Inventario', roles: ['encargado_bodega'] },
] as const;

type AreaAdmin = (typeof operacionDiaria)[number]['clave'] | (typeof controlSemanal)[number]['clave'];
type Tarea = (typeof tareasPorRol)[number]['clave'];

export default function SemanaOperacion() {
  const { usuario } = useAuth();
  const { repartoHabilitado, cargando: cargandoConfig } = useOperacionConfig();
  const { paso } = useParams();
  const { semana, seleccionarSemana: cambiarSemana, rutaSemana } = useSemanaGlobal();
  if (!usuario) return null;
  if (cargandoConfig) return <Spinner />;
  if (paso === 'reparto' && !repartoHabilitado) {
    const destino = usuario.rol === 'encargado_sucursal' ? '/semana/recepcion' : '/semana/despacho';
    return <Navigate to={rutaSemana(destino)} replace />;
  }

  const operacionDiariaVisible = operacionDiaria.filter((p) => p.clave !== 'reparto' || repartoHabilitado);

  if (usuario.rol === 'admin') {
    if (paso === 'pedidos') return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    if (paso === 'preparacion') return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    if (paso === 'seguimiento') return <Navigate to={rutaSemana('/semana/despacho')} replace />;
    if (paso === 'recepcion') return <div className="page weekly-operation weekly-operation--simple">
      <WeekPicker semana={semana} onChange={cambiarSemana} />
      <div className="weekly-operation__content"><Recepcion integrado semana={semana} /></div>
    </div>;
    const actual = (paso ?? 'compras') as AreaAdmin;
    const todos = [...operacionDiariaVisible, ...controlSemanal];
    if (!todos.some((p) => p.clave === actual)) return <Navigate to={rutaSemana('/semana/compras')} replace />;
    return <div className="page weekly-operation weekly-operation--simple">
      <WeekPicker semana={semana} onChange={cambiarSemana} />

      <div className="weekly-work-areas">
        <section className="weekly-work-area">
          <h2 className="weekly-work-area__label">Operación diaria</h2>
          <nav className="capture-tabs weekly-area-tabs" aria-label="Operación diaria">
            {operacionDiariaVisible.map((p) => <NavLink key={p.clave} to={rutaSemana(`/semana/${p.clave}`)} className={p.clave === actual ? 'is-active' : ''}><strong>{p.label}</strong></NavLink>)}
          </nav>
        </section>
        <section className="weekly-work-area">
          <h2 className="weekly-work-area__label">Control semanal</h2>
          <nav className="capture-tabs weekly-area-tabs" aria-label="Control semanal">
            {controlSemanal.map((p) => <NavLink key={p.clave} to={rutaSemana(`/semana/${p.clave}`)} className={p.clave === actual ? 'is-active' : ''}><strong>{p.label}</strong></NavLink>)}
          </nav>
        </section>
      </div>

      <div className="weekly-operation__content">
        {actual === 'compras' && <OperacionAdmin seccion="compras" integrado semana={semana} />}
        {actual === 'produccion' && <OperacionAdmin seccion="produccion" integrado semana={semana} />}
        {actual === 'ventas' && <Pedidos integrado semana={semana} />}
        {actual === 'despacho' && <Bodega integrado semana={semana} />}
        {actual === 'reparto' && <Ruta integrado semana={semana} />}
        {actual === 'inventario' && <InventarioOperacion integrado semana={semana} />}
        {actual === 'cierre' && <OperacionAdmin seccion="cierre" integrado semana={semana} />}
      </div>
    </div>;
  }

  const permitidos = tareasPorRol.filter((p) =>
    (p.roles as readonly Rol[]).includes(usuario.rol)
    && (p.clave !== 'reparto' || repartoHabilitado)
    && (p.clave !== 'recepcion' || repartoHabilitado));
  const alias = paso === 'pedidos' ? 'ventas' : paso;
  const inicio = permitidos[0]?.clave ?? 'ventas';
  if (!alias || !permitidos.some((p) => p.clave === alias)) return <Navigate to={rutaSemana(`/semana/${inicio}`)} replace />;
  const actual = alias as Tarea;

  const tituloRol = usuario.rol === 'encargado_sucursal' ? 'Pedido y recepción' : 'Trabajo de bodega';
  return <div className="page weekly-operation weekly-operation--simple weekly-operation--field">
    {permitidos.length > 1 && <header className="weekly-operation__head weekly-operation__head--simple"><div><span className="eyebrow">Trabajo del día</span><h1>{tituloRol}</h1></div></header>}
    <WeekPicker semana={semana} onChange={cambiarSemana} />
    {permitidos.length > 1 && <nav className="capture-tabs capture-tabs--role capture-tabs--plain" aria-label="Trabajo disponible">
      {permitidos.map((p) => <NavLink key={p.clave} to={rutaSemana(`/semana/${p.clave}`)} className={p.clave === actual ? 'is-active' : ''}><strong>{p.label}</strong></NavLink>)}
    </nav>}
    <div className="weekly-operation__content">
      {actual === 'ventas' && <Pedidos integrado semana={semana} />}
      {actual === 'despacho' && <Bodega integrado semana={semana} />}
      {actual === 'reparto' && <Ruta integrado semana={semana} />}
      {actual === 'recepcion' && <Recepcion integrado semana={semana} />}
      {actual === 'inventario' && <InventarioOperacion integrado semana={semana} />}
    </div>
  </div>;
}
