import { lazy, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth, type Rol } from '../auth';
import { Icono } from '../icons';
import ActivarAvisos from '../components/ActivarAvisos';
import { useOperacionConfig } from '../operacion-config';

const PanelAdmin = lazy(() => import('./PanelAdmin'));

interface Tarea { titulo: string; sub: string; ruta: string }

/** Banner "tu tarea de hoy" según el rol: lo más importante por hacer, de un toque. */
function TareaHoy({ repartoHabilitado }: { repartoHabilitado: boolean }) {
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
          return { titulo: 'Captura tu pedido', sub: 'Carne y desechables por fecha de entrega', ruta: '/pedidos' };
        }
        if (usuario.rol === 'encargado_bodega') {
          const ds = await api<{ estado: string }[]>('/distribuciones');
          const porSurtir = ds.filter((d) => d.estado === 'aprobada' || d.estado === 'verificada').length;
          if (porSurtir > 0) return { titulo: `${porSurtir} pedido${porSurtir > 1 ? 's' : ''} por surtir`, sub: 'Surte y carga el camión', ruta: '/bodega' };
          if (repartoHabilitado) {
            const rutas = (await api<(unknown | null)[]>('/rutas/mias')).filter(Boolean);
            if (rutas.length > 0) return { titulo: 'Tienes una ruta en curso', sub: 'Entrega parada por parada', ruta: '/ruta' };
          }
          return null;
        }
        if (usuario.rol === 'admin') {
          const d = await api<{ operacion: { pedidos_borrador: number; distribuciones_abiertas: number; paradas_pendientes: number; productos_bajo_minimo: number }; alertas: { titulo: string; detalle: string; ruta: string }[] }>('/dashboard/general');
          const alerta = d.alertas[0];
          if (alerta) return { titulo: alerta.titulo, sub: alerta.detalle, ruta: alerta.ruta };
          if (d.operacion.distribuciones_abiertas > 0) return {
            titulo: 'Distribuciones en proceso',
            sub: repartoHabilitado ? 'Revisa despacho y reparto' : 'Revisa los despachos de la semana',
            ruta: '/semana/despacho',
          };
          return null;
        }
        return null;
      } catch {
        return null;
      }
    }
    void calcular().then((t) => { if (vivo) setTarea(t); });
    return () => { vivo = false; };
  }, [usuario, repartoHabilitado]);

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
  requiereReparto?: boolean;
}

const MODULOS: Modulo[] = [
  { clave: 'pedidos', titulo: 'Ventas', icono: 'clipboard', desc: 'Carne y desechables por restaurante y semana', ruta: '/semana/ventas', roles: ['admin', 'encargado_sucursal'] },
  { clave: 'compras', titulo: 'Compras', icono: 'cart', desc: 'Materia prima, lotes y cuentas por pagar', ruta: '/semana/compras', soloAdmin: true },
  { clave: 'produccion', titulo: 'Producción', icono: 'factory', desc: 'Yield, costo por caja y markup', ruta: '/semana/produccion', soloAdmin: true },
  { clave: 'inventario', titulo: 'Inventarios', icono: 'boxes', desc: 'Bodega Addison y Carnicería', ruta: '/semana/inventario', roles: ['admin', 'encargado_bodega'] },
  { clave: 'rutas', titulo: 'Rutas', icono: 'map', desc: 'Norte, Sur y Tapatíos por día', ruta: '/rutas', soloAdmin: true },
  { clave: 'bodega', titulo: 'Despacho', icono: 'truck', desc: 'Surtir y cargar el vehículo', ruta: '/semana/despacho', roles: ['admin', 'encargado_bodega'] },
  { clave: 'ruta', titulo: 'Reparto', icono: 'map', desc: 'Entregar parada por parada', ruta: '/semana/reparto', roles: ['encargado_bodega'], requiereReparto: true },
  { clave: 'recepcion', titulo: 'Recepción', icono: 'inbox', desc: 'Recibir lo que llega del camión', ruta: '/semana/recepcion', roles: ['encargado_sucursal'], requiereReparto: true },
  { clave: 'facturacion', titulo: 'Facturación', icono: 'receipt', desc: 'Cobros, pagos y facturas pendientes', ruta: '/facturacion', soloAdmin: true },
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
  const { repartoHabilitado } = useOperacionConfig();
  const navigate = useNavigate();

  // Si "Bodega y reparto" tiene una ruta en curso, lo llevamos directo a entregarla (una vez por
  // sesión, para que pueda volver al inicio si quiere). Cero fricción: abre la app y a repartir.
  useEffect(() => {
    if (usuario?.rol !== 'encargado_bodega' || !repartoHabilitado) return;
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
  }, [usuario, navigate, repartoHabilitado]);

  if (!usuario) return null;
  const esAdmin = usuario.rol === 'admin';

  const visibles = MODULOS.filter((m) => {
    if (m.soloAdmin && !esAdmin) return false;
    if (m.roles && !m.roles.includes(usuario.rol)) return false;
    if (m.requiereReparto && !repartoHabilitado) return false;
    return true;
  });

  if (esAdmin) return (
    <div className="page admin-home">
      <header className="page-head operation-page-head"><div><span className="eyebrow">Resumen</span><h1>{saludo()}, {usuario.nombre}</h1></div></header>
      <ActivarAvisos />
      <TareaHoy repartoHabilitado={repartoHabilitado} />
      <PanelAdmin />
    </div>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{saludo()}, {usuario.nombre}</h1>
          <p className="page-sub">¿Qué quieres revisar hoy?</p>
        </div>
      </header>

      <ActivarAvisos />
      <TareaHoy repartoHabilitado={repartoHabilitado} />

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
