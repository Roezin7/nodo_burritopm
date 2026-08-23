import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, type Rol } from './auth';
import { ToastProvider } from './toast';
import SplashIntro from './brand/SplashIntro';
import Spinner from './components/Spinner';
import { Component, Suspense, lazy, useState, useEffect, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { SemanaProvider } from './semana-context';
import { DialogProvider } from './dialog';
import { usePageTitle } from './page-title';

// Cada área grande se descarga solo cuando el rol la necesita. Además de acelerar el arranque,
// esto evita que el teléfono evalúe la consola administrativa para capturar un pedido sencillo.
const cargarLogin = () => import('./screens/Login');
const cargarHome = () => import('./screens/Home');
const cargarShell = () => import('./Shell');
const cargarSemana = () => import('./screens/operacion/SemanaOperacion');
const Login = lazy(cargarLogin);
const Home = lazy(cargarHome);
const Shell = lazy(cargarShell);
const UpdateBanner = lazy(() => import('./UpdateBanner'));
const ConteosInventario = lazy(() => import('./screens/inventario/Inventario'));
const Incidencias = lazy(() => import('./screens/incidencias/Incidencias'));
const Configuracion = lazy(() => import('./screens/config/Configuracion'));
const OperacionAdmin = lazy(() => import('./screens/operacion/OperacionAdmin'));
const SemanaOperacion = lazy(cargarSemana);
const Facturacion = lazy(() => import('./screens/Facturacion'));

// Comienza en paralelo el único camino que probablemente se mostrará. Evita una cascada
// base → autenticación → menú → pantalla, sin descargar rutas que el usuario no abrió.
try {
  if (localStorage.getItem('bpm_token')) {
    void cargarShell();
    if (window.location.pathname.startsWith('/semana')) void cargarSemana();
    else if (window.location.pathname === '/') void cargarHome();
  } else {
    void cargarLogin();
  }
} catch {
  void cargarLogin();
}

const ASSET_RECOVERY_KEY = 'bpm-asset-recovery-attempted';

function esFalloDeAsset(error: unknown) {
  const mensaje = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed|CSS chunk/i.test(mensaje);
}

function limpiarAssetsYRecargar() {
  try {
    if (sessionStorage.getItem(ASSET_RECOVERY_KEY) === '1') return false;
    sessionStorage.setItem(ASSET_RECOVERY_KEY, '1');
  } catch { return false; }

  const limpiar = async () => {
    try {
      const registros = await navigator.serviceWorker?.getRegistrations() ?? [];
      await Promise.all(registros.map((registro) => registro.unregister()));
      if ('caches' in window) {
        const nombres = await caches.keys();
        await Promise.all(nombres.map((nombre) => caches.delete(nombre)));
      }
    } catch { /* una recarga normal todavía puede recuperar el app-shell */ }
    window.location.reload();
  };
  void limpiar();
  return true;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { fallo: boolean; error: Error | null }> {
  state = { fallo: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { fallo: true, error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error no controlado en la aplicación', error, info.componentStack);
    if (esFalloDeAsset(error)) limpiarAssetsYRecargar();
  }

  render() {
    if (!this.state.fallo) return this.props.children;
    const asset = esFalloDeAsset(this.state.error);
    return <div className="app-error-fallback" role="alert"><div><span className="eyebrow">Burrito Parrilla</span><h1>No se pudo mostrar esta pantalla</h1><p>{asset ? 'La aplicación se actualizó. Estamos limpiando la versión anterior para continuar.' : 'Tus datos no se modificaron. Recarga la aplicación para continuar.'}</p><button className="btn btn-primary" onClick={() => { if (!limpiarAssetsYRecargar()) window.location.reload(); }}>{asset ? 'Actualizar aplicación' : 'Recargar aplicación'}</button></div></div>;
  }
}

/** Un error de una ruta no debe dejar sin menú ni acceso al resto de la aplicación. */
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };

  static getDerivedStateFromError() { return { fallo: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error al mostrar una pantalla', error, info.componentStack);
    if (esFalloDeAsset(error)) limpiarAssetsYRecargar();
  }

  render() {
    if (!this.state.fallo) return this.props.children;
    return <section className="workspace-card" role="alert"><div className="empty-state"><strong>No se pudo cargar esta sección</strong><span>Tus datos no se modificaron. Intenta abrirla de nuevo o vuelve al inicio.</span><div className="button-row"><button className="btn btn-secondary" onClick={() => this.setState({ fallo: false })}>Reintentar</button><button className="btn btn-primary" onClick={() => { window.location.assign('/'); }}>Ir al inicio</button></div></div></section>;
  }
}

function SoloRol({ children, roles }: { children: JSX.Element; roles: Rol[] }) {
  const { usuario } = useAuth();
  if (usuario && !roles.includes(usuario.rol)) return <Navigate to="/" replace />;
  return children;
}

function AppBody() {
  const { usuario, cargando, recienEntro, consumirRecienEntro } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  usePageTitle(usuario);

  // Tras un login explícito, siempre al Inicio.
  useEffect(() => {
    if (recienEntro) {
      navigate('/', { replace: true });
      consumirRecienEntro();
    }
  }, [recienEntro, navigate, consumirRecienEntro]);

  if (cargando) {
    return (
      <div className="app-shell">
        <Spinner />
      </div>
    );
  }
  if (!usuario) return <Suspense fallback={<div className="app-shell"><Spinner label="Preparando acceso…" /></div>}><Login /></Suspense>;

  return (
    <Suspense fallback={<div className="app-shell"><Spinner label="Preparando menú…" /></div>}>
      <Shell>
      <ScreenErrorBoundary key={pathname}>
      <Suspense fallback={<div className="route-skeleton" role="status" aria-label="Cargando pantalla"><span /><span /><span /></div>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/inventario" element={<Navigate to="/semana/inventario" replace />} />
        <Route path="/conteos" element={<SoloRol roles={['admin', 'encargado_bodega']}><ConteosInventario /></SoloRol>} />
        <Route path="/pedidos" element={<Navigate to="/semana/ventas" replace />} />
        <Route path="/semana" element={<SemanaOperacion />} />
        <Route path="/semana/:paso" element={<SemanaOperacion />} />
        <Route path="/compras" element={<Navigate to="/semana/compras" replace />} />
        <Route path="/produccion" element={<Navigate to="/semana/produccion" replace />} />
        <Route path="/rutas" element={<SoloRol roles={['admin']}><OperacionAdmin seccion="rutas" /></SoloRol>} />
        <Route path="/facturacion" element={<SoloRol roles={['admin']}><Facturacion /></SoloRol>} />
        <Route path="/operacion" element={<Navigate to="/semana" replace />} />
        <Route path="/distribucion" element={<Navigate to="/semana/ventas" replace />} />
        <Route path="/bodega" element={<Navigate to="/semana/ventas" replace />} />
        <Route path="/ruta" element={<Navigate to="/semana/ventas" replace />} />
        <Route path="/recepcion" element={<Navigate to="/semana/ventas" replace />} />
        <Route path="/incidencias" element={<SoloRol roles={['admin']}><Incidencias /></SoloRol>} />
        <Route path="/configuracion" element={<SoloRol roles={['admin']}><Configuracion /></SoloRol>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </ScreenErrorBoundary>
      </Shell>
    </Suspense>
  );
}

function debeMostrarSplash() {
  try {
    const conexion = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (conexion?.saveData || ['slow-2g', '2g'].includes(conexion?.effectiveType ?? '')) return false;
    return !sessionStorage.getItem('bpm-splash');
  } catch { return true; }
}

export default function App() {
  const [splash, setSplash] = useState(debeMostrarSplash);
  const [serviciosListos, setServiciosListos] = useState(false);
  useEffect(() => {
    // La marca sobrevive una sola recarga para evitar un loop si el deploy todavía
    // está propagándose; se libera después de que la app tuvo tiempo de estabilizarse.
    const id = globalThis.setTimeout(() => {
      try { sessionStorage.removeItem(ASSET_RECOVERY_KEY); } catch { /* almacenamiento bloqueado */ }
    }, 10_000);
    return () => globalThis.clearTimeout(id);
  }, []);
  useEffect(() => {
    const mostrar = () => setServiciosListos(true);
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(mostrar, { timeout: 2_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(mostrar, 500);
    return () => globalThis.clearTimeout(id);
  }, []);
  return (
    <AppErrorBoundary>
      {serviciosListos && <Suspense fallback={null}><UpdateBanner /></Suspense>}
      {splash && (
        <SplashIntro
          onDone={() => {
            try { sessionStorage.setItem('bpm-splash', '1'); } catch { /* almacenamiento bloqueado */ }
            setSplash(false);
          }}
        />
      )}
      <DialogProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <SemanaProvider>
                <AppBody />
              </SemanaProvider>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </DialogProvider>
    </AppErrorBoundary>
  );
}
