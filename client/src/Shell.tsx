import { type FormEvent, type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth, rolLabel } from './auth';
import { useTema } from './theme';
import { Icono } from './icons';
import { useOffline } from './offline';
import BurritoLockup from './brand/BurritoLockup';
import { useOperacionConfig } from './operacion-config';
import { api, ApiError } from './api';
import { useSemanaGlobal } from './semana-context';

import type { Rol } from './auth';

interface Item {
  ruta: string;
  label: string;
  icono: Parameters<typeof Icono>[0]['name'];
  grupo: 'general' | 'captura' | 'proceso' | 'sistema';
  soloAdmin?: boolean;
  roles?: Rol[]; // si se define, solo estos roles ven el ítem
  requiereReparto?: boolean;
}

const ITEMS: Item[] = [
  { ruta: '/', label: 'Resumen', icono: 'home', grupo: 'general' },
  { ruta: '/semana', label: 'Semana', icono: 'clipboard', grupo: 'general' },
  { ruta: '/semana/compras', label: 'Compras', icono: 'cart', grupo: 'captura', soloAdmin: true },
  { ruta: '/semana/produccion', label: 'Producción', icono: 'factory', grupo: 'captura', soloAdmin: true },
  { ruta: '/semana/ventas', label: 'Ventas', icono: 'receipt', grupo: 'captura', roles: ['admin', 'encargado_sucursal'] },
  { ruta: '/semana/despacho', label: 'Despacho', icono: 'truck', grupo: 'proceso', roles: ['admin', 'encargado_bodega'] },
  { ruta: '/semana/reparto', label: 'Reparto', icono: 'map', grupo: 'proceso', roles: ['admin', 'encargado_bodega'], requiereReparto: true },
  { ruta: '/semana/recepcion', label: 'Recepción', icono: 'inbox', grupo: 'proceso', roles: ['encargado_sucursal'], requiereReparto: true },
  { ruta: '/semana/inventario', label: 'Inventario', icono: 'boxes', grupo: 'proceso', roles: ['admin', 'encargado_bodega'] },
  { ruta: '/semana/cierre', label: 'Cierre', icono: 'checks', grupo: 'proceso', soloAdmin: true },
  { ruta: '/facturacion', label: 'Facturación', icono: 'wallet', grupo: 'sistema', soloAdmin: true },
  { ruta: '/incidencias', label: 'Incidencias', icono: 'alert', grupo: 'sistema', soloAdmin: true },
  { ruta: '/semana/recepcion', label: 'Auditoría', icono: 'checks', grupo: 'sistema', soloAdmin: true },
];

const GRUPOS = [
  { clave: 'general', label: 'General' },
  { clave: 'captura', label: 'Captura' },
  { clave: 'proceso', label: 'Proceso' },
  { clave: 'sistema', label: 'Control' },
] as const;

// En móvil mostramos pocas pestañas y el resto en una hoja "Más" (accesible al pulgar).
const MAX_PRIMARIOS = 4;

function AvisoPinTemporal() {
  const { usuario, logout } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [actual, setActual] = useState('');
  const [nuevo, setNuevo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!usuario?.requiere_cambio_pin) return null;

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!/^\d{4,6}$/.test(actual) || !/^\d{4,6}$/.test(nuevo)) { setError('Usa de 4 a 6 dígitos.'); return; }
    setBusy(true);
    try {
      await api('/auth/cambiar-pin', { method: 'POST', body: { pin_actual: actual, pin_nuevo: nuevo } });
      logout();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo cambiar el PIN.'); }
    finally { setBusy(false); }
  }

  return <form className="notice notice--warning temporary-pin" onSubmit={(e) => void guardar(e)}>
    <div><strong>Protege este acceso</strong><span> Estás usando un PIN temporal. Cámbialo antes de continuar usando producción.</span></div>
    {abierto ? <>
      <input aria-label="PIN actual" inputMode="numeric" type="password" maxLength={6} placeholder="PIN actual" value={actual} onChange={(e) => setActual(e.target.value.replace(/\D/g, ''))} />
      <input aria-label="PIN nuevo" inputMode="numeric" type="password" maxLength={6} placeholder="PIN nuevo" value={nuevo} onChange={(e) => setNuevo(e.target.value.replace(/\D/g, ''))} />
      <button className="btn btn-primary btn-sm" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Cambiar PIN'}</button>
      {error && <small className="error-msg">{error}</small>}
    </> : <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAbierto(true)}>Cambiar PIN</button>}
  </form>;
}

