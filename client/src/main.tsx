import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './design-system/redesign.css';
import { esFalloDeAsset, limpiarAssetsYRecargar } from './assetRecovery';
import { iniciarOffline } from './offline';
import { iniciarActualizacionPWA } from './pwaUpdate';

// Vite emite este evento cuando una importación dinámica apunta a un chunk retirado
// por un deploy. Se atiende antes de que React deje la pantalla en un error permanente.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  void limpiarAssetsYRecargar();
});
window.addEventListener('error', (event) => {
  if (esFalloDeAsset(event.error ?? event.message)) void limpiarAssetsYRecargar();
});
window.addEventListener('unhandledrejection', (event) => {
  if (esFalloDeAsset(event.reason)) {
    event.preventDefault();
    void limpiarAssetsYRecargar();
  }
});

// La cola offline y la búsqueda de actualizaciones no bloquean el primer render. En redes
// lentas se inicializan después de que la interfaz ya puede usarse; sus módulos ya están
// en el app-shell para que un deploy no deje una importación diferida rota.
function iniciarServiciosEnSegundoPlano() {
  const iniciar = () => {
    iniciarOffline();
    iniciarActualizacionPWA();
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(iniciar, { timeout: 2_000 });
  } else {
    globalThis.setTimeout(iniciar, 500);
  }
}

if (document.readyState === 'complete') iniciarServiciosEnSegundoPlano();
else window.addEventListener('load', iniciarServiciosEnSegundoPlano, { once: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
