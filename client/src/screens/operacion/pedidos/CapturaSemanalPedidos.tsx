import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api, ApiError, fueEncolado, type Encolado } from '../../../api';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../toast';
import { filasOrden, productosParaPedido } from '../../../operationOrder';
import { etiquetaRango, type SemanaSeleccionada } from '../../../semana';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { guardarBorradorLocal, leerBorradorLocal, useUnsavedChanges } from '../../../use-unsaved';
import {
  abreviaturaUbicacion, claveCantidadSemanal, clavePedidoSemanal, entregasDeSemana, esPieza,
  fechaEntregaCorta, fechaLarga, lineasDeVenta, pedidoEditable, usd,
  type Catalogo, type Linea, type Pedido, type ResultadoConfirmacion,
} from './types';

export default function CapturaSemanalPedidos({ catalogo, linea, semana, ubicaciones, semanaCerrada, onActualizado }: {
  catalogo: Catalogo;
  linea: Linea;
  semana: SemanaSeleccionada;
  ubicaciones: Catalogo['ubicaciones'];
  semanaCerrada: boolean;
  onActualizado: () => void;
}) {
  const toast = useToast();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [pedidosSemana, setPedidosSemana] = useState<Pedido[]>([]);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [cantidadesGuardadas, setCantidadesGuardadas] = useState<Record<string, string>>({});
  const [cambios, setCambios] = useState<string[]>([]);
  const [historialCambios, setHistorialCambios] = useState<{ clave: string; anterior: string | undefined }[][]>([]);
  const [buscar, setBuscar] = useState('');
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresco, setRefresco] = useState(0);
  const [herramientas, setHerramientas] = useState(false);
  const [fechaHerramienta, setFechaHerramienta] = useState('todas');
  const [ubicacionHerramienta, setUbicacionHerramienta] = useState('todas');
  const [productoHerramienta, setProductoHerramienta] = useState('todos');
  const restauradoRef = useRef<string | null>(null);

  const programadas = useMemo(() => ubicaciones.map((ubicacion) => ({
    ubicacion,
    entregas: entregasDeSemana(catalogo.calendario_pedidos, String(ubicacion.id), linea, semana),
    productos: productosParaPedido(catalogo.productos, linea, ubicacion.empresa?.codigo),
  })).filter((fila) => fila.entregas.length > 0), [ubicaciones, catalogo, linea, semana.inicio, semana.fin]);
  const claveBorrador = `bpm-borrador-ventas:${semana.inicio}:${linea}`;
  useUnsavedChanges(cambios.length > 0);

  useEffect(() => {
    let vigente = true;
    setCargando(true); setError('');
    api<Pedido[]>(`/operacion/pedidos?desde=${semana.inicio}&hasta=${semana.fin}`)
      .then((rows) => {
        if (!vigente) return;
        const pedidosDeCaptura = rows.filter((pedido) => pedido.linea === linea);
        const valores: Record<string, string> = {};
        for (const pedido of pedidosDeCaptura) {
          const fila = programadas.find((x) => x.ubicacion.id === pedido.ubicacion.id);
          if (!fila) continue;
          const porSku = new Map(fila.productos.map((p) => [p.sku, p.id]));
          for (const detalle of pedido.lineas) {
            let productId = detalle.product_id;
            if (detalle.sku === 'MEAT-PASTOR-BPM' && fila.ubicacion.empresa?.codigo === 'LBT') productId = porSku.get('MEAT-PASTOR-TAP') ?? productId;
            if (detalle.sku === 'MEAT-PASTOR-TAP' && fila.ubicacion.empresa?.codigo !== 'LBT') productId = porSku.get('MEAT-PASTOR-BPM') ?? productId;
            valores[claveCantidadSemanal(pedido.ubicacion.id, pedido.fecha_entrega, productId)] = String(detalle.cantidad);
          }
        }
        setPedidos(pedidosDeCaptura);
        setPedidosSemana(rows);
        setCantidadesGuardadas(valores);
        const borrador = leerBorradorLocal<{ cantidades: Record<string, string>; cambios: string[] }>(claveBorrador);
        if (borrador?.valor.cambios.length && restauradoRef.current !== claveBorrador) {
          setCantidades(borrador.valor.cantidades);
          setCambios(borrador.valor.cambios);
          restauradoRef.current = claveBorrador;
        } else {
          setCantidades(valores);
          setCambios([]);
        }
        setHistorialCambios([]);
      })
      .catch((e) => { if (vigente) setError(e instanceof ApiError ? e.message : 'No se pudieron cargar las ventas de la semana.'); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [linea, semana.inicio, semana.fin, refresco, programadas, claveBorrador]);

  useEffect(() => {
    if (cargando) return;
    guardarBorradorLocal(claveBorrador, cambios.length ? { cantidades, cambios } : null);
  }, [claveBorrador, cantidades, cambios, cargando]);

  const porClave = useMemo(() => new Map(pedidos.map((p) => [clavePedidoSemanal(p.ubicacion.id, p.fecha_entrega), p])), [pedidos]);
  const preciosCatalogo = useMemo(() => new Map(catalogo.productos.map((producto) => [producto.id, producto.precio])), [catalogo.productos]);
  const preciosGuardados = useMemo(() => new Map(pedidos.flatMap((pedido) => pedido.lineas.map((detalle) => [
    claveCantidadSemanal(pedido.ubicacion.id, pedido.fecha_entrega, detalle.product_id), detalle.precio,
  ] as const))), [pedidos]);
  const filtro = buscar.trim().toLowerCase();
  const visibles = programadas.filter(({ ubicacion }) => !filtro || `${ubicacion.nombre} ${ubicacion.empresa?.nombre ?? ''}`.toLowerCase().includes(filtro));
  const unidadesCaptura = programadas.reduce((total, fila) => total + fila.entregas.reduce((subtotal, entrega) => subtotal + fila.productos.reduce(
    (suma, producto) => suma + (producto.linea === linea ? Number(cantidades[claveCantidadSemanal(fila.ubicacion.id, entrega.fecha, producto.id)] || 0) : 0), 0,
  ), 0), 0);
  const importeCaptura = programadas.reduce((total, fila) => total + fila.entregas.reduce((subtotal, entrega) => subtotal + fila.productos.reduce(
    (suma, producto) => {
      const clave = claveCantidadSemanal(fila.ubicacion.id, entrega.fecha, producto.id);
      const precio = preciosGuardados.get(clave) ?? producto.precio ?? 0;
      return suma + (producto.linea === linea ? Number(cantidades[clave] || 0) * precio : 0);
    }, 0,
  ), 0), 0);
  const lineasExternas = pedidosSemana.filter((pedido) => pedido.linea !== linea && pedido.estado !== 'cancelado').flatMap((pedido) => lineasDeVenta(pedido, linea));
  const unidades = unidadesCaptura + lineasExternas.reduce((total, detalle) => total + detalle.cantidad, 0);
  const importe = importeCaptura + lineasExternas.reduce((total, detalle) => total + detalle.cantidad * (detalle.precio ?? preciosCatalogo.get(detalle.product_id) ?? 0), 0);
  const ventasCapturadas = pedidosSemana.filter((pedido) => pedido.estado !== 'cancelado' && lineasDeVenta(pedido, linea).some((detalle) => detalle.cantidad > 0)).length;
  const fechasVisibles = [...new Set(visibles.flatMap((fila) => fila.entregas.map((entrega) => entrega.fecha)))].sort();
  const filasFormato = filasOrden(linea, catalogo.productos);

  function pedidosModificados(valores: Record<string, string>) {
    const modificados: string[] = [];
    for (const fila of programadas) for (const entrega of fila.entregas) {
      const cambio = fila.productos.some((producto) => {
        const clave = claveCantidadSemanal(fila.ubicacion.id, entrega.fecha, producto.id);
        return Number(valores[clave] || 0) !== Number(cantidadesGuardadas[clave] || 0);
      });
      if (cambio) modificados.push(clavePedidoSemanal(fila.ubicacion.id, entrega.fecha));
    }
    return modificados;
  }

  function aplicarValores(entradas: { clave: string; valor: string }[]) {
    if (!entradas.length) return;
    const siguientes = { ...cantidades };
    const reversa: { clave: string; anterior: string | undefined }[] = [];
    for (const entrada of entradas) {
      if ((siguientes[entrada.clave] ?? '') === entrada.valor) continue;
      reversa.push({ clave: entrada.clave, anterior: siguientes[entrada.clave] });
      siguientes[entrada.clave] = entrada.valor;
    }
    if (!reversa.length) return;
    setCantidades(siguientes);
    setHistorialCambios((historial) => [...historial.slice(-49), reversa]);
    setCambios(pedidosModificados(siguientes));
  }

  function cambiarCantidad(ubicacionId: number, fechaEntrega: string, productId: number, valor: string) {
    aplicarValores([{ clave: claveCantidadSemanal(ubicacionId, fechaEntrega, productId), valor }]);
  }

  function deshacer() {
    const ultimo = historialCambios.at(-1);
    if (!ultimo) return;
    const siguientes = { ...cantidades };
    for (const cambio of ultimo) {
      if (cambio.anterior === undefined) delete siguientes[cambio.clave];
      else siguientes[cambio.clave] = cambio.anterior;
    }
    setCantidades(siguientes);
    setCambios(pedidosModificados(siguientes));
    setHistorialCambios((historial) => historial.slice(0, -1));
  }

  function clavesDeHerramienta() {
    const formato = filasFormato.find((fila) => fila.nombre === productoHerramienta);
    const claves: string[] = [];
    for (const fila of programadas) {
      if (ubicacionHerramienta !== 'todas' && fila.ubicacion.id !== Number(ubicacionHerramienta)) continue;
      for (const entrega of fila.entregas) {
        if (fechaHerramienta !== 'todas' && entrega.fecha !== fechaHerramienta) continue;
        const pedido = porClave.get(clavePedidoSemanal(fila.ubicacion.id, entrega.fecha));
        if (!pedidoEditable(pedido)) continue;
        for (const producto of fila.productos) {
          if (formato && !formato.skus.includes(producto.sku)) continue;
          claves.push(claveCantidadSemanal(fila.ubicacion.id, entrega.fecha, producto.id));
        }
      }
    }
    return claves;
  }

  function limpiarAlcance() {
    aplicarValores(clavesDeHerramienta().map((clave) => ({ clave, valor: '' })));
  }

  function restaurarAlcance() {
    aplicarValores(clavesDeHerramienta().map((clave) => ({ clave, valor: cantidadesGuardadas[clave] ?? '' })));
  }

  function pegarMatriz(
    evento: ReactClipboardEvent<HTMLInputElement>,
    fechaEntrega: string,
    filaInicio: number,
    columnaInicio: number,
    filas: { productos: (Catalogo['productos'][number] | undefined)[] }[],
    restaurantes: typeof programadas,
  ) {
    const textoPegado = evento.clipboardData.getData('text/plain');
    if (!textoPegado.includes('\t') && !textoPegado.includes('\n')) return;
    evento.preventDefault();
    const matriz = textoPegado.trim().split(/\r?\n/).map((renglon) => renglon.split('\t'));
    const entradas: { clave: string; valor: string }[] = [];
    for (const [desplazamientoFila, renglon] of matriz.entries()) {
      const fila = filas[filaInicio + desplazamientoFila];
      if (!fila) break;
      for (const [desplazamientoColumna, crudo] of renglon.entries()) {
        const columna = columnaInicio + desplazamientoColumna;
        const restaurante = restaurantes[columna];
        const producto = fila.productos[columna];
        const pedido = restaurante ? porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega)) : undefined;
        if (!restaurante || !producto || !pedidoEditable(pedido)) continue;
        const limpio = crudo.trim().replace(/[$,]/g, '');
        if (limpio !== '' && (!Number.isFinite(Number(limpio)) || Number(limpio) < 0)) continue;
        entradas.push({ clave: claveCantidadSemanal(restaurante.ubicacion.id, fechaEntrega, producto.id), valor: limpio });
      }
    }
    aplicarValores(entradas);
  }

  function navegarConEnter(evento: ReactKeyboardEvent<HTMLInputElement>) {
    if (evento.key !== 'Enter') return;
    evento.preventDefault();
    const celdas = [...document.querySelectorAll<HTMLInputElement>('input[data-weekly-matrix-input]:not(:disabled)')]
      .sort((a, b) => Number(a.dataset.navOrder) - Number(b.dataset.navOrder));
    const actual = celdas.indexOf(evento.currentTarget);
    const siguiente = celdas[actual + (evento.shiftKey ? -1 : 1)];
    if (siguiente) { siguiente.focus(); siguiente.select(); }
  }

  async function guardarSemana(confirmar: boolean) {
    const objetivos = new Set(cambios);
    if (confirmar) {
      for (const fila of programadas) for (const entrega of fila.entregas) {
        const clave = clavePedidoSemanal(fila.ubicacion.id, entrega.fecha);
        const existente = porClave.get(clave);
        if (existente?.estado === 'borrador' && existente.lineas.length > 0) objetivos.add(clave);
      }
    }

    const payload = [...objetivos].flatMap((clave) => {
      const [ubicacionRaw, fechaEntrega] = clave.split('|');
      const fila = programadas.find((x) => x.ubicacion.id === Number(ubicacionRaw) && x.entregas.some((e) => e.fecha === fechaEntrega));
      if (!fila) return [];
      const existente = porClave.get(clave);
      if (!pedidoEditable(existente)) return [];
      const lineas = fila.productos.map((producto) => ({
        product_id: producto.id,
        cantidad: Number(cantidades[claveCantidadSemanal(fila.ubicacion.id, fechaEntrega, producto.id)] || 0),
      }));
      if (!existente && !lineas.some((l) => l.cantidad > 0)) return [];
      return [{
        ubicacion_id: fila.ubicacion.id,
        linea,
        fecha_entrega: fechaEntrega,
        actualizado_at: existente?.actualizado_at ?? null,
        confirmar,
        notas: existente?.notas ?? null,
        lineas,
      }];
    });

    if (!payload.length) {
      setCambios([]);
      if (confirmar) {
        setBusy(true); setError('');
        try {
          const avance = await api<ResultadoConfirmacion>('/operacion/pedidos/confirmar-todos', { method: 'POST', body: { linea, desde: semana.inicio, hasta: semana.fin } });
          const faltantes = avance.cobertura_bpm.flatMap((c) => c.pendientes);
          toast.ok(faltantes.length ? `Faltan ${faltantes.length} pedidos BPM antes de consolidar.` : `${avance.preparaciones?.aprobadas ?? 0} consolidados listos.`);
          setRefresco((n) => n + 1); onActualizado();
        } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo completar la semana.'); }
        finally { setBusy(false); }
      } else toast.ok('No hay cambios con cantidades para guardar.');
      return;
    }

    setBusy(true); setError('');
    try {
      const resultado = await api<{ guardados: number; confirmados: number; borradores: number } | Encolado>('/operacion/pedidos/semana', {
        method: 'PUT', body: { pedidos: payload },
      });
      if (fueEncolado(resultado)) {
        setCambios([]);
        setHistorialCambios([]);
        guardarBorradorLocal(claveBorrador, null);
        restauradoRef.current = claveBorrador;
        toast.ok('Semana guardada sin conexión; se enviará automáticamente al recuperar la red.');
        return;
      }
      if (confirmar) {
        const avance = await api<ResultadoConfirmacion>('/operacion/pedidos/confirmar-todos', {
          method: 'POST', body: { linea, desde: semana.inicio, hasta: semana.fin },
        });
        const faltantes = avance.cobertura_bpm.flatMap((c) => c.pendientes);
        const preparadas = avance.preparaciones?.aprobadas ?? 0;
        toast.ok(faltantes.length
          ? `${resultado.guardados} ventas guardadas · faltan ${faltantes.length} pedidos BPM antes de consolidar.`
          : `${resultado.guardados} ventas confirmadas${preparadas ? ` · ${preparadas} consolidados listos` : ''}.`);
      } else {
        toast.ok(`${resultado.guardados} ventas actualizadas.`);
      }
      setCambios([]);
      setHistorialCambios([]);
      guardarBorradorLocal(claveBorrador, null);
      restauradoRef.current = claveBorrador;
      setRefresco((n) => n + 1);
      onActualizado();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'No se pudo guardar la semana. Ninguna venta fue modificada.'); }
    finally { setBusy(false); }
  }

  return <div className="weekly-sales-capture">
    <section className="workspace-card weekly-sales-toolbar">
      <div><span className="eyebrow">Semana {semana.numero}</span><h2>Pedidos por restaurante</h2><p>{etiquetaRango(semana)}</p></div>
      <label className="field"><span>Buscar restaurante</span><input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Nombre o empresa" /></label>
      <div className="weekly-sales-toolbar-actions"><button className="btn btn-ghost" disabled={!historialCambios.length || busy} onClick={deshacer}>Deshacer</button><button className="btn btn-secondary" disabled={cargando || busy || semanaCerrada} onClick={() => setHerramientas((actual) => !actual)}>Herramientas</button><button className="btn btn-secondary" disabled={cargando || busy || semanaCerrada || cambios.length === 0} onClick={() => void guardarSemana(false)}>Guardar cambios</button><button className="btn btn-primary" disabled={cargando || busy || semanaCerrada} onClick={() => void guardarSemana(true)}>{busy ? 'Guardando…' : 'Guardar y confirmar'}</button></div>
    </section>
    {herramientas && <section className="workspace-card weekly-sales-tools">
      <div><span className="eyebrow">Acciones masivas</span><strong>Elige qué parte de la cuadrícula quieres modificar</strong></div>
      <label className="field"><span>Fecha</span><select value={fechaHerramienta} onChange={(e) => setFechaHerramienta(e.target.value)}><option value="todas">Toda la semana</option>{[...new Set(programadas.flatMap((fila) => fila.entregas.map((entrega) => entrega.fecha)))].sort().map((fechaEntrega) => <option value={fechaEntrega} key={fechaEntrega}>{fechaLarga(fechaEntrega)}</option>)}</select></label>
      <label className="field"><span>Restaurante</span><select value={ubicacionHerramienta} onChange={(e) => setUbicacionHerramienta(e.target.value)}><option value="todas">Todos</option>{programadas.map((fila) => <option value={fila.ubicacion.id} key={fila.ubicacion.id}>{fila.ubicacion.nombre}</option>)}</select></label>
      <label className="field"><span>Producto</span><select value={productoHerramienta} onChange={(e) => setProductoHerramienta(e.target.value)}><option value="todos">Todos</option>{filasFormato.map((fila) => <option value={fila.nombre} key={fila.nombre}>{fila.nombre}</option>)}</select></label>
      <div className="weekly-sales-tools__actions"><button className="btn btn-secondary" disabled={busy} onClick={restaurarAlcance}>Restaurar guardado</button><button className="btn btn-danger-ghost" disabled={busy} onClick={limpiarAlcance}>Limpiar selección</button></div>
      <small>Puedes pegar un bloque copiado de Excel directamente sobre cualquier celda. Las filas y columnas se llenarán desde ese punto.</small>
    </section>}
    {error && <p className="error-msg">{error}</p>}
    {semanaCerrada && <p className="notice notice--warning">La semana {semana.numero} está cerrada. Reábrela para corregir sus ventas.</p>}
    <div className="metric-strip metric-strip--four"><div><span>Restaurantes</span><strong>{programadas.length}</strong></div><div><span>Ventas capturadas</span><strong>{ventasCapturadas}</strong></div><div><span>Unidades de {linea}</span><strong>{unidades.toLocaleString('es-MX')}</strong></div><div><span>Importe de {linea}</span><strong>{usd(importe)}</strong></div></div>
    {cargando ? <Spinner label="Cargando semana…" /> : <div className="weekly-sales-sheets">{fechasVisibles.map((fechaEntrega, fechaIndice) => {
      const restaurantes = visibles.filter((fila) => fila.entregas.some((entrega) => entrega.fecha === fechaEntrega));
      const filas = filasFormato.map((formato) => ({
        formato,
        productos: restaurantes.map((restaurante) => restaurante.productos.find((producto) => formato.skus.includes(producto.sku))),
      })).filter((fila) => fila.productos.some(Boolean));
      const totalRestaurante = (indice: number) => filas.reduce((total, fila) => {
        const producto = fila.productos[indice];
        return total + (producto ? Number(cantidades[claveCantidadSemanal(restaurantes[indice].ubicacion.id, fechaEntrega, producto.id)] || 0) : 0);
      }, 0);
      const totalDia = restaurantes.reduce((total, _, indice) => total + totalRestaurante(indice), 0);
      const capturadas = restaurantes.filter((restaurante) => {
        const estadoPedido = porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega))?.estado;
        return estadoPedido && !['borrador', 'cancelado'].includes(estadoPedido);
      }).length;
      return <CollapsibleSection title={fechaLarga(fechaEntrega)} count={`${capturadas}/${restaurantes.length}`} summary={`${totalDia.toLocaleString('es-MX')} unidades`} className="weekly-sales-sheet" key={fechaEntrega}>
        <div className="weekly-sales-matrix-wrap"><table className="weekly-sales-matrix">
          <thead><tr><th>Total</th><th>Item</th>{restaurantes.map((restaurante) => {
            const pedido = porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega));
            return <th key={restaurante.ubicacion.id} title={`${restaurante.ubicacion.nombre} · ${pedido?.estado.replaceAll('_', ' ') ?? 'sin capturar'}`}><strong>{abreviaturaUbicacion(restaurante.ubicacion)}</strong><small>{restaurante.ubicacion.nombre}</small><i className={`matrix-status matrix-status--${pedido?.estado ?? 'pendiente'}`} /></th>;
          })}</tr></thead>
          <tbody>{filas.map((fila, filaIndice) => {
            const totalProducto = fila.productos.reduce((total, producto, indice) => total + (producto ? Number(cantidades[claveCantidadSemanal(restaurantes[indice].ubicacion.id, fechaEntrega, producto.id)] || 0) : 0), 0);
            return <tr key={fila.formato.nombre}><th>{totalProducto.toLocaleString('es-MX')}</th><th>{fila.formato.nombre}</th>{fila.productos.map((producto, indice) => {
              const restaurante = restaurantes[indice];
              const pedido = porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega));
              if (!producto) return <td key={restaurante.ubicacion.id} className="matrix-cell-empty">—</td>;
              const clave = claveCantidadSemanal(restaurante.ubicacion.id, fechaEntrega, producto.id);
              const modificada = Number(cantidades[clave] || 0) !== Number(cantidadesGuardadas[clave] || 0);
              return <td key={restaurante.ubicacion.id} className={`${!pedidoEditable(pedido) ? 'matrix-cell-locked' : ''} ${modificada ? 'matrix-cell-dirty' : ''}`}><input data-weekly-matrix-input data-nav-order={fechaIndice * 10000 + indice * 100 + filaIndice} aria-label={`${fila.formato.nombre} · ${restaurante.ubicacion.nombre} · ${fechaEntregaCorta(fechaEntrega)}`} title={`${restaurante.ubicacion.nombre} · ${fila.formato.nombre}`} disabled={semanaCerrada || !pedidoEditable(pedido)} inputMode="decimal" type="number" min="0" step={esPieza(producto) ? '1' : '0.5'} value={cantidades[clave] ?? ''} placeholder="0" onPaste={(e) => pegarMatriz(e, fechaEntrega, filaIndice, indice, filas, restaurantes)} onKeyDown={navegarConEnter} onChange={(e) => cambiarCantidad(restaurante.ubicacion.id, fechaEntrega, producto.id, e.target.value)} /></td>;
            })}</tr>;
          })}</tbody>
          <tfoot><tr><th>{totalDia.toLocaleString('es-MX')}</th><th>Total</th>{restaurantes.map((restaurante, indice) => <th key={restaurante.ubicacion.id}>{totalRestaurante(indice).toLocaleString('es-MX')}</th>)}</tr></tfoot>
        </table></div>
      </CollapsibleSection>;
    })}</div>}
    {!cargando && !visibles.length && <div className="empty-state"><strong>No hay restaurantes programados</strong><span>Revisa la línea seleccionada, la búsqueda o la configuración de rutas.</span></div>}
    {!semanaCerrada && cambios.length > 0 && <div className="weekly-sales-savebar"><span><strong>{cambios.length}</strong> ventas con cambios sin guardar</span><div><button className="btn btn-secondary" disabled={busy} onClick={() => void guardarSemana(false)}>Guardar</button><button className="btn btn-primary" disabled={busy} onClick={() => void guardarSemana(true)}>Guardar y confirmar</button></div></div>}
  </div>;
}
