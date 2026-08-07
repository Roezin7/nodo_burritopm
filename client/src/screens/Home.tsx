import { lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth, type Rol } from '../auth';
import { Icono } from '../icons';
import ActivarAvisos from '../components/ActivarAvisos';

const PanelAdmin = lazy(() => import('./PanelAdmin'));

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
          return { titulo: 'Captura tu pedido', sub: 'Carne y desechables por fecha de entrega', ruta: '/pedidos' };
        }
        if (usuario.rol === 'encargado_bodega') return null;
        if (usuario.rol === 'admin') {
          const d = await api<{ operacion: { pedidos_borrador: number; distribuciones_abiertas: number; productos_bajo_minimo: number }; alertas: { titulo: string; detalle: string; ruta: string }[] }>('/dashboard/general');
          const alerta = d.alertas[0];
          if (alerta) return { titulo: alerta.titulo, sub: alerta.detalle, ruta: alerta.ruta };
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
  { clave: 'pedidos', titulo: 'Pedidos', icono: 'clipboard', desc: 'Carne y desechables por restaurante y semana', ruta: '/semana/ventas', roles: ['admin', 'encargado_sucursal'] },
  { clave: 'compras', titulo: 'Compras', icono: 'cart', desc: 'Materia prima, lotes y cuentas por pagar', ruta: '/semana/compras', soloAdmin: true },
  { clave: 'produccion', titulo: 'Producción', icono: 'factory', desc: 'Yield, costo por caja y markup', ruta: '/semana/produccion', soloAdmin: true },
  { clave: 'inventario', titulo: 'Inventario', icono: 'boxes', desc: 'Bodega Adison y Carnicería', ruta: '/semana/inventario', roles: ['admin', 'encargado_bodega'] },
  { clave: 'rutas', titulo: 'Rutas de entrega', icono: 'map', desc: 'Orden de entrega por día', ruta: '/rutas', soloAdmin: true },
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

  if (!usuario) return null;
  const esAdmin = usuario.rol === 'admin';

  const visibles = MODULOS.filter((m) => {
    if (m.soloAdmin && !esAdmin) return false;
    if (m.roles && !m.roles.includes(usuario.rol)) return false;
    return true;
  });

  if (esAdmin) return (
    <div className="page admin-home">
      <header className="page-head operation-page-head"><div><span className="eyebrow">Hoy</span><h1>{saludo()}, {usuario.nombre}</h1><p className="page-sub">Primero atiende lo pendiente. La semana conserva el contexto completo de la operación.</p></div><Link className="btn btn-secondary" to="/semana/ventas">Abrir operación</Link></header>
      <ActivarAvisos />
      <TareaHoy />
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
      <TareaHoy />

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
