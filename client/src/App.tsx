import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth, type Rol } from './auth';
import Login from './screens/Login';
import Home from './screens/Home';
import Configuracion from './screens/config/Configuracion';
import OfflineBanner from './OfflineBanner';
import Shell from './Shell';
import SplashIntro from './brand/SplashIntro';
import { useState, type JSX } from 'react';

function SoloRol({ children, roles }: { children: JSX.Element; roles: Rol[] }) {
  const { usuario } = useAuth();
  if (usuario && !roles.includes(usuario.rol)) return <Navigate to="/" replace />;
  return children;
}

function AppBody() {
  const { usuario, cargando } = useAuth();

  if (cargando) {
    return (
      <div className="app-shell">
        <p className="muted">Cargando…</p>
      </div>
    );
  }
  if (!usuario) return <Login />;

  return (
    <Shell>
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<Home />} />
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
      <AuthProvider>
        <BrowserRouter>
          <AppBody />
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}
