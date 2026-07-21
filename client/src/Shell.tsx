import { type FormEvent, type ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth, rolLabel } from './auth';
import { useTema } from './theme';
import { Icono } from './icons';
import BurritoLockup from './brand/BurritoLockup';
import { useOperacionConfig } from './operacion-config';
import { api, ApiError } from './api';
import { useSemanaGlobal } from './semana-context';
import Modal from './components/Modal';
import SyncCenter from './components/SyncCenter';

import type { Rol } from './auth';

interface Item {
  ruta: string;
  label: string;
  icono: Parameters<typeof Icono>[0]['name'];
  grupo: 'general' | 'operacion_diaria' | 'control_semanal' | 'administracion';
  soloAdmin?: boolean;
  roles?: Rol[]; // si se define, solo estos roles ven el ítem
  requiereReparto?: boolean;
}

const ITEMS: Item[] = [
  { ruta: '/', label: 'Resumen', icono: 'home', grupo: 'general' },
  { ruta: '/semana/ventas', label: 'Ventas', icono: 'receipt', grupo: 'operacion_diaria', roles: ['admin', 'encargado_sucursal'] },
  { ruta: '/semana/despacho', label: 'Despacho', icono: 'truck', grupo: 'operacion_diaria', roles: ['admin', 'encargado_bodega'] },
  { ruta: '/semana/reparto', label: 'Reparto', icono: 'map', grupo: 'operacion_diaria', roles: ['admin', 'encargado_bodega'], requiereReparto: true },
  { ruta: '/semana/recepcion', label: 'Recepción', icono: 'inbox', grupo: 'operacion_diaria', roles: ['encargado_sucursal'], requiereReparto: true },
  { ruta: '/semana/compras', label: 'Compras', icono: 'cart', grupo: 'control_semanal', soloAdmin: true },
  { ruta: '/semana/produccion', label: 'Producción', icono: 'factory', grupo: 'control_semanal', soloAdmin: true },
  { ruta: '/semana/inventario', label: 'Inventario', icono: 'boxes', grupo: 'control_semanal', roles: ['admin', 'encargado_bodega'] },
  { ruta: '/semana/cierre', label: 'Cierre', icono: 'checks', grupo: 'control_semanal', soloAdmin: true },
  { ruta: '/facturacion', label: 'Facturación', icono: 'wallet', grupo: 'administracion', soloAdmin: true },
  { ruta: '/incidencias', label: 'Incidencias', icono: 'alert', grupo: 'administracion', soloAdmin: true },
  { ruta: '/semana/recepcion', label: 'Auditoría', icono: 'checks', grupo: 'administracion', soloAdmin: true },
];

const GRUPOS = [
  { clave: 'general', label: 'General' },
  { clave: 'operacion_diaria', label: 'Operación diaria' },
  { clave: 'control_semanal', label: 'Control semanal' },
  { clave: 'administracion', label: 'Administración' },
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
  const operacionAdmin: Item = { ruta: '/semana', label: 'Operación', icono: 'checks', grupo: 'general', soloAdmin: true };
  const itemsMoviles = usuario?.rol === 'admin'
    ? [items.find((i) => i.ruta === '/')!, operacionAdmin, items.find((i) => i.ruta === '/facturacion')!]
    : items;
  const primarios = itemsMoviles.length > MAX_PRIMARIOS ? itemsMoviles.slice(0, MAX_PRIMARIOS) : itemsMoviles;
  const rutasPrimarias = new Set(primarios.map((i) => i.ruta));
  const extras = usuario?.rol === 'admin'
    ? items.filter((i) => !rutasPrimarias.has(i.ruta))
    : itemsMoviles.length > MAX_PRIMARIOS ? itemsMoviles.slice(MAX_PRIMARIOS) : [];
  const itemActivo = (i: Item) => i.ruta === '/'
    ? pathname === '/'
    : i.ruta === '/semana' ? pathname.startsWith('/semana') : pathname.startsWith(i.ruta);
  const destino = (i: Item) => i.ruta.startsWith('/semana') ? rutaSemana(i.ruta) : i.ruta;
  const etiquetaItem = (i: Item) => {
    if (i.ruta === '/' && usuario?.rol !== 'admin') return 'Hoy';
    if (i.ruta === '/semana/ventas' && usuario?.rol === 'encargado_sucursal') return 'Pedido';
    return i.label;
  };
  // Una sección agrupadora ("Operación") debe ser la única activa mientras se navega
  // cualquiera de sus pasos. Sin esta prioridad, también se iluminaba "Más" porque ahí
  // viven los accesos directos a esos mismos pasos administrativos.
  const enPrimario = primarios.some(itemActivo);
  const enMas = !enPrimario && extras.some(itemActivo);

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <aside className="nav-rail">
        <div className="nav-brand">
          <BurritoLockup size={30} variante="rail" />
        </div>
        <nav className="nav-links" aria-label="Navegación principal">
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
            <SyncCenter />
            {usuario?.rol === 'admin' && <NavLink className="icon-btn" to="/configuracion" aria-label="Configuración" title="Configuración"><Icono name="settings" size={18} /></NavLink>}
          </div>
        </header>

        <main className="content" id="main-content" tabIndex={-1}><AvisoPinTemporal />{children}</main>
      </div>

      {/* Nav inferior — móvil/tablet: pocas pestañas + "Más" para el resto */}
      <nav className="bottom-nav" aria-label="Navegación móvil">
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
        <Modal backdropClassName="mas-sheet-backdrop" className="mas-sheet" ariaLabel="Más opciones" onClose={() => setMasAbierto(false)}>
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
        </Modal>
      )}
    </div>
  );
}
