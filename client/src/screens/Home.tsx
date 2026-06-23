import { Link } from 'react-router-dom';
import { useAuth, type Rol } from '../auth';
import { Icono } from '../icons';
import PanelAdmin from './PanelAdmin';

interface Modulo {
  clave: string;
  titulo: string;
  icono: Parameters<typeof Icono>[0]['name'];
  desc: string;
  ruta?: string; // si no hay ruta -> aún no disponible
  soloAdmin?: boolean;
  roles?: Rol[];
}

const MODULOS: Modulo[] = [
  { clave: 'inventario', titulo: 'Inventario', icono: 'clipboard', desc: 'Inventario físico de tu ubicación', ruta: '/inventario' },
  { clave: 'distribucion', titulo: 'Distribución', icono: 'trending', desc: 'Abastecimiento y pedido maestro', ruta: '/distribucion', soloAdmin: true },
  { clave: 'bodega', titulo: 'Bodega', icono: 'package', desc: 'Surtir y cargar el camión', ruta: '/bodega', roles: ['admin', 'encargado_bodega'] },
  { clave: 'ruta', titulo: 'Ruta', icono: 'truck', desc: 'Entregar parada por parada', ruta: '/ruta', roles: ['admin', 'encargado_bodega'] },
  { clave: 'recepcion', titulo: 'Recepción', icono: 'inbox', desc: 'Recibir lo que llega del camión', ruta: '/recepcion', roles: ['admin', 'encargado_sucursal'] },
  { clave: 'incidencias', titulo: 'Incidencias', icono: 'alert', desc: 'Diferencias y alertas', ruta: '/incidencias', soloAdmin: true },
  { clave: 'ajustes', titulo: 'Configuración', icono: 'settings', desc: 'Ubicaciones, usuarios, catálogo', ruta: '/configuracion', soloAdmin: true },
];

function saludo() {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Chicago' }));
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function Home() {
  const { usuario } = useAuth();
  if (!usuario) return null;

  const visibles = MODULOS.filter((m) => {
    if (m.soloAdmin && usuario.rol !== 'admin') return false;
    if (m.roles && !m.roles.includes(usuario.rol)) return false;
    return true;
  });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{saludo()}, {usuario.nombre}</h1>
          <p className="page-sub">¿Qué quieres revisar hoy?</p>
        </div>
      </header>

      {usuario.rol === 'admin' && <PanelAdmin />}

      <div className="module-grid">
        {visibles.map((m) =>
          m.ruta ? (
            <Link key={m.clave} className="module-card module-card--active" to={m.ruta}>
              <span className="module-icon"><Icono name={m.icono} size={26} /></span>
              <strong>{m.titulo}</strong>
              <small>{m.desc}</small>
            </Link>
          ) : (
            <button key={m.clave} className="module-card" disabled>
              <span className="module-icon"><Icono name={m.icono} size={26} /></span>
              <strong>{m.titulo}</strong>
              <small>{m.desc}</small>
              <em className="badge-soon">próximamente</em>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
