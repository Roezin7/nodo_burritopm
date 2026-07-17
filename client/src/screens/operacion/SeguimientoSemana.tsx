import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import Spinner from '../../components/Spinner';

interface Etapa {
  total: number;
  completadas: number;
}

interface Seguimiento {
  periodo: { anio: number; semana: number; inicia_at: string; termina_at: string; estado: string };
  inventario: { total: number; materia_prima_fresca: number; materia_prima_congelada: number; carne_terminada: number; desechables: number };
  cartera: { por_cobrar: number; por_pagar: number; balance_neto: number };
  operacion: { pedidos_confirmados: number; pedidos_borrador: number; distribuciones_abiertas: number; paradas_pendientes: number; productos_bajo_minimo: number };
  seguimiento: { preparacion: Etapa; despacho: Etapa; reparto: Etapa; recepcion: Etapa };
  alertas: { tipo: string; titulo: string; detalle: string }[];
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function estadoEtapa(etapa: Etapa) {
  if (etapa.total === 0) return { texto: 'Sin movimientos', clase: 'chip--muted', porcentaje: 0 };
  if (etapa.completadas >= etapa.total) return { texto: 'Completo', clase: 'chip--ok', porcentaje: 100 };
  return { texto: 'En curso', clase: 'chip--info', porcentaje: (etapa.completadas / etapa.total) * 100 };
}

function TarjetaEtapa({ numero, nombre, detalle, etapa }: { numero: number; nombre: string; detalle: string; etapa: Etapa }) {
  const estado = estadoEtapa(etapa);
  return <article className="tracking-stage">
    <header><span className="tracking-stage-number">{numero}</span><span><strong>{nombre}</strong><small>{detalle}</small></span><i className={`chip ${estado.clase}`}>{estado.texto}</i></header>
    <div className="tracking-stage-value"><strong>{etapa.completadas}</strong><span>de {etapa.total}</span></div>
    <div className="tracking-stage-bar"><span style={{ width: `${estado.porcentaje}%` }} /></div>
  </article>;
}

export default function SeguimientoSemana() {
  const [datos, setDatos] = useState<Seguimiento | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Seguimiento>('/dashboard/general').then(setDatos).catch(() => setError('No se pudo cargar el seguimiento de la semana.'));
  }, []);

  if (error) return <p className="error-msg">{error}</p>;
  if (!datos) return <Spinner label="Actualizando seguimiento…" />;

  const s = datos.seguimiento;
  return <div className="weekly-tracking">
    <header className="embedded-head tracking-head">
      <div><span className="eyebrow">Solo visualización</span><h2>Seguimiento automático</h2><p>Semana {datos.periodo.semana} · {datos.periodo.inicia_at} al {datos.periodo.termina_at}</p></div>
      <span className={`chip ${datos.periodo.estado === 'cerrada' ? 'chip--ok' : 'chip--info'}`}>{datos.periodo.estado}</span>
    </header>

    <section className="tracking-input-summary" aria-label="Capturas base">
      <div><span>Ventas confirmadas</span><strong>{datos.operacion.pedidos_confirmados}</strong><small>{datos.operacion.pedidos_borrador} en borrador</small></div>
      <span>→</span>
      <div><span>Seguimiento calculado</span><strong>{datos.operacion.distribuciones_abiertas}</strong><small>operaciones abiertas</small></div>
      <span>→</span>
      <div><span>Entregas pendientes</span><strong>{datos.operacion.paradas_pendientes}</strong><small>paradas restantes</small></div>
    </section>

    <div className="tracking-stage-grid">
      <TarjetaEtapa numero={4} nombre="Preparación" detalle="Pedidos agrupados y rutas creadas" etapa={s.preparacion} />
      <TarjetaEtapa numero={5} nombre="Despacho" detalle="Cargas listas para salir" etapa={s.despacho} />
      <TarjetaEtapa numero={6} nombre="Reparto" detalle="Rutas completadas" etapa={s.reparto} />
      <TarjetaEtapa numero={7} nombre="Recepción" detalle="Paradas confirmadas" etapa={s.recepcion} />
    </div>

    <div className="tracking-result-grid">
      <section className="tracking-result-card"><span className="eyebrow">Paso 8 · Inventario</span><strong>{usd(datos.inventario.total)}</strong><p>Carne, materia prima y desechables disponibles</p><div><span>Carne terminada {usd(datos.inventario.carne_terminada)}</span><span>Desechables {usd(datos.inventario.desechables)}</span></div></section>
      <section className="tracking-result-card"><span className="eyebrow">Paso 9 · Cierre</span><strong>{usd(datos.cartera.balance_neto)}</strong><p>Balance operativo calculado</p><div><span>Por cobrar {usd(datos.cartera.por_cobrar)}</span><span>Por pagar {usd(datos.cartera.por_pagar)}</span></div></section>
    </div>

    {datos.alertas.length > 0 && <section className="tracking-alerts"><strong>Requiere atención</strong>{datos.alertas.map((a) => <div key={`${a.tipo}-${a.titulo}`}><span>{a.titulo}</span><small>{a.detalle}</small></div>)}</section>}

    <details className="manual-tools">
      <summary>Correcciones manuales</summary>
      <p>Úsalas únicamente cuando la operación real sea diferente a lo calculado.</p>
      <div><Link to="/control/preparacion">Preparación</Link><Link to="/control/despacho">Despacho</Link><Link to="/control/reparto">Reparto</Link><Link to="/control/recepcion">Recepción</Link><Link to="/control/inventario">Inventario</Link><Link to="/control/cierre">Cierre</Link></div>
    </details>
  </div>;
}
