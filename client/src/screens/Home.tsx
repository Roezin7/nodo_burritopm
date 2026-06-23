import { Link } from 'react-router-dom';
import { useAuth } from '../auth';

interface Modulo {
  clave: string;
  titulo: string;
  emoji: string;
  desc: string;
  ruta?: string; // si no hay ruta -> aún no disponible
  soloAdmin?: boolean;
}

const MODULOS: Modulo[] = [
  { clave: 'conteo', titulo: 'Conteo', emoji: '📋', desc: 'Inventario físico de tu ubicación' },
  { clave: 'distribucion', titulo: 'Distribución', emoji: '🚚', desc: 'Abastecimiento y pedido maestro', soloAdmin: true },
  { clave: 'ajustes', titulo: 'Configuración', emoji: '⚙️', desc: 'Ubicaciones, usuarios, catálogo', ruta: '/configuracion', soloAdmin: true },
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

  const visibles = MODULOS.filter((m) => !m.soloAdmin || usuario.rol === 'admin');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{saludo()}, {usuario.nombre}</h1>
          <p className="page-sub">¿Qué quieres revisar hoy?</p>
        </div>
      </header>

      <div className="module-grid">
        {visibles.map((m) =>
          m.ruta ? (
            <Link key={m.clave} className="module-card module-card--active" to={m.ruta}>
              <span className="module-emoji">{m.emoji}</span>
              <strong>{m.titulo}</strong>
              <small>{m.desc}</small>
            </Link>
          ) : (
            <button key={m.clave} className="module-card" disabled>
              <span className="module-emoji">{m.emoji}</span>
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
