import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Ubicaciones from './Ubicaciones';
import Usuarios from './Usuarios';
import Categorias from './Categorias';
import Unidades from './Unidades';
import Productos from './Productos';
import StockObjetivo from './StockObjetivo';

// Configuración (admin). Se organiza por pestañas; cada bloque del proyecto agrega una.
type Tab = 'ubicaciones' | 'usuarios' | 'categorias' | 'unidades' | 'productos' | 'stock' | 'operacion';

const TABS: { clave: Tab; label: string }[] = [
  { clave: 'ubicaciones', label: 'Ubicaciones' },
  { clave: 'usuarios', label: 'Usuarios' },
  { clave: 'categorias', label: 'Categorías' },
  { clave: 'unidades', label: 'Unidades' },
  { clave: 'productos', label: 'Productos' },
  { clave: 'stock', label: 'Stock objetivo' },
  { clave: 'operacion', label: 'Operación' },
];

/** Ajustes de operación: por ahora, la verificación opcional de carga. */
function Operacion() {
  const [verif, setVerif] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ verificacion_carga: boolean }>('/negocio').then((n) => setVerif(n.verificacion_carga)).catch(() => setError('No se pudo cargar la configuración'));
  }, []);

  async function alternar(valor: boolean) {
    setBusy(true); setError('');
    try {
      await api('/negocio', { method: 'PATCH', body: { verificacion_carga: valor } });
      setVerif(valor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  if (verif === null) return <p className="muted">Cargando…</p>;
  return (
    <div className="card">
      <div className="cfg-switch">
        <div>
          <strong>Verificación de carga</strong>
          <p className="muted" style={{ margin: '0.2rem 0 0' }}>
            Si está activa, Bodega y reparto confirma una revisión de 1 toque antes de que el camión salga a ruta.
          </p>
        </div>
        <button
          type="button"
          className={`switch ${verif ? 'switch--on' : ''}`}
          disabled={busy}
          aria-pressed={verif}
          onClick={() => void alternar(!verif)}
        >
          <span className="switch-knob" />
        </button>
      </div>
      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}

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
        {tab === 'usuarios' && <Usuarios />}
        {tab === 'categorias' && <Categorias />}
        {tab === 'unidades' && <Unidades />}
        {tab === 'productos' && <Productos />}
        {tab === 'stock' && <StockObjetivo />}
        {tab === 'operacion' && <Operacion />}
      </div>
    </div>
  );
}
