import { filasOrden } from '../../../operationOrder';
import type { Catalogo, Linea, Pedido } from './types';

interface HojaRuta {
  clave: string;
  nombre: string;
  conductor: string;
  fechas: string[];
  paradas: string[];
  pedidos: Pedido[];
}

const familiaPlantilla = (codigo: string) => codigo.replace(/-(MIE|SAB|LUN|JUE)$/i, '');
const sumarFecha = (iso: string, dias: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');
};
const diaCorto = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
const fechaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' }).toUpperCase();

function construirHojasRuta(datos: { linea: Linea; inicio: string; fin: string; pedidos: Pedido[] }, catalogo: Catalogo): HojaRuta[] {
  const hojas = new Map<string, HojaRuta>();
  const plantillas = catalogo.plantillas.filter((p) => p.linea === datos.linea);
  for (let dia = datos.inicio; dia <= datos.fin; dia = sumarFecha(dia, 1)) {
    const numeroDia = new Date(`${dia}T12:00:00`).getDay();
    for (const plantilla of plantillas.filter((p) => p.dia_semana === numeroDia)) {
      const clave = familiaPlantilla(plantilla.codigo);
      const hoja = hojas.get(clave) ?? {
        clave,
        nombre: plantilla.nombre.replace(/\s*·\s*(lunes|martes|miércoles|jueves|viernes|sábado|domingo)$/i, ''),
        conductor: plantilla.conductor,
        fechas: [],
        paradas: [],
        pedidos: [],
      };
      if (!hoja.fechas.includes(dia)) hoja.fechas.push(dia);
      for (const parada of plantilla.paradas) if (!hoja.paradas.includes(parada.nombre)) hoja.paradas.push(parada.nombre);
      hojas.set(clave, hoja);
    }
  }

  for (const pedido of datos.pedidos) {
    const numeroDia = new Date(`${pedido.fecha_entrega}T12:00:00`).getDay();
    const destino = pedido.ubicacion.entrega_en?.id ?? pedido.ubicacion.id;
    const plantilla = plantillas.find((p) => p.dia_semana === numeroDia && p.paradas.some((parada) => parada.ubicacion_id === destino));
    const clave = plantilla ? familiaPlantilla(plantilla.codigo) : 'SIN-RUTA';
    if (!hojas.has(clave)) {
      hojas.set(clave, { clave, nombre: 'Sin ruta asignada', conductor: 'POR ASIGNAR', fechas: [], paradas: [], pedidos: [] });
    }
    const hoja = hojas.get(clave)!;
    if (!hoja.fechas.includes(pedido.fecha_entrega)) hoja.fechas.push(pedido.fecha_entrega);
    if (!hoja.paradas.includes(pedido.ubicacion.entrega_en?.nombre ?? pedido.ubicacion.nombre)) hoja.paradas.push(pedido.ubicacion.entrega_en?.nombre ?? pedido.ubicacion.nombre);
    hoja.pedidos.push(pedido);
  }

  return [...hojas.values()]
    .filter((hoja) => hoja.pedidos.length > 0)
    .map((hoja) => ({ ...hoja, fechas: hoja.fechas.sort() }))
    .sort((a, b) => {
      const prioridad = (nombre: string) => nombre.toLowerCase() === 'pablo' ? 0 : nombre.toLowerCase() === 'mh' ? 1 : 2;
      return prioridad(a.conductor) - prioridad(b.conductor) || a.nombre.localeCompare(b.nombre, 'es');
    });
}

function cantidadesHoja(hoja: HojaRuta, linea: Linea, catalogo: Catalogo, fechaObjetivo?: string) {
  const productosPorSku = new Map(catalogo.productos.map((p) => [p.sku, p.id]));
  const pedidos = fechaObjetivo ? hoja.pedidos.filter((p) => p.fecha_entrega === fechaObjetivo) : hoja.pedidos;
  const lineas = pedidos.flatMap((p) => p.lineas);
  return filasOrden(linea, catalogo.productos).map((fila) => ({
    nombre: fila.nombre,
    cantidad: fila.skus.reduce((total, sku) => {
      const productoId = productosPorSku.get(sku);
      return total + (productoId ? lineas.filter((l) => l.product_id === productoId).reduce((a, l) => a + l.cantidad, 0) : 0);
    }, 0),
  }));
}

function TablaRuta({ titulo, subtitulo, filas }: { titulo: string; subtitulo?: string; filas: { nombre: string; cantidad: number }[] }) {
  return <table className="operation-order-sheet route-order-table"><thead><tr><th colSpan={2}>{titulo}{subtitulo && <small>{subtitulo}</small>}</th></tr><tr><th>ITEM</th><th>QTY</th></tr></thead><tbody>{filas.map((fila) => <tr key={fila.nombre}><td>{fila.nombre}</td><td>{fila.cantidad > 0 ? fila.cantidad.toLocaleString('es-MX') : ''}</td></tr>)}</tbody><tfoot><tr><th>TOTAL</th><th>{filas.reduce((a, fila) => a + fila.cantidad, 0).toLocaleString('es-MX')}</th></tr></tfoot></table>;
}

export default function OrdenImprimible({ datos, catalogo, onClose }: { datos: { linea: Linea; inicio: string; fin: string; pedidos: Pedido[] }; catalogo: Catalogo; onClose: () => void }) {
  const hojas = construirHojasRuta(datos, catalogo);
  return <div className="modal-backdrop" onClick={onClose}><div className="modal-card invoice-print operation-order-print route-order-print" onClick={(e) => e.stopPropagation()}>
    <header className="print-order-head no-print"><div><span className="eyebrow">M&amp;G Management and Logistics Inc.</span><h1>Orden de {datos.linea} por ruta</h1><p>{datos.inicio} al {datos.fin} · {hojas.length} hojas</p></div><button className="icon-btn" aria-label="Cerrar" onClick={onClose}>×</button></header>
    {hojas.map((hoja) => <section className={`route-order-page route-order-page--${datos.linea}`} key={hoja.clave}>
      <header className="route-order-heading"><div><span>M&amp;G Management and Logistics Inc.</span><strong>{hoja.conductor}</strong></div><div><span>{datos.linea}</span><strong>{hoja.nombre}</strong></div></header>
      <div className="route-order-grid" style={{ gridTemplateColumns: `repeat(${hoja.fechas.length + 1}, minmax(190px, 1fr))` }}>
        {hoja.fechas.map((dia) => <TablaRuta key={dia} titulo={diaCorto(dia)} subtitulo={fechaCorta(dia)} filas={cantidadesHoja(hoja, datos.linea, catalogo, dia)} />)}
        <TablaRuta titulo="TOTAL" subtitulo="SEMANA" filas={cantidadesHoja(hoja, datos.linea, catalogo)} />
      </div>
      <footer><strong>Ruta:</strong> {hoja.paradas.join(' → ')} <span>{hoja.pedidos.length} pedidos confirmados</span></footer>
    </section>)}
    {!hojas.length && <div className="empty-state"><strong>No hay pedidos confirmados en esta semana</strong><span>Los borradores no se incluyen en la impresión ni en los consolidados.</span></div>}
    <button className="btn btn-primary btn-block no-print" disabled={!hojas.length} onClick={() => window.print()}>Imprimir / guardar PDF</button>
  </div></div>;
}
