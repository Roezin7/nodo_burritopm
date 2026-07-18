import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useAuth, type Rol } from '../../auth';
import Pedidos from './Pedidos';
import OperacionAdmin from './OperacionAdmin';
import InventarioOperacion from './InventarioOperacion';
import Bodega from '../bodega/Bodega';
import Ruta from '../ruta/Ruta';
import Recepcion from '../recepcion/Recepcion';
import { crearSemana, etiquetaRango, moverSemana, semanasAlrededor } from '../../semana';
import { useOperacionConfig } from '../../operacion-config';
import Spinner from '../../components/Spinner';
import { useSemanaGlobal } from '../../semana-context';

const capturas = [
  { clave: 'compras', label: 'Compras', numero: 1 },
  { clave: 'produccion', label: 'Producción', numero: 2 },
  { clave: 'ventas', label: 'Ventas', numero: 3 },
] as const;

const proceso = [
  { clave: 'despacho', label: 'Despacho', numero: 4 },
  { clave: 'reparto', label: 'Reparto', numero: 5 },
  { clave: 'recepcion', label: 'Recepción', numero: 6 },
  { clave: 'inventario', label: 'Inventario', numero: 7 },
  { clave: 'cierre', label: 'Cierre', numero: 8 },
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
  const opcionesSemana = semanasAlrededor(crearSemana());
  if (!usuario) return null;
  if (cargandoConfig) return <Spinner />;
  if (paso === 'reparto' && !repartoHabilitado) {
    const destino = usuario.rol === 'encargado_bodega' ? '/semana/despacho' : '/semana/recepcion';
    return <Navigate to={rutaSemana(destino)} replace />;
  }

  const procesoVisible = proceso
    .filter((p) => p.clave !== 'reparto' || repartoHabilitado)
    .map((p, i) => ({ ...p, label: usuario.rol === 'admin' && p.clave === 'recepcion' ? 'Auditoría' : p.label, numero: i + capturas.length + 1 }));

  if (usuario.rol === 'admin') {
    if (paso === 'pedidos') return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    if (paso === 'preparacion') return <Navigate to={rutaSemana('/semana/ventas')} replace />;
    if (paso === 'seguimiento') return <Navigate to={rutaSemana('/semana/despacho')} replace />;
    const actual = (paso ?? 'compras') as PasoAdmin;
    const todos = [...capturas, ...procesoVisible];
    if (!todos.some((p) => p.clave === actual)) return <Navigate to={rutaSemana('/semana/compras')} replace />;
    const enCaptura = capturas.some((p) => p.clave === actual);
    const pestanas = enCaptura ? capturas : procesoVisible;

    return <div className="page weekly-operation weekly-operation--simple">
      <header className="weekly-operation__head weekly-operation__head--simple">
        <div><span className="eyebrow">Operación semanal</span><h1>{enCaptura ? 'Captura' : 'Proceso'}</h1></div>
        <nav className="weekly-mode-tabs" aria-label="Grupo de operación">
          <NavLink to={rutaSemana('/semana/compras')} className={enCaptura ? 'is-active' : ''}>Captura</NavLink>
          <NavLink to={rutaSemana('/semana/despacho')} className={!enCaptura ? 'is-active' : ''}>Proceso</NavLink>
        </nav>
      </header>

      <SelectorSemana semana={semana} opciones={opcionesSemana} onChange={cambiarSemana} />

      <nav className={`capture-tabs ${enCaptura ? '' : 'process-tabs'}`} aria-label={enCaptura ? 'Datos que se capturan' : 'Proceso operativo'}>
        {pestanas.map((p) => <NavLink key={p.clave} to={rutaSemana(`/semana/${p.clave}`)} className={p.clave === actual ? 'is-active' : ''}><span>{p.numero}</span><strong>{p.label}</strong></NavLink>)}
      </nav>

      <div className="weekly-operation__content">
        {actual === 'compras' && <OperacionAdmin seccion="compras" integrado semana={semana} />}
        {actual === 'produccion' && <OperacionAdmin seccion="produccion" integrado semana={semana} />}
        {actual === 'ventas' && <Pedidos integrado semana={semana} />}
        {actual === 'despacho' && <Bodega integrado semana={semana} />}
        {actual === 'reparto' && <Ruta integrado semana={semana} />}
        {actual === 'recepcion' && <Recepcion integrado semana={semana} />}
        {actual === 'inventario' && <InventarioOperacion integrado semana={semana} />}
        {actual === 'cierre' && <OperacionAdmin seccion="cierre" integrado semana={semana} />}
      </div>
    </div>;
  }

  const permitidos = tareasPorRol.filter((p) =>
    (p.roles as readonly Rol[]).includes(usuario.rol) && (p.clave !== 'reparto' || repartoHabilitado));
  const alias = paso === 'pedidos' ? 'ventas' : paso;
  const inicio = permitidos[0]?.clave ?? 'ventas';
  if (!alias || !permitidos.some((p) => p.clave === alias)) return <Navigate to={rutaSemana(`/semana/${inicio}`)} replace />;
  const actual = alias as Tarea;

  return <div className="page weekly-operation weekly-operation--simple">
    <header className="weekly-operation__head weekly-operation__head--simple"><div><span className="eyebrow">Operación semanal</span><h1>Trabajo del día</h1></div></header>
    <SelectorSemana semana={semana} opciones={opcionesSemana} onChange={cambiarSemana} />
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

function SelectorSemana({ semana, opciones, onChange }: { semana: ReturnType<typeof crearSemana>; opciones: ReturnType<typeof semanasAlrededor>; onChange: (inicio: string) => void }) {
  const anterior = moverSemana(semana, -1);
  const siguiente = moverSemana(semana, 1);
  return <section className="global-week-picker" aria-label="Semana de toda la operación">
    <button className="icon-btn" aria-label="Semana anterior" onClick={() => onChange(anterior.inicio)}>←</button>
    <label><span>Panorama general</span><select value={semana.inicio} onChange={(e) => onChange(e.target.value)}>{opciones.map((s) => <option key={s.inicio} value={s.inicio}>Semana {s.numero} · {s.anio} · {etiquetaRango(s)}</option>)}</select></label>
    <button className="icon-btn" aria-label="Semana siguiente" onClick={() => onChange(siguiente.inicio)}>→</button>
    <div className="global-week-summary"><strong>Semana {semana.numero}</strong><span>{etiquetaRango(semana)}</span></div>
    {!semana.actual && <button className="btn btn-ghost btn-sm" onClick={() => onChange(crearSemana().inicio)}>Semana actual</button>}
  </section>;
}
