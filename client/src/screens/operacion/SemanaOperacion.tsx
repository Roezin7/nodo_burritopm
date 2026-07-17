import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useAuth, type Rol } from '../../auth';
import Pedidos from './Pedidos';
import OperacionAdmin from './OperacionAdmin';
import InventarioOperacion from './InventarioOperacion';
import Distribucion from '../distribucion/Distribucion';
import Bodega from '../bodega/Bodega';
import Ruta from '../ruta/Ruta';
import Recepcion from '../recepcion/Recepcion';

const capturas = [
  { clave: 'compras', label: 'Compras', numero: 1 },
  { clave: 'produccion', label: 'Producción', numero: 2 },
  { clave: 'ventas', label: 'Ventas', numero: 3 },
] as const;

const proceso = [
  { clave: 'preparacion', label: 'Preparación', numero: 4 },
  { clave: 'despacho', label: 'Despacho', numero: 5 },
  { clave: 'reparto', label: 'Reparto', numero: 6 },
  { clave: 'recepcion', label: 'Recepción', numero: 7 },
  { clave: 'inventario', label: 'Inventario', numero: 8 },
  { clave: 'cierre', label: 'Cierre', numero: 9 },
] as const;

const tareasPorRol = [
  { clave: 'ventas', label: 'Ventas', roles: ['encargado_sucursal'] },
  { clave: 'despacho', label: 'Despacho', roles: ['encargado_bodega'] },
  { clave: 'reparto', label: 'Reparto', roles: ['encargado_bodega'] },
  { clave: 'recepcion', label: 'Recepción', roles: ['encargado_sucursal'] },
  { clave: 'inventario', label: 'Inventario', roles: ['encargado_bodega'] },
] as const;

type PasoAdmin = (typeof capturas)[number]['clave'] | (typeof proceso)[number]['clave'];
type Tarea = (typeof tareasPorRol)[number]['clave'];

export default function SemanaOperacion() {
  const { usuario } = useAuth();
  const { paso } = useParams();
  if (!usuario) return null;

  if (usuario.rol === 'admin') {
    if (paso === 'pedidos') return <Navigate to="/semana/ventas" replace />;
    if (paso === 'seguimiento') return <Navigate to="/semana/preparacion" replace />;
    const actual = (paso ?? 'compras') as PasoAdmin;
    const todos = [...capturas, ...proceso];
    if (!todos.some((p) => p.clave === actual)) return <Navigate to="/semana/compras" replace />;
    const enCaptura = capturas.some((p) => p.clave === actual);
    const pestanas = enCaptura ? capturas : proceso;

    return <div className="page weekly-operation weekly-operation--simple">
      <header className="weekly-operation__head weekly-operation__head--simple">
        <div><span className="eyebrow">Operación semanal</span><h1>{enCaptura ? 'Captura' : 'Proceso'}</h1></div>
        <nav className="weekly-mode-tabs" aria-label="Grupo de operación">
          <NavLink to="/semana/compras" className={enCaptura ? 'is-active' : ''}>Captura</NavLink>
          <NavLink to="/semana/preparacion" className={!enCaptura ? 'is-active' : ''}>Proceso</NavLink>
        </nav>
      </header>

      <nav className={`capture-tabs ${enCaptura ? '' : 'process-tabs'}`} aria-label={enCaptura ? 'Datos que se capturan' : 'Proceso operativo'}>
        {pestanas.map((p) => <NavLink key={p.clave} to={`/semana/${p.clave}`} className={p.clave === actual ? 'is-active' : ''}><span>{p.numero}</span><strong>{p.label}</strong></NavLink>)}
      </nav>

      <div className="weekly-operation__content">
        {actual === 'compras' && <OperacionAdmin seccion="compras" integrado />}
        {actual === 'produccion' && <OperacionAdmin seccion="produccion" integrado />}
        {actual === 'ventas' && <Pedidos integrado />}
        {actual === 'preparacion' && <Distribucion integrado />}
        {actual === 'despacho' && <Bodega integrado />}
        {actual === 'reparto' && <Ruta integrado />}
        {actual === 'recepcion' && <Recepcion integrado />}
        {actual === 'inventario' && <InventarioOperacion integrado />}
        {actual === 'cierre' && <OperacionAdmin seccion="cierre" integrado />}
      </div>
    </div>;
  }

  const permitidos = tareasPorRol.filter((p) => (p.roles as readonly Rol[]).includes(usuario.rol));
  const alias = paso === 'pedidos' ? 'ventas' : paso;
  const inicio = permitidos[0]?.clave ?? 'ventas';
  if (!alias || !permitidos.some((p) => p.clave === alias)) return <Navigate to={`/semana/${inicio}`} replace />;
  const actual = alias as Tarea;

  return <div className="page weekly-operation weekly-operation--simple">
    <header className="weekly-operation__head weekly-operation__head--simple"><div><span className="eyebrow">Operación semanal</span><h1>Trabajo del día</h1></div></header>
    <nav className="capture-tabs capture-tabs--role" aria-label="Trabajo disponible">
      {permitidos.map((p, i) => <NavLink key={p.clave} to={`/semana/${p.clave}`} className={p.clave === actual ? 'is-active' : ''}><span>{i + 1}</span><strong>{p.label}</strong></NavLink>)}
    </nav>
    <div className="weekly-operation__content">
      {actual === 'ventas' && <Pedidos integrado />}
      {actual === 'despacho' && <Bodega integrado />}
      {actual === 'reparto' && <Ruta integrado />}
      {actual === 'recepcion' && <Recepcion integrado />}
      {actual === 'inventario' && <InventarioOperacion integrado />}
    </div>
  </div>;
}