export default function Shell({ children }: { children: ReactNode }) {
  const { usuario, logout } = useAuth();
  const { tema, alternar } = useTema();
  const { online, pendientes, sincronizar } = useOffline();
  const { repartoHabilitado } = useOperacionConfig();
  const { pathname } = useLocation();
  const { rutaSemana } = useSemanaGlobal();
  const [masAbierto, setMasAbierto] = useState(false);

  const items = ITEMS.filter((i) => {
    if (i.soloAdmin && usuario?.rol !== 'admin') return false;
    if (i.roles && !(usuario && i.roles.includes(usuario.rol))) return false;
    if (i.requiereReparto && !repartoHabilitado) return false;
    return true;
  });

  // "Más" siempre visible en móvil: además del overflow, ahí viven Tema y Cerrar sesión
  // (si no, roles con pocas secciones se quedaban sin forma de salir en el teléfono).
  const primarios = items.length > MAX_PRIMARIOS ? items.slice(0, MAX_PRIMARIOS) : items;
  const extras = items.length > MAX_PRIMARIOS ? items.slice(MAX_PRIMARIOS) : [];
  const itemActivo = (i: Item) => i.ruta === '/'
    ? pathname === '/'
    : i.ruta === '/semana' ? pathname === '/semana' : pathname.startsWith(i.ruta);
  const destino = (i: Item) => i.ruta.startsWith('/semana') ? rutaSemana(i.ruta) : i.ruta;
  const etiquetaItem = (i: Item) => i.label;
  const enMas = extras.some(itemActivo);

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
          {GRUPOS.map((grupo) => {
            const delGrupo = items.filter((i) => i.grupo === grupo.clave);
            if (!delGrupo.length) return null;
            return <div className="nav-group" key={grupo.clave}>
              <span className="nav-group-label">{grupo.label}</span>
              {delGrupo.map((i) => (
                <NavLink
                  key={i.ruta}
                  to={destino(i)}
                  end={i.ruta === '/'}
                  className={itemActivo(i) ? 'nav-link nav-link--on' : 'nav-link'}
                >
                  <Icono name={i.icono} size={19} />
                  <span>{etiquetaItem(i)}</span>
                </NavLink>
              ))}
            </div>;
          })}
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
                {usuario.nombre} · {usuario.rol === 'encargado_bodega' && !repartoHabilitado ? 'Bodega' : rolLabel(usuario.rol)}
              </span>
            )}
          </div>
          <div className="ctx-right">
            {syncChip}
            {usuario?.rol === 'admin' && <NavLink className="icon-btn" to="/configuracion" aria-label="Configuración" title="Configuración"><Icono name="settings" size={18} /></NavLink>}
            <button className="icon-btn" onClick={alternar} aria-label="Cambiar tema" title="Cambiar tema">
              <Icono name={tema === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
          </div>
        </header>

        <main className="content"><AvisoPinTemporal />{children}</main>
      </div>

      {/* Nav inferior — móvil/tablet: pocas pestañas + "Más" para el resto */}
      <nav className="bottom-nav">
        {primarios.map((i) => (
          <NavLink
            key={i.ruta}
            to={destino(i)}
            end={i.ruta === '/'}
            className={itemActivo(i) ? 'bottom-link bottom-link--on' : 'bottom-link'}
          >
            <Icono name={i.icono} size={22} />
            <span>{etiquetaItem(i)}</span>
          </NavLink>
        ))}
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
      </nav>

      {/* Hoja "Más": resto de secciones + tema/salir, en tiles grandes y fáciles de tocar */}
      {masAbierto && (
        <div className="mas-sheet-backdrop" onClick={() => setMasAbierto(false)} role="presentation">
          <div className="mas-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Más opciones">
            <div className="mas-sheet-handle" />
            {extras.length > 0 && (
              <div className="mas-grid">
                {extras.map((i) => (
                  <NavLink
                    key={i.ruta}
                    to={destino(i)}
                    end={i.ruta === '/'}
                    onClick={() => setMasAbierto(false)}
                    className={itemActivo(i) ? 'mas-item mas-item--on' : 'mas-item'}
                  >
                    <Icono name={i.icono} size={24} />
                    <span>{etiquetaItem(i)}</span>
                  </NavLink>
                ))}
              </div>
            )}
            <div className="mas-sheet-foot">
              <button className="mas-item" onClick={() => { alternar(); }}>
                <Icono name={tema === 'dark' ? 'sun' : 'moon'} size={24} />
                <span>{tema === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
              </button>
              <button className="mas-item" onClick={() => { setMasAbierto(false); logout(); }}>
                <Icono name="logout" size={24} />
                <span>Cerrar sesión</span>
              </button>
            </div>
            <button className="btn btn-secondary btn-block mas-cerrar" onClick={() => setMasAbierto(false)}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
