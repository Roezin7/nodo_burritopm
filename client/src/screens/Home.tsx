import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, type Rol } from '../auth';
import { faseDistribucion } from '../flujo';
import { Icono } from '../icons';
import ActivarAvisos from '../components/ActivarAvisos';
import PanelAdmin from './PanelAdmin';

interface Tarea { titulo: string; sub: string; ruta: string }

/** Banner "tu tarea de hoy" según el rol: lo más importante por hacer, de un toque. */
function TareaHoy() {
  const { usuario } = useAuth();
  const [tarea, setTarea] = useState<Tarea | null>(null);

  useEffect(() => {
    let vivo = true;
    async function calcular(): Promise<Tarea | null> {
      if (!usuario) return null;
      try {
        if (usuario.rol === 'encargado_sucursal') {
          const suc = usuario.ubicaciones?.find((u) => u.tipo === 'sucursal');
          if (!suc) return null;
          const recep = await api<{ lineas: { recibida: number | null }[] }[]>(`/distribuciones/recepciones?ubicacion=${suc.id}`);
          if (recep.some((d) => d.lineas.some((l) => l.recibida == null))) {
            return { titulo: 'Confirma tu recepción', sub: 'Llegó un pedido a tu sucursal', ruta: '/recepcion' };
          }
          const ses = await api<{ programado: boolean; conteo: { estado: string } | null }>(`/conteos/sesion?ubicacion=${suc.id}`);
          if (ses.programado && ses.conteo?.estado !== 'cerrado') {
            return { titulo: 'Hoy toca pedido', sub: ses.conteo ? 'Continúa el pedido de hoy' : 'Elige cuánto quieres recibir', ruta: '/inventario' };
          }
          return null;
        }
        if (usuario.rol === 'encargado_bodega') {
          const ds = await api<{ estado: string }[]>('/distribuciones');
          const porSurtir = ds.filter((d) => d.estado === 'aprobada' || d.estado === 'verificada').length;
          if (porSurtir > 0) return { titulo: `${porSurtir} pedido${porSurtir > 1 ? 's' : ''} por surtir`, sub: 'Surte y carga el camión', ruta: '/bodega' };
          const rutas = (await api<(unknown | null)[]>('/rutas/mias')).filter(Boolean);
          if (rutas.length > 0) return { titulo: 'Tienes una ruta en curso', sub: 'Entrega parada por parada', ruta: '/ruta' };
          return null;
        }
        if (usuario.rol === 'admin') {
          // Próxima acción del admin según dónde está atorado el ciclo.
          const d = await api<{
            conteos_pendientes: number;
            conteos_listos: number;
            distribucion_actual: { id: number; estado: string } | null;
          }>('/dashboard');
          const dist = d.distribucion_actual;
          const cerrado = dist && ['entregada', 'cerrada', 'cerrada_con_incidencias', 'cancelada'].includes(dist.estado);
          if (dist && !cerrado) {
            const f = faseDistribucion(dist.estado);
            if (f.clave === 'planeacion') return { titulo: `Revisa y aprueba el pedido #${dist.id}`, sub: 'Ajusta cantidades y aprueba', ruta: '/distribucion' };
            if (f.clave === 'bodega') return { titulo: `Pedido #${dist.id} en bodega`, sub: 'Surte y carga el camión', ruta: '/bodega' };
            if (f.clave === 'ruta') return { titulo: `Pedido #${dist.id} en ruta`, sub: 'Sigue el reparto y las recepciones', ruta: '/ruta' };
          }
          if (d.conteos_pendientes > 0) {
            return { titulo: `${d.conteos_pendientes} sucursal${d.conteos_pendientes > 1 ? 'es' : ''} sin cerrar pedido`, sub: 'Aún no pueden entrar al pedido maestro', ruta: '/inventario' };
          }
          if (d.conteos_listos > 0) {
            return { titulo: 'Crea la distribución', sub: 'Las sucursales ya cerraron su pedido', ruta: '/distribucion' };
          }
          return null;
        }
        return null;
      } catch {
        return null;
      }
    }
    void calcular().then((t) => { if (vivo) setTarea(t); });
    return () => { vivo = false; };
  }, [usuario]);

  if (!tarea) return null;
  return (
    <Link className="hoy-card tarea-hoy" to={tarea.ruta}>
      <div>
        <div className="hoy-card-fecha">{tarea.titulo}</div>
        <p className="muted" style={{ margin: '0.2rem 0 0' }}>{tarea.sub}</p>
      </div>
      <span className="tarea-hoy-cta">Ir <Icono name="chevron" size={18} /></span>
    </Link>
  );
}

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
  { clave: 'inventario', titulo: 'Pedido / inventario', icono: 'clipboard', desc: 'Sucursal pide directo; bodega cuenta físico', ruta: '/inventario' },
  { clave: 'distribucion', titulo: 'Distribución', icono: 'trending', desc: 'Abastecimiento y pedido maestro', ruta: '/distribucion', soloAdmin: true },
  { clave: 'bodega', titulo: 'Bodega y reparto', icono: 'truck', desc: 'Surtir, cargar el camión y entregar', ruta: '/bodega', roles: ['admin', 'encargado_bodega'] },
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
  const navigate = useNavigate();
  const [tab, setTab] = useState<'inicio' | 'dashboard'>('inicio');

  // Si "Bodega y reparto" tiene una ruta en curso, lo llevamos directo a entregarla (una vez por
  // sesión, para que pueda volver al inicio si quiere). Cero fricción: abre la app y a repartir.
  useEffect(() => {
    if (usuario?.rol !== 'encargado_bodega') return;
    if (sessionStorage.getItem('bpm-ruta-auto')) return;
    let vivo = true;
    api<(unknown | null)[]>('/rutas/mias')
      .then((rs) => {
        if (vivo && rs.filter(Boolean).length > 0) {
          sessionStorage.setItem('bpm-ruta-auto', '1');
          navigate('/ruta');
        }
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [usuario, navigate]);

  if (!usuario) return null;
  const esAdmin = usuario.rol === 'admin';

  const visibles = MODULOS.filter((m) => {
    if (m.soloAdmin && !esAdmin) return false;
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

      <ActivarAvisos />
      <TareaHoy />

      {esAdmin && (
        <div className="tabs">
          <button className={tab === 'inicio' ? 'tab tab--on' : 'tab'} onClick={() => setTab('inicio')}>Inicio</button>
          <button className={tab === 'dashboard' ? 'tab tab--on' : 'tab'} onClick={() => setTab('dashboard')}>Dashboard</button>
        </div>
      )}

      {(!esAdmin || tab === 'inicio') && (
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
      )}

      {esAdmin && tab === 'dashboard' && <PanelAdmin />}
    </div>
  );
}
