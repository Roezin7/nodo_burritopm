import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useAuth, type UbicacionAsignada } from '../../auth';
import { useToast, mensajeError } from '../../toast';
import { FlujoStepper } from '../../flujo';
import UbicacionPicker, { type OpcionUbic } from '../../components/UbicacionPicker';
import Spinner from '../../components/Spinner';
import CollapsibleSection from '../../components/CollapsibleSection';
import EstadoChip from './EstadoChip';
import HoyCard from './HoyCard';
import StockActual from './StockActual';
import SucursalesOverview from './SucursalesOverview';
import AccionesBodega from './AccionesBodega';
import RegistrarSalida from './RegistrarSalida';
import AgregarEntrada from './AgregarEntrada';
import Editor from './Editor';
import { fechaLarga, type InventarioDetalle, type InventarioResumen, type Sesion } from './types';

export default function Inventario() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'admin';
  const toast = useToast();

  const [ubicaciones, setUbicaciones] = useState<UbicacionAsignada[]>([]);
  const [ubicId, setUbicId] = useState<string>('');
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [inventarios, setInventarios] = useState<InventarioResumen[]>([]);
  const [detalle, setDetalle] = useState<InventarioDetalle | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  // Admin: vista central de bodega (default) o revisión de sucursales.
  const [modo, setModo] = useState<'bodega' | 'sucursales'>('bodega');
  const [stockKey, setStockKey] = useState(0); // fuerza recarga del stock tras una entrada/salida
  const [entradaAbierta, setEntradaAbierta] = useState(false); // panel "Registrar entrada"
  const [salidaAbierta, setSalidaAbierta] = useState(false); // panel "Registrar salida"
  const [searchParams] = useSearchParams();

  const bodega = ubicaciones.find((u) => u.tipo === 'bodega') ?? null;
  const ubicActiva = ubicaciones.find((u) => String(u.id) === ubicId) ?? null;
  // Lista de sucursales para el destino de una salida/transferencia. El admin ya trae todas las
  // ubicaciones; bodega y reparto solo tiene asignada su bodega, así que se piden aparte.
  const [sucursalesDestino, setSucursalesDestino] = useState<UbicacionAsignada[]>([]);
  const sucursales = esAdmin ? ubicaciones.filter((u) => u.tipo === 'sucursal') : sucursalesDestino;
  useEffect(() => {
    if (esAdmin) return;
    api<{ id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }[]>('/ubicaciones')
      .then((us) => setSucursalesDestino(us.filter((u) => u.activo && u.tipo === 'sucursal')))
      .catch((e) => toast.error(mensajeError(e, 'No se pudieron cargar las sucursales destino.')));
  }, [esAdmin]);

  // Cargar ubicaciones disponibles según rol. El admin entra centrado en la Bodega.
  useEffect(() => {
    async function cargarUbic() {
      try {
        if (esAdmin) {
          const us = await api<{ id: number; nombre: string; tipo: 'bodega' | 'sucursal'; activo: boolean }[]>('/ubicaciones');
          const activas = us.filter((u) => u.activo).map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo, activo: u.activo }));
          setUbicaciones(activas);
          const bod = activas.find((u) => u.tipo === 'bodega');
          setUbicId(String((bod ?? activas[0])?.id ?? ''));
        } else {
          const asignadas = usuario?.ubicaciones ?? [];
          setUbicaciones(asignadas);
          if (asignadas[0]) setUbicId(String(asignadas[0].id));
        }
      } catch {
        setError('No se pudieron cargar las ubicaciones');
      } finally {
        setCargando(false);
      }
    }
    void cargarUbic();
  }, [esAdmin, usuario]);

  // Deep-link desde el Tablero del ciclo: /inventario?ubicacion=ID abre esa sucursal directo.
  useEffect(() => {
    const u = searchParams.get('ubicacion');
    if (!u) return;
    const suc = ubicaciones.find((x) => String(x.id) === u && x.tipo === 'sucursal');
    if (suc) { setModo('sucursales'); setUbicId(u); }
  }, [searchParams, ubicaciones]);

  // Si el usuario cambia de ubicación rápido, ignora respuestas de peticiones ya obsoletas
  // (si no, una respuesta lenta de la ubicación anterior podía pisar los datos de la nueva).
  const ultimaPeticion = useRef('');
  async function cargarUbicacion(uid: string) {
    if (!uid) return;
    ultimaPeticion.current = uid;
    setError('');
    try {
      const [ses, lista] = await Promise.all([
        api<Sesion>(`/conteos/sesion?ubicacion=${uid}`),
        api<InventarioResumen[]>(`/conteos?ubicacion=${uid}`),
      ]);
      if (ultimaPeticion.current !== uid) return;
      setSesion(ses);
      setInventarios(lista);
    } catch (e) {
      if (ultimaPeticion.current !== uid) return;
      setError(e instanceof ApiError ? e.message : 'Error al cargar el inventario');
    }
  }
  useEffect(() => { setDetalle(null); void cargarUbicacion(ubicId); }, [ubicId]);

  async function abrir(id: number) {
    setError('');
    try {
      setDetalle(await api<InventarioDetalle>(`/conteos/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error al abrir el inventario');
    }
  }

  // Abre/continúa el inventario de hoy (se crea solo en días programados).
  async function tomarHoy() {
    setBusy(true); setError('');
    try {
      const r = await api<{ id: number }>('/conteos/abrir', { method: 'POST', body: { ubicacion_id: Number(ubicId) } });
      await abrir(r.id);
      await cargarUbicacion(ubicId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo abrir el inventario');
    } finally {
      setBusy(false);
    }
  }

  if (cargando) return <div className="page"><Spinner /></div>;

  if (detalle) {
    return <Editor detalle={detalle} onSalir={() => { setDetalle(null); void cargarUbicacion(ubicId); }} onRecargar={() => abrir(detalle.id)} />;
  }

  const opciones: OpcionUbic[] = ubicaciones.map((u) => ({ id: u.id, nombre: u.nombre, tipo: u.tipo }));
  const t = q.trim().toLowerCase();
  const histFiltrado = inventarios.filter((c) => !t || fechaLarga(c.fecha).toLowerCase().includes(t) || c.estado.toLowerCase().includes(t));

  // Solo el historial de inventarios (lista). Se reutiliza en bodega y sucursales.
  const renderHistorial = (esPedido = false) => (
    <CollapsibleSection title={esPedido ? 'Historial de pedidos' : 'Historial de inventarios'} count={histFiltrado.length} defaultOpen={false}>
      {inventarios.length > 8 && (
        <input className="inv-search" type="search" placeholder="Buscar por fecha…" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      {histFiltrado.length === 0 ? (
        <p className="muted">{inventarios.length === 0 ? 'Aún no hay inventarios en esta ubicación.' : 'Sin coincidencias.'}</p>
      ) : (
        <div className="lista-ubicaciones">
          {histFiltrado.map((c) => (
            <button key={c.id} className="card card-click" onClick={() => void abrir(c.id)}>
              <div className="ubic-row">
                <div>
                  <strong className="inv-fecha-titulo">{esPedido ? 'Pedido' : 'Inventario'} {fechaLarga(c.fecha)}</strong>{' '}
                  <EstadoChip estado={c.estado} />
                  <div className="muted">{c.contadas}/{c.total_lineas} contados</div>
                </div>
                <span className="muted">›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );

  // Sesión de hoy + historial (sucursal/personal). `promo`=false usa el aviso discreto.
  const renderSeccion = (promo: boolean, esPedido = false) => (
    <>
      {sesion && <HoyCard sesion={sesion} esAdmin={esAdmin} esPedido={esPedido} discreto={!promo} busy={busy} onTomar={() => void tomarHoy()} onAbrir={abrir} />}
      {renderHistorial(esPedido)}
    </>
  );

  // ── Admin: bodega central (gestiona) + revisión de sucursales ──────────────
  if (esAdmin) {
    const enSucursal = modo === 'sucursales' && ubicId && bodega && ubicId !== String(bodega.id);
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Inventario</h1>
            <p className="page-sub">Gestiona el inventario de la bodega central y revisa el de cada sucursal.</p>
          </div>
        </header>
        <FlujoStepper activo="conteo" />

        <div className="tabs">
          <button className={modo === 'bodega' ? 'tab tab--on' : 'tab'} onClick={() => { setModo('bodega'); if (bodega) setUbicId(String(bodega.id)); }}>Bodega central</button>
          <button className={modo === 'sucursales' ? 'tab tab--on' : 'tab'} onClick={() => { setModo('sucursales'); setUbicId(''); }}>Sucursales</button>
        </div>
        {error && <p className="error-msg">{error}</p>}

        {modo === 'bodega' ? (
          bodega ? (
            <>
              <StockActual key={`${bodega.id}:${stockKey}`} ubicId={String(bodega.id)} nombre={bodega.nombre} />
              <AccionesBodega
                busy={busy}
                entradaAbierta={entradaAbierta}
                salidaAbierta={salidaAbierta}
                onToggleEntrada={() => { setEntradaAbierta((v) => !v); setSalidaAbierta(false); }}
                onToggleSalida={() => { setSalidaAbierta((v) => !v); setEntradaAbierta(false); }}
                onTomarInventario={() => void tomarHoy()}
              />
              <AgregarEntrada
                abierto={entradaAbierta}
                onClose={() => setEntradaAbierta(false)}
                onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(String(bodega.id)); }}
              />
              <RegistrarSalida
                abierto={salidaAbierta}
                sucursales={sucursales}
                onClose={() => setSalidaAbierta(false)}
                onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(String(bodega.id)); }}
              />
              {renderHistorial()}
            </>
          ) : (
            <p className="muted">No hay una bodega central activa.</p>
          )
        ) : enSucursal ? (
          <>
            <button className="link-btn" onClick={() => setUbicId('')}>← Todas las sucursales</button>
            {renderSeccion(true, true)}
          </>
        ) : (
          <SucursalesOverview sucursales={sucursales} onElegir={setUbicId} />
        )}
      </div>
    );
  }

  // ── Bodega y reparto: gestiona su bodega (sin conteo programado, es a demanda) ──────
  const esBodegaRol = ubicActiva?.tipo === 'bodega';
  if (esBodegaRol) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Inventario</h1>
            <p className="page-sub">Registra entradas, salidas y corrige cantidades cuando haga falta.</p>
          </div>
        </header>
        <FlujoStepper activo="conteo" />
        {error && <p className="error-msg">{error}</p>}
        <StockActual key={`${ubicId}:${stockKey}`} ubicId={ubicId} nombre={ubicActiva.nombre} />
        <AccionesBodega
          busy={busy}
          entradaAbierta={entradaAbierta}
          salidaAbierta={salidaAbierta}
          onToggleEntrada={() => { setEntradaAbierta((v) => !v); setSalidaAbierta(false); }}
          onToggleSalida={() => { setSalidaAbierta((v) => !v); setEntradaAbierta(false); }}
          onTomarInventario={() => void tomarHoy()}
        />
        <AgregarEntrada
          abierto={entradaAbierta}
          onClose={() => setEntradaAbierta(false)}
          onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(ubicId); }}
        />
        <RegistrarSalida
          abierto={salidaAbierta}
          sucursales={sucursales}
          onClose={() => setSalidaAbierta(false)}
          onHecho={() => { setStockKey((k) => k + 1); void cargarUbicacion(ubicId); }}
        />
        {renderHistorial()}
      </div>
    );
  }

  // ── Sucursal: su propio pedido programado ───────────────────────────────────
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inventario</h1>
          <p className="page-sub">Elige cuánto producto quieres que te envíen.</p>
        </div>
      </header>
      <FlujoStepper activo="conteo" />

      {ubicaciones.length === 0 ? (
        <p className="muted">No tienes ubicaciones asignadas. Pide a un administrador que te asigne una.</p>
      ) : (
        <>
          <UbicacionPicker label="Ubicación" opciones={opciones} value={ubicId} onChange={setUbicId} />
          {error && <p className="error-msg">{error}</p>}
          {renderSeccion(true, true)}
        </>
      )}
    </div>
  );
}
