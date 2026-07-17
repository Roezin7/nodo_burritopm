import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useAuth, type Rol } from '../../auth';
import Pedidos from './Pedidos';
import OperacionAdmin from './OperacionAdmin';
import InventarioOperacion from './InventarioOperacion';
import SeguimientoSemana from './SeguimientoSemana';
import Bodega from '../bodega/Bodega';
import Ruta from '../ruta/Ruta';
import Recepcion from '../recepcion/Recepcion';

const capturas = [
  { clave: 'compras', label: 'Compras', numero: 1 },
  { clave: 'produccion', label: 'Producción', numero: 2 },
  { clave: 'ventas', label: 'Ventas', numero: 3 },
] as const;

const tareasPorRol = [
  { clave: 'ventas', label: 'Ventas', roles: ['encargado_sucursal'] },
  { clave: 'despacho', label: 'Despacho', roles: ['encargado_bodega'] },
  { clave: 'reparto', label: 'Reparto', roles: ['encargado_bodega'] },
  { clave: 'recepcion', label: 'Recepción', roles: ['encargado_sucursal'] },
  { clave: 'inventario', label: 'Inventario', roles: ['encargado_bodega'] },
] as const;

type Captura = (typeof capturas)[number]['clave'];
type Tarea = (typeof tareasPorRol)[number]['clave'];
const pasosAutomaticos = new Set(['preparacion', 'despacho', 'reparto', 'recepcion', 'inventario', 'cierre']);

export default function SemanaOperacion() {
  const { usuario } = useAuth();
  const { paso } = useParams();
  if (!usuario) return null;

  if (usuario.rol === 'admin') {
    if (paso === 'pedidos') return <Navigate to="/semana/ventas" replace />;
    if (paso && pasosAutomaticos.has(paso)) return <Navigate to="/semana/seguimiento" replace />;
    const actual = (paso ?? 'compras') as Captura | 'seguimiento';
    if (![...capturas.map((p) => p.clave), 'seguimiento'].includes(actual)) return <Navigate to="/semana/compras" replace />;
    const enCaptura = actual !== 'seguimiento';

    return <div className="page weekly-operation weekly-operation--simple">
      <header className="weekly-operation__head weekly-operation__head--simple">
        <div><span className="eyebrow">Operación semanal</span><h1>{enCaptura ? 'Captura' : 'Seguimiento'}</h1></div>
        <nav className="weekly-mode-tabs" aria-label="Tipo de vista">
          <NavLink to="/semana/compras" className={enCaptura ? 'is-active' : ''}>Captura</NavLink>
          <NavLink to="/semana/seguimiento" className={!enCaptura ? 'is-active' : ''}>Seguimiento</NavLink>
        </nav>
      </header>

      {enCaptura && <nav className="capture-tabs" aria-label="Datos que se capturan">
        {capturas.map((p) => <NavLink key={p.clave} to={`/semana/${p.clave}`} className={p.clave === actual ? 'is-active' : ''}><span>{p.numero}</span><strong>{p.label}</strong></NavLink>)}
      </nav>}

      <div className="weekly-operation__content">
        {actual === 'compras' && <OperacionAdmin seccion="compras" integrado />}
        {actual === 'produccion' && <OperacionAdmin seccion="produccion" integrado />}
        {actual === 'ventas' && <Pedidos integrado />}
        {actual === 'seguimiento' && <SeguimientoSemana />}
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
