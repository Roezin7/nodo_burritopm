import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from './auth';
import { useTema } from './theme';
import { Icono } from './icons';
import { useOffline } from './offline';
import NodoIsotipo from './brand/NodoIsotipo';

import type { Rol } from './auth';

interface Item {
  ruta: string;
  label: string;
  icono: Parameters<typeof Icono>[0]['name'];
  soloAdmin?: boolean;
  roles?: Rol[]; // si se define, solo estos roles ven el ítem
}

const ITEMS: Item[] = [
  { ruta: '/', label: 'Inicio', icono: 'home' },
  { ruta: '/conteo', label: 'Conteo', icono: 'package', roles: ['admin', 'encargado_bodega', 'encargado_sucursal'] },
  { ruta: '/distribucion', label: 'Distribución', icono: 'trending', soloAdmin: true },
  { ruta: '/bodega', label: 'Bodega', icono: 'package', roles: ['admin', 'encargado_bodega'] },
  { ruta: '/configuracion', label: 'Configuración', icono: 'settings', soloAdmin: true },
];

export default function Shell({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const { tema, alternar } = useTema();
  const { online, pendientes, sincronizar } = useOffline();

  const items = ITEMS.filter((i) => {
    if (i.soloAdmin && usuario?.rol !== 'admin') return false;
    if (i.roles && !(usuario && i.roles.includes(usuario.rol))) return false;
    return true;
  });

  const syncChip = !online ? (
    <span className="ctx-chip ctx-chip--off">
      <span className="dot-status" /> Sin conexión
      {pendientes > 0 && <span>· {pendientes}</span>}
    </span>
  ) : pendientes > 0 ? (
    <span className="ctx-chip ctx-chip--sync" onClick={() => void sincronizar()}>
      <span className="dot-status" /> Sincronizando {pendientes}
    </span>
  ) : (
    <span className="ctx-chip">
      <span className="dot-status" /> En línea
    </span>
  );

  return (
    <div className="shell">
      <aside className="nav-rail">
        <div className="nav-brand">
          <NodoIsotipo size={30} />
          <span className="nav-wordmark">NODO</span>
        </div>
        <nav className="nav-links">
          {items.map((i) => (
            <NavLink
              key={i.ruta}
              to={i.ruta}
              end={i.ruta === '/'}
              className={({ isActive }) => (isActive ? 'nav-link nav-link--on' : 'nav-link')}
            >
              <Icono name={i.icono} size={20} />
              <span>{i.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="nav-foot">
          <button className="nav-link" onClick={alternar}>
            <Icono name={tema === 'dark' ? 'sun' : 'moon'} size={20} />
            <span>{tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
          </button>
          <button className="nav-link" onClick={logout}>
            <Icono name="logout" size={20} />
            <span>Salir</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="context-bar">
          <div className="ctx-left">
            <span className="ctx-negocio">Burrito Parrilla</span>
            {usuario && (
              <span className="ctx-user">
                {usuario.nombre} · {usuario.rol}
              </span>
            )}
          </div>
          <div className="ctx-right">
            {syncChip}
            <button className="icon-btn" onClick={alternar} aria-label="Cambiar tema" title="Cambiar tema">
              <Icono name={tema === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
          </div>
        </header>

        <main className="content">{children}</main>
      </div>

      {/* Nav inferior — móvil/tablet */}
      <nav className="bottom-nav">
        {items.map((i) => (
          <NavLink
            key={i.ruta}
            to={i.ruta}
            end={i.ruta === '/'}
            className={({ isActive }) => (isActive ? 'bottom-link bottom-link--on' : 'bottom-link')}
          >
            <Icono name={i.icono} size={22} />
            <span>{i.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
