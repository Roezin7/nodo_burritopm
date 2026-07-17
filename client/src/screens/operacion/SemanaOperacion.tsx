import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useAuth, type Rol } from '../../auth';
import Pedidos from './Pedidos';
import OperacionAdmin from './OperacionAdmin';
import InventarioOperacion from './InventarioOperacion';
import Distribucion from '../distribucion/Distribucion';
import Bodega from '../bodega/Bodega';
import Ruta from '../ruta/Ruta';
import Recepcion from '../recepcion/Recepcion';

const pasos = [
  { clave: 'compras', label: 'Compras', roles: ['admin'] },
  { clave: 'produccion', label: 'Producción', roles: ['admin'] },
  { clave: 'pedidos', label: 'Pedidos', roles: ['admin', 'encargado_sucursal'] },
  { clave: 'preparacion', label: 'Preparación', roles: ['admin'] },
  { clave: 'despacho', label: 'Despacho', roles: ['admin', 'encargado_bodega'] },
  { clave: 'reparto', label: 'Reparto', roles: ['admin', 'encargado_bodega'] },
  { clave: 'recepcion', label: 'Recepción', roles: ['admin', 'encargado_sucursal'] },
  { clave: 'inventario', label: 'Inventario', roles: ['admin', 'encargado_bodega'] },
  { clave: 'cierre', label: 'Cierre', roles: ['admin'] },
] as const;

type Paso = (typeof pasos)[number]['clave'];

export default function SemanaOperacion() {
  const { usuario } = useAuth();
  const { paso } = useParams();
  const permitidos = pasos.filter((p) => usuario && (p.roles as readonly Rol[]).includes(usuario.rol));
  const inicio = permitidos[0]?.clave ?? 'pedidos';
  if (!paso || !pasos.some((p) => p.clave === paso)) return <Navigate to={`/semana/${inicio}`} replace />;
  const actual = paso as Paso;
  const permitido = permitidos.some((p) => p.clave === actual);
  if (!permitido) return <Navigate to={`/semana/${inicio}`} replace />;
  const indice = pasos.findIndex((p) => p.clave === actual);
  const siguiente = pasos.slice(indice + 1).find((p) => permitidos.some((x) => x.clave === p.clave));

  return <div className="page weekly-operation">
    <header className="weekly-operation__head">
      <div><span className="eyebrow">Operación semanal</span><h1>Semana</h1></div>
      <nav className="weekly-steps" aria-label="Flujo semanal">
        {pasos.map((p, i) => {
          const disponible = permitidos.some((x) => x.clave === p.clave);
          return disponible
            ? <NavLink key={p.clave} to={`/semana/${p.clave}`} className={p.clave === actual ? 'is-active' : ''}><span>{i + 1}</span>{p.label}</NavLink>
            : <span key={p.clave} className="weekly-step-disabled" aria-disabled="true"><i>{i + 1}</i>{p.label}</span>;
        })}
      </nav>
    </header>

    <div className="weekly-operation__content">
      {actual === 'compras' && <OperacionAdmin seccion="compras" integrado />}
      {actual === 'produccion' && <OperacionAdmin seccion="produccion" integrado />}
      {actual === 'pedidos' && <Pedidos integrado />}
      {actual === 'preparacion' && <Distribucion integrado />}
      {actual === 'despacho' && <Bodega integrado />}
      {actual === 'reparto' && <Ruta integrado />}
      {actual === 'recepcion' && <Recepcion integrado />}
      {actual === 'inventario' && <InventarioOperacion integrado />}
      {actual === 'cierre' && <OperacionAdmin seccion="cierre" integrado />}
    </div>

    {siguiente && <div className="weekly-next"><span>Paso {indice + 1} de {pasos.length}</span><NavLink className="btn btn-primary" to={`/semana/${siguiente.clave}`}>Continuar a {siguiente.label} →</NavLink></div>}
  </div>;
}
