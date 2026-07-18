import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Ubicaciones from './Ubicaciones';
import Usuarios from './Usuarios';
import Categorias from './Categorias';
import Unidades from './Unidades';
import Productos from './Productos';
import StockObjetivo from './StockObjetivo';
import Spinner from '../../components/Spinner';
import { useOperacionConfig } from '../../operacion-config';

// Configuración (admin). Se organiza por pestañas; cada bloque del proyecto agrega una.
type Tab = 'ubicaciones' | 'usuarios' | 'categorias' | 'unidades' | 'productos' | 'stock' | 'operacion';

const TABS: { clave: Tab; label: string }[] = [
  { clave: 'ubicaciones', label: 'Restaurantes y bodegas' },
  { clave: 'usuarios', label: 'Accesos' },
  { clave: 'categorias', label: 'Categorías' },
  { clave: 'unidades', label: 'Unidades' },
  { clave: 'productos', label: 'Productos' },
  { clave: 'stock', label: 'Mínimos por almacén' },
  { clave: 'operacion', label: 'Operación' },
];

const DIAS = [
  { n: 1, label: 'Lun' },
  { n: 2, label: 'Mar' },
  { n: 3, label: 'Mié' },
  { n: 4, label: 'Jue' },
  { n: 5, label: 'Vie' },
  { n: 6, label: 'Sáb' },
  { n: 0, label: 'Dom' },
];

/** Ajustes de operación: verificación de carga y días de pedido/conteo. */
const AUTO_CIERRE_OPCIONES = [
  { h: 0, label: 'Nunca' },
  { h: 12, label: '12 h' },
  { h: 24, label: '24 h' },
  { h: 48, label: '48 h' },
];

function Operacion() {
  const { repartoHabilitado, cargando: cargandoConfig, establecerRepartoHabilitado } = useOperacionConfig();
  const [verif, setVerif] = useState<boolean | null>(null);
  const [dias, setDias] = useState<number[]>([]);
  const [autoCierre, setAutoCierre] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ verificacion_carga: boolean; inventario_dias: number[]; auto_cierre_horas: number }>('/negocio')
      .then((n) => { setVerif(n.verificacion_carga); setDias(n.inventario_dias ?? []); setAutoCierre(n.auto_cierre_horas ?? 0); })
      .catch(() => setError('No se pudo cargar la configuración'));
  }, []);

  async function guardar(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError('');
    try {
      await api('/negocio', { method: 'PATCH', body });
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo guardar');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function alternarVerif(valor: boolean) {
    const anterior = verif ?? false;
    setVerif(valor);
    if (!await guardar({ verificacion_carga: valor })) setVerif(anterior);
  }

  async function alternarDia(n: number) {
    const next = dias.includes(n) ? dias.filter((d) => d !== n) : [...dias, n];
    const anterior = dias;
    setDias(next);
    if (!await guardar({ inventario_dias: next })) setDias(anterior);
  }

  async function elegirAutoCierre(h: number) {
    const anterior = autoCierre;
    setAutoCierre(h);
    if (!await guardar({ auto_cierre_horas: h })) setAutoCierre(anterior);
  }

  async function alternarReparto(valor: boolean) {
    establecerRepartoHabilitado(valor);
    if (!await guardar({ reparto_habilitado: valor })) establecerRepartoHabilitado(!valor);
  }

  if (verif === null || cargandoConfig) return <Spinner />;
  return (
    <>
      <div className="card">
        <div className="cfg-switch">
          <div>
            <strong>Seguimiento de reparto</strong>
            <p className="muted" style={{ margin: '0.2rem 0 0' }}>
              {repartoHabilitado
                ? 'Muestra Reparto entre Despacho y Recepción para registrar el recorrido y sus paradas.'
                : 'Desactivado: al confirmar el despacho, el pedido pasa directamente a Recepción.'}
            </p>
          </div>
          <button
            type="button"
            className={`switch ${repartoHabilitado ? 'switch--on' : ''}`}
            disabled={busy}
            aria-label="Activar seguimiento de reparto"
            aria-pressed={repartoHabilitado}
            onClick={() => void alternarReparto(!repartoHabilitado)}
          >
            <span className="switch-knob" />
          </button>
        </div>
      </div>

      <div className="card">
        <strong>Días de conteo físico</strong>
        <p className="muted" style={{ margin: '0.2rem 0 0.7rem' }}>
          Programa cuándo se solicita una conciliación física de bodega. Las fechas de pedido y entrega se controlan desde Rutas.
        </p>
        <div className="dias-selector">
          {DIAS.map((d) => (
            <button
              key={d.n}
              type="button"
              className={`dia-pill ${dias.includes(d.n) ? 'dia-pill--on' : ''}`}
              disabled={busy}
              aria-pressed={dias.includes(d.n)}
              onClick={() => void alternarDia(d.n)}
            >
              {d.label}
            </button>
          ))}
        </div>
        {dias.length === 0 && <p className="muted" style={{ marginTop: '0.6rem' }}>Sin días: no se habilita solo (el admin puede abrirlo cuando quiera).</p>}
      </div>

      <div className="card">
        <div className="cfg-switch">
          <div>
            <strong>Verificación de carga</strong>
            <p className="muted" style={{ margin: '0.2rem 0 0' }}>
              Si está activa, Bodega confirma una revisión de 1 toque antes de enviar el pedido a Reparto o Recepción.
            </p>
          </div>
          <button
            type="button"
            className={`switch ${verif ? 'switch--on' : ''}`}
            disabled={busy}
            aria-pressed={verif}
            onClick={() => void alternarVerif(!verif)}
          >
            <span className="switch-knob" />
          </button>
        </div>
      </div>

      <div className="card">
        <strong>Auto-cierre de recepción</strong>
        <p className="muted" style={{ margin: '0.2rem 0 0.7rem' }}>
          Si una sucursal no confirma su recepción, el pedido se cierra solo pasado este tiempo (se da por recibido lo enviado) para liberar el inventario en tránsito de la bodega.
        </p>
        <div className="dias-selector">
          {AUTO_CIERRE_OPCIONES.map((o) => (
            <button
              key={o.h}
              type="button"
              className={`dia-pill ${autoCierre === o.h ? 'dia-pill--on' : ''}`}
              disabled={busy}
              aria-pressed={autoCierre === o.h}
              onClick={() => void elegirAutoCierre(o.h)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {autoCierre === 0 && <p className="muted" style={{ marginTop: '0.6rem' }}>Desactivado: las recepciones sin confirmar quedan en tránsito hasta que alguien las cierre a mano.</p>}
      </div>
      {error && <p className="error-msg">{error}</p>}
    </>
  );
}

export default function Configuracion() {
  const [tab, setTab] = useState<Tab>('ubicaciones');

  return (
    <div className="page">
      <header className="page-head">
        <div>
            <span className="eyebrow">Administración del sistema</span>
            <h1>Configuración</h1>
            <p className="page-sub">Empresas, restaurantes, accesos, productos y reglas de operación.</p>
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
