import { useState } from 'react';
import Ubicaciones from './Ubicaciones';

// Configuración (admin). Se organiza por pestañas; cada bloque del proyecto agrega una.
type Tab = 'ubicaciones';

const TABS: { clave: Tab; label: string }[] = [
  { clave: 'ubicaciones', label: 'Ubicaciones' },
];

export default function Configuracion() {
  const [tab, setTab] = useState<Tab>('ubicaciones');

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Configuración</h1>
          <p className="page-sub">Bodega, sucursales y catálogo.</p>
        </div>
      </header>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.clave}
            className={tab === t.clave ? 'tab tab--on' : 'tab'}
            onClick={() => setTab(t.clave)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tab-body">
        {tab === 'ubicaciones' && <Ubicaciones />}
      </div>
    </div>
  );
}
