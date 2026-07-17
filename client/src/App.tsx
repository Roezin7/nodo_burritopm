import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, type Rol } from './auth';
import { ToastProvider } from './toast';
import Login from './screens/Login';
import Home from './screens/Home';
import ConteosInventario from './screens/inventario/Inventario';
import Distribucion from './screens/distribucion/Distribucion';
import Bodega from './screens/bodega/Bodega';
import Ruta from './screens/ruta/Ruta';
import Recepcion from './screens/recepcion/Recepcion';
import Incidencias from './screens/incidencias/Incidencias';
import Configuracion from './screens/config/Configuracion';
import OfflineBanner from './OfflineBanner';
import Shell from './Shell';
import SplashIntro from './brand/SplashIntro';
import Spinner from './components/Spinner';
import Pedidos from './screens/operacion/Pedidos';
import OperacionAdmin from './screens/operacion/OperacionAdmin';
import InventarioOperacion from './screens/operacion/InventarioOperacion';
import { useState, useEffect, type JSX } from 'react';

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
        <Route path="/inventario" element={<SoloRol roles={['admin', 'encargado_bodega']}><InventarioOperacion /></SoloRol>} />
        <Route path="/conteos" element={<SoloRol roles={['admin', 'encargado_bodega']}><ConteosInventario /></SoloRol>} />
        <Route path="/pedidos" element={<SoloRol roles={['admin', 'encargado_sucursal']}><Pedidos /></SoloRol>} />
        <Route path="/compras" element={<SoloRol roles={['admin']}><OperacionAdmin seccion="compras" /></SoloRol>} />
        <Route path="/produccion" element={<SoloRol roles={['admin']}><OperacionAdmin seccion="produccion" /></SoloRol>} />
        <Route path="/rutas" element={<SoloRol roles={['admin']}><OperacionAdmin seccion="rutas" /></SoloRol>} />
        <Route path="/facturacion" element={<SoloRol roles={['admin']}><OperacionAdmin seccion="cierre" /></SoloRol>} />
        <Route path="/operacion" element={<Navigate to="/compras" replace />} />
        <Route path="/distribucion" element={<SoloRol roles={['admin']}><Distribucion /></SoloRol>} />
        <Route path="/bodega" element={<SoloRol roles={['admin', 'encargado_bodega']}><Bodega /></SoloRol>} />
        <Route path="/ruta" element={<SoloRol roles={['admin', 'encargado_bodega']}><Ruta /></SoloRol>} />
        <Route path="/recepcion" element={<SoloRol roles={['admin', 'encargado_sucursal']}><Recepcion /></SoloRol>} />
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
            <AppBody />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </>
  );
}
