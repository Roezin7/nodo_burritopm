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

const capturas = [
  { clave: 'compras', label: 'Compras', numero: 1 },
  { clave: 'produccion', label: 'Producción', numero: 2 },
  { clave: 'ventas', label: 'Ventas', numero: 3 },
] as const;

const proceso = [
  { clave: 'despacho', label: 'Despacho', numero: 4 },
  { clave: 'reparto', label: 'Reparto', numero: 5 },
  { clave: 'inventario', label: 'Inventario', numero: 6 },
  { clave: 'cierre', label: 'Cierre', numero: 7 },
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
  const { repartoHabilitado, cargando: cargandoConfig } = useOperacionConfig();
  const { paso } = useParams();
  const { semana, seleccionarSemana: cambiarSemana, rutaSemana } = useSemanaGlobal();
  if (!usuario) return null;
  if (cargandoConfig) return <Spinner />;
  if (paso === 'reparto' && !repartoHabilitado) {
    const destino = usuario.rol === 'encargado_sucursal' ? '/semana/recepcion' : '/semana/despacho';
    return <Navigate to={rutaSemana(destino)} replace />;
  }

  const procesoVisible = proceso
    .filter((p) => p.clave !== 'reparto' || repartoHabilitado)
    .map((p, i) => ({ ...p, numero: i + capturas.length + 1 }));

  if (usuario.rol === 'admin') {
    if (paso === 'pedidos') return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    if (paso === 'preparacion') return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    if (paso === 'seguimiento') return <Navigate to={rutaSemana('/semana/despacho')} replace />;
    if (paso === 'recepcion') return <div className="page weekly-operation weekly-operation--simple">
      <header className="weekly-operation__head weekly-operation__head--simple"><div><span className="eyebrow">Control excepcional</span><h1>Auditoría de faltantes</h1></div></header>
      <WeekPicker semana={semana} onChange={cambiarSemana} />
      <div className="weekly-operation__content"><Recepcion integrado semana={semana} /></div>
    </div>;
    const actual = (paso ?? 'compras') as PasoAdmin;
    const todos = [...capturas, ...procesoVisible];
    if (!todos.some((p) => p.clave === actual)) return <Navigate to={rutaSemana('/semana/compras')} replace />;
    return <div className="page weekly-operation weekly-operation--simple">
      <WeekPicker semana={semana} onChange={cambiarSemana} />

      <nav className="capture-tabs weekly-flow-tabs" aria-label="Flujo semanal">
        {todos.map((p) => <NavLink key={p.clave} to={rutaSemana(`/semana/${p.clave}`)} className={p.clave === actual ? 'is-active' : ''}><span>{p.numero}</span><strong>{p.label}</strong></NavLink>)}
      </nav>

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

  return <div className="page weekly-operation weekly-operation--simple">
    <header className="weekly-operation__head weekly-operation__head--simple"><div><span className="eyebrow">Operación semanal</span><h1>Trabajo del día</h1></div></header>
    <WeekPicker semana={semana} onChange={cambiarSemana} />
    <nav className="capture-tabs capture-tabs--role" aria-label="Trabajo disponible">
      {permitidos.map((p, i) => <NavLink key={p.clave} to={rutaSemana(`/semana/${p.clave}`)} className={p.clave === actual ? 'is-active' : ''}><span>{i + 1}</span><strong>{p.label}</strong></NavLink>)}
    </nav>
    <div className="weekly-operation__content">
      {actual === 'ventas' && <Pedidos integrado semana={semana} />}
      {actual === 'despacho' && <Bodega integrado semana={semana} />}
      {actual === 'reparto' && <Ruta integrado semana={semana} />}
      {actual === 'recepcion' && <Recepcion integrado semana={semana} />}
      {actual === 'inventario' && <InventarioOperacion integrado semana={semana} />}
    </div>
  </div>;
}
