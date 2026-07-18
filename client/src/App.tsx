import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, type Rol } from './auth';
import { ToastProvider } from './toast';
import Login from './screens/Login';
import Home from './screens/Home';
import ConteosInventario from './screens/inventario/Inventario';
import Incidencias from './screens/incidencias/Incidencias';
import Configuracion from './screens/config/Configuracion';
import OfflineBanner from './OfflineBanner';
import Shell from './Shell';
import SplashIntro from './brand/SplashIntro';
import Spinner from './components/Spinner';
import OperacionAdmin from './screens/operacion/OperacionAdmin';
import SemanaOperacion from './screens/operacion/SemanaOperacion';
import { Component, useState, useEffect, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { OperacionConfigProvider } from './operacion-config';

class AppErrorBoundary extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };

  static getDerivedStateFromError() { return { fallo: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error no controlado en la aplicación', error, info.componentStack);
  }

  render() {
    if (!this.state.fallo) return this.props.children;
    return <div className="app-error-fallback" role="alert"><div><span className="eyebrow">Burrito Parrilla</span><h1>No se pudo mostrar esta pantalla</h1><p>Tus datos no se modificaron. Recarga la aplicación para continuar.</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Recargar aplicación</button></div></div>;
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
  if (!usuario) return <Login />;

  return (
    <Shell>
      <OfflineBanner />
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
        <Route path="/facturacion" element={<Navigate to="/semana/cierre" replace />} />
        <Route path="/operacion" element={<Navigate to="/semana" replace />} />
        <Route path="/distribucion" element={<Navigate to="/semana/preparacion" replace />} />
        <Route path="/bodega" element={<Navigate to="/semana/despacho" replace />} />
        <Route path="/ruta" element={<Navigate to="/semana/reparto" replace />} />
        <Route path="/recepcion" element={<Navigate to="/semana/recepcion" replace />} />
        <Route path="/incidencias" element={<SoloRol roles={['admin']}><Incidencias /></SoloRol>} />
        <Route path="/configuracion" element={<SoloRol roles={['admin']}><Configuracion /></SoloRol>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  const [splash, setSplash] = useState(() => !sessionStorage.getItem('bpm-splash'));
  return (
    <>
      {splash && (
        <SplashIntro
          onDone={() => {
            sessionStorage.setItem('bpm-splash', '1');
            setSplash(false);
          }}
        />
      )}
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <OperacionConfigProvider>
              <AppErrorBoundary><AppBody /></AppErrorBoundary>
            </OperacionConfigProvider>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </>
  );
}
