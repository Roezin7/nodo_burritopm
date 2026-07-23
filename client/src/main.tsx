import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './design-system/redesign.css';

// La cola offline y la búsqueda de actualizaciones no bloquean el primer render. En redes
// lentas se descargan después de que la interfaz ya puede usarse.
function iniciarServiciosEnSegundoPlano() {
  const iniciar = () => {
    void import('./offline').then(({ iniciarOffline }) => iniciarOffline());
    void import('./pwaUpdate').then(({ iniciarActualizacionPWA }) => iniciarActualizacionPWA());
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
