import { Navigate, NavLink, useParams } from 'react-router-dom';
import Pedidos from './Pedidos';
import OperacionAdmin from './OperacionAdmin';
import InventarioOperacion from './InventarioOperacion';

const pasos = [
  { clave: 'pedidos', label: 'Pedidos' },
  { clave: 'compras', label: 'Compras' },
  { clave: 'produccion', label: 'Producción' },
  { clave: 'inventario', label: 'Inventario' },
  { clave: 'cierre', label: 'Cierre' },
] as const;

type Paso = (typeof pasos)[number]['clave'];

export default function SemanaOperacion() {
  const { paso = 'pedidos' } = useParams();
  if (!pasos.some((p) => p.clave === paso)) return <Navigate to="/semana/pedidos" replace />;
  const actual = paso as Paso;
  const indice = pasos.findIndex((p) => p.clave === actual);
  const siguiente = pasos[indice + 1];

  return <div className="page weekly-operation">
    <header className="weekly-operation__head">
      <div><span className="eyebrow">Operación semanal</span><h1>Semana</h1></div>
      <nav className="weekly-steps" aria-label="Flujo semanal">
        {pasos.map((p, i) => <NavLink key={p.clave} to={`/semana/${p.clave}`} className={p.clave === actual ? 'is-active' : ''}><span>{i + 1}</span>{p.label}</NavLink>)}
      </nav>
    </header>

    <div className="weekly-operation__content">
      {actual === 'pedidos' && <Pedidos integrado />}
      {actual === 'compras' && <OperacionAdmin seccion="compras" integrado />}
      {actual === 'produccion' && <OperacionAdmin seccion="produccion" integrado />}
      {actual === 'inventario' && <InventarioOperacion integrado />}
      {actual === 'cierre' && <OperacionAdmin seccion="cierre" integrado />}
    </div>

    {siguiente && <div className="weekly-next"><span>{indice + 1} de {pasos.length}</span><NavLink className="btn btn-primary" to={`/semana/${siguiente.clave}`}>Continuar a {siguiente.label} →</NavLink></div>}
  </div>;
}
