import { type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth, rolLabel } from './auth';
import { useTema } from './theme';
import { Icono } from './icons';
import { useOffline } from './offline';
import BurritoLockup from './brand/BurritoLockup';

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
  { ruta: '/inventario', label: 'Inventario', icono: 'clipboard', roles: ['admin', 'encargado_bodega', 'encargado_sucursal'] },
  { ruta: '/distribucion', label: 'Distribución', icono: 'trending', soloAdmin: true },
  { ruta: '/bodega', label: 'Bodega', icono: 'package', roles: ['admin', 'encargado_bodega'] },
  { ruta: '/ruta', label: 'Ruta', icono: 'truck', roles: ['admin', 'encargado_bodega'] },
  { ruta: '/recepcion', label: 'Recepción', icono: 'checks', roles: ['admin', 'encargado_sucursal'] },
  { ruta: '/almacen', label: 'Almacén', icono: 'salida', roles: ['admin', 'encargado_bodega'] },
  { ruta: '/incidencias', label: 'Incidencias', icono: 'wallet', soloAdmin: true },
  { ruta: '/configuracion', label: 'Configuración', icono: 'settings', soloAdmin: true },
];

// En móvil mostramos pocas pestañas y el resto en una hoja "Más" (accesible al pulgar).
const MAX_PRIMARIOS = 4;

export default function Shell({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const { tema, alternar } = useTema();
  const { online, pendientes, sincronizar } = useOffline();
  const { pathname } = useLocation();
  const [masAbierto, setMasAbierto] = useState(false);

  const items = ITEMS.filter((i) => {
    if (i.soloAdmin && usuario?.rol !== 'admin') return false;
    if (i.roles && !(usuario && i.roles.includes(usuario.rol))) return false;
    return true;
  });

  // Si caben todos en la barra (≤5), no hace falta "Más"; si no, dejamos 4 + "Más".
  const hayMas = items.length > 5;
  const primarios = hayMas ? items.slice(0, MAX_PRIMARIOS) : items;
  const enMas = hayMas && items.slice(MAX_PRIMARIOS).some((i) => (i.ruta === '/' ? pathname === '/' : pathname.startsWith(i.ruta)));

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
          <BurritoLockup size={30} variante="rail" />
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
                {usuario.nombre} · {rolLabel(usuario.rol)}
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

      {/* Nav inferior — móvil/tablet: pocas pestañas + "Más" para el resto */}
      <nav className="bottom-nav">
        {primarios.map((i) => (
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
        {hayMas && (
          <button
            type="button"
            className={`bottom-link ${enMas || masAbierto ? 'bottom-link--on' : ''}`}
            onClick={() => setMasAbierto(true)}
            aria-haspopup="true"
            aria-expanded={masAbierto}
          >
            <Icono name="menu" size={22} />
            <span>Más</span>
          </button>
        )}
      </nav>

      {/* Hoja "Más": resto de secciones + tema/salir, en tiles grandes y fáciles de tocar */}
      {masAbierto && (
        <div className="mas-sheet-backdrop" onClick={() => setMasAbierto(false)} role="presentation">
          <div className="mas-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Más opciones">
            <div className="mas-sheet-handle" />
            <div className="mas-grid">
              {items.slice(MAX_PRIMARIOS).map((i) => (
                <NavLink
                  key={i.ruta}
                  to={i.ruta}
                  end={i.ruta === '/'}
                  onClick={() => setMasAbierto(false)}
                  className={({ isActive }) => (isActive ? 'mas-item mas-item--on' : 'mas-item')}
                >
                  <Icono name={i.icono} size={24} />
                  <span>{i.label}</span>
                </NavLink>
              ))}
            </div>
            <div className="mas-sheet-foot">
              <button className="mas-item" onClick={() => { alternar(); }}>
                <Icono name={tema === 'dark' ? 'sun' : 'moon'} size={24} />
                <span>{tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
              </button>
              <button className="mas-item" onClick={logout}>
                <Icono name="logout" size={24} />
                <span>Salir</span>
              </button>
            </div>
            <button className="btn btn-secondary btn-block mas-cerrar" onClick={() => setMasAbierto(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
