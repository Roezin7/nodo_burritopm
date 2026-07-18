import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import Ubicaciones from './Ubicaciones';
import Usuarios from './Usuarios';
import Categorias from './Categorias';
import Unidades from './Unidades';
import Productos from './Productos';
import StockObjetivo from './StockObjetivo';
import Proveedores from './Proveedores';
import Spinner from '../../components/Spinner';
import { useOperacionConfig } from '../../operacion-config';
import { Link } from 'react-router-dom';

// Configuración (admin). Se organiza por pestañas; cada bloque del proyecto agrega una.
type Tab = 'ubicaciones' | 'usuarios' | 'proveedores' | 'categorias' | 'unidades' | 'productos' | 'stock' | 'operacion';

const GRUPOS: { titulo: string; items: { clave: Tab; label: string; descripcion: string }[] }[] = [
  { titulo: 'Organización', items: [
    { clave: 'ubicaciones', label: 'Ubicaciones', descripcion: 'Restaurantes y almacenes' },
    { clave: 'usuarios', label: 'Accesos', descripcion: 'Usuarios, roles y PIN' },
  ] },
  { titulo: 'Catálogo', items: [
    { clave: 'productos', label: 'Productos', descripcion: 'Carne y desechables' },
    { clave: 'proveedores', label: 'Proveedores', descripcion: 'Proveedores activos' },
    { clave: 'categorias', label: 'Categorías', descripcion: 'Orden del catálogo' },
    { clave: 'unidades', label: 'Unidades', descripcion: 'Caja, pieza y peso' },
  ] },
  { titulo: 'Reglas', items: [
    { clave: 'stock', label: 'Productos por ubicación', descripcion: 'Disponibilidad y mínimos' },
    { clave: 'operacion', label: 'Flujo semanal', descripcion: 'Despacho, reparto y cierre' },
  ] },
];
const ITEMS = GRUPOS.flatMap((grupo) => grupo.items);

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
      <div className="settings-card">
        <div className="cfg-switch">
          <div>
            <strong>Seguimiento de reparto</strong>
            <p>{repartoHabilitado ? 'Despacho → Reparto → Recepción' : 'Despacho → Recepción'}</p>
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

      <div className="settings-card">
        <strong>Días de conteo físico</strong>
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
        {dias.length === 0 && <small>Sin programación automática</small>}
      </div>

      <div className="settings-card">
        <div className="cfg-switch">
          <div>
            <strong>Verificación de carga</strong>
            <p>Revisión antes de enviar el pedido</p>
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

      <div className="settings-card">
        <strong>Auto-cierre de recepción</strong>
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
        {autoCierre === 0 && <small>Las recepciones quedan pendientes hasta confirmarlas</small>}
      </div>
      {error && <p className="error-msg">{error}</p>}
    </>
  );
}

export default function Configuracion() {
  const [tab, setTab] = useState<Tab>('ubicaciones');
  const actual = ITEMS.find((item) => item.clave === tab)!;

  return (
    <div className="page">
      <header className="page-head">
        <div>
            <span className="eyebrow">Administración</span>
            <h1>Configuración</h1>
        </div>
      </header>

      <div className="configuration-layout">
        <nav className="configuration-nav" aria-label="Secciones de configuración">
          {GRUPOS.map((grupo) => <div key={grupo.titulo}><span>{grupo.titulo}</span>{grupo.items.map((item) => <button key={item.clave} className={tab === item.clave ? 'is-active' : ''} onClick={() => setTab(item.clave)}><strong>{item.label}</strong><small>{item.descripcion}</small></button>)}</div>)}
        </nav>
        <main className="configuration-content">
          <header className="configuration-content__head"><div><h2>{actual.label}</h2><p>{actual.descripcion}</p></div>{tab === 'operacion' && <Link className="btn btn-secondary btn-sm" to="/rutas">Editar rutas</Link>}</header>
          <div className="tab-body">
            {tab === 'ubicaciones' && <Ubicaciones />}
            {tab === 'usuarios' && <Usuarios />}
            {tab === 'proveedores' && <Proveedores />}
            {tab === 'categorias' && <Categorias />}
            {tab === 'unidades' && <Unidades />}
            {tab === 'productos' && <Productos />}
            {tab === 'stock' && <StockObjetivo />}
            {tab === 'operacion' && <Operacion />}
          </div>
        </main>
      </div>
    </div>
  );
}
