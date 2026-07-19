import Spinner from '../../../components/Spinner';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { nombreEnVenta } from '../../../operationOrder';
import { etiquetaRango, type SemanaSeleccionada } from '../../../semana';
import { fechaLarga, lineasDeVenta, usd, type Catalogo, type Linea, type Pedido } from './types';

function PedidoHistorico({ pedido, linea }: { pedido: Pedido; linea: Linea }) {
  const detalles = lineasDeVenta(pedido, linea);
  const total = detalles.reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  return <article className="history-order-card"><header><div><strong>{pedido.ubicacion.nombre}</strong><small>{pedido.empresa.nombre}</small></div><span className={`order-status order-status--${pedido.estado}`}>{pedido.estado.replaceAll('_', ' ')}</span></header><div>{detalles.map((l) => <div className="history-order-line" key={l.id}><span><strong>{nombreEnVenta(l.sku, l.nombre, linea)}</strong><small>{l.sku}</small></span><span>{l.cantidad.toLocaleString('es-MX')} × {usd(l.precio)}</span><strong>{usd(l.cantidad * (l.precio ?? 0))}</strong></div>)}</div><footer><span>{pedido.notas ?? ''}</span><strong>{usd(total)}</strong></footer></article>;
}

export default function HistorialPedidos({ pedidos, cargando, linea, semana, ubicacion, setUbicacion, ubicaciones, onPrint, onConfirmar, confirmando }: {
  pedidos: Pedido[]; cargando: boolean; linea: Linea; semana: SemanaSeleccionada; ubicacion: string; setUbicacion: (v: string) => void;
  ubicaciones: Catalogo['ubicaciones']; onPrint: () => void; onConfirmar: () => void; confirmando: boolean;
}) {
  const filtrados = pedidos.filter((p) => lineasDeVenta(p, linea).length > 0 && (ubicacion === 'todas' || String(p.ubicacion.id) === ubicacion));
  const fechas = [...new Set(filtrados.map((p) => p.fecha_entrega))].sort();
  const unidades = filtrados.flatMap((p) => lineasDeVenta(p, linea)).reduce((a, l) => a + l.cantidad, 0);
  const total = filtrados.flatMap((p) => lineasDeVenta(p, linea)).reduce((a, l) => a + l.cantidad * (l.precio ?? 0), 0);
  return <div className="order-history">
    <section className="workspace-card history-toolbar history-toolbar--global">
      <div><span className="eyebrow">Periodo general</span><h2>Semana {semana.numero}</h2><p>{etiquetaRango(semana)}</p></div>
      <label className="field"><span>Sucursal</span><select value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}><option value="todas">Todas las sucursales</option>{ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>
      <div className="history-primary-actions"><button className="btn btn-secondary" disabled={cargando || confirmando} onClick={onConfirmar}>{confirmando ? 'Confirmando…' : 'Confirmar todos'}</button><button className="btn btn-primary" disabled={cargando || !filtrados.length} onClick={onPrint}>Imprimir por ruta</button></div>
    </section>
    {cargando ? <Spinner label="Cargando pedidos…" /> : <>
      <div className="metric-strip metric-strip--four"><div><span>Sucursales</span><strong>{new Set(filtrados.map((p) => p.ubicacion.id)).size}</strong></div><div><span>Ventas</span><strong>{filtrados.length}</strong></div><div><span>Unidades de {linea}</span><strong>{unidades.toLocaleString('es-MX')}</strong></div><div><span>Importe de {linea}</span><strong>{usd(total)}</strong></div></div>
      {fechas.map((dia) => <CollapsibleSection title={fechaLarga(dia)} count={`${filtrados.filter((p) => p.fecha_entrega === dia).length} sucursales`} className="history-day" key={dia}><div className="history-location-grid">{filtrados.filter((p) => p.fecha_entrega === dia).map((p) => <PedidoHistorico key={p.id} pedido={p} linea={linea} />)}</div></CollapsibleSection>)}
      {!filtrados.length && <div className="empty-state"><strong>No hay pedidos de {linea} esta semana</strong><span>Cambia la semana, la línea o la sucursal.</span></div>}
    </>}
  </div>;
}
