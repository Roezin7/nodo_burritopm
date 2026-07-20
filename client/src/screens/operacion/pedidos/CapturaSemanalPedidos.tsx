import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api, ApiError, fueEncolado, type Encolado } from '../../../api';
import Spinner from '../../../components/Spinner';
import { useToast } from '../../../toast';
import { filasOrden, productosParaPedido } from '../../../operationOrder';
import { etiquetaRango, type SemanaSeleccionada } from '../../../semana';
import CollapsibleSection from '../../../components/CollapsibleSection';
import { Icono } from '../../../icons';
import { guardarBorradorLocal, leerBorradorLocal, useUnsavedChanges } from '../../../use-unsaved';
import {
  abreviaturaUbicacion, claveCantidadSemanal, clavePedidoSemanal, entregasDeSemana, esPieza,
  fechaEntregaCorta, fechaLarga, lineasDeVenta, pedidoEditable, usd,
  type Catalogo, type Linea, type Pedido, type ResultadoConfirmacion,
} from './types';

interface SeleccionMatriz {
  fecha: string;
  filaInicio: number;
  columnaInicio: number;
  filaFin: number;
  columnaFin: number;
}

const limitesSeleccion = (seleccion: SeleccionMatriz) => ({
  filaMin: Math.min(seleccion.filaInicio, seleccion.filaFin),
  filaMax: Math.max(seleccion.filaInicio, seleccion.filaFin),
  columnaMin: Math.min(seleccion.columnaInicio, seleccion.columnaFin),
  columnaMax: Math.max(seleccion.columnaInicio, seleccion.columnaFin),
});

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
  const [seleccion, setSeleccion] = useState<SeleccionMatriz | null>(null);
  const arrastrandoSeleccion = useRef(false);
  const restauradoRef = useRef<string | null>(null);

  const programadas = useMemo(() => ubicaciones.map((ubicacion) => ({
    ubicacion,
    entregas: entregasDeSemana(catalogo.calendario_pedidos, String(ubicacion.id), linea, semana),
    productos: productosParaPedido(catalogo.productos, linea, ubicacion.empresa?.codigo),
  })).filter((fila) => fila.entregas.length > 0), [ubicaciones, catalogo, linea, semana.inicio, semana.fin]);
  const claveBorrador = `bpm-borrador-ventas:${semana.inicio}:${linea}`;
  useUnsavedChanges(cambios.length > 0);

  useEffect(() => {
    const terminarArrastre = () => { arrastrandoSeleccion.current = false; };
    window.addEventListener('mouseup', terminarArrastre);
    return () => window.removeEventListener('mouseup', terminarArrastre);
  }, []);

  useEffect(() => { setSeleccion(null); }, [linea, semana.inicio, semana.fin, buscar]);

  useEffect(() => {
    const actualizarSiSeguro = () => {
      if (document.visibilityState === 'visible' && cambios.length === 0) setRefresco((actual) => actual + 1);
    };
    const alCambiarVisibilidad = () => { if (document.visibilityState === 'visible') actualizarSiSeguro(); };
    window.addEventListener('focus', actualizarSiSeguro);
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    const intervalo = window.setInterval(actualizarSiSeguro, 45_000);
    return () => {
      window.removeEventListener('focus', actualizarSiSeguro);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      window.clearInterval(intervalo);
    };
  }, [cambios.length]);

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
  const celdasEnSeleccion = seleccion ? (() => {
    const limites = limitesSeleccion(seleccion);
    return (limites.filaMax - limites.filaMin + 1) * (limites.columnaMax - limites.columnaMin + 1);
  })() : 0;

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

  function seleccionarCelda(fecha: string, fila: number, columna: number, extender = false) {
    setSeleccion((actual) => extender && actual?.fecha === fecha
      ? { ...actual, filaFin: fila, columnaFin: columna }
      : { fecha, filaInicio: fila, columnaInicio: columna, filaFin: fila, columnaFin: columna });
  }

  function seleccionarRango(nuevaSeleccion: SeleccionMatriz) {
    setSeleccion(nuevaSeleccion);
    requestAnimationFrame(() => {
      const primera = inputsDeSeleccion(nuevaSeleccion).find((input) => !input.disabled);
      primera?.focus();
      primera?.select();
    });
  }

  function estaSeleccionada(fecha: string, fila: number, columna: number) {
    if (!seleccion || seleccion.fecha !== fecha) return false;
    const limites = limitesSeleccion(seleccion);
    return fila >= limites.filaMin && fila <= limites.filaMax
      && columna >= limites.columnaMin && columna <= limites.columnaMax;
  }

  function inputsDeSeleccion(seleccionObjetivo = seleccion) {
    if (!seleccionObjetivo) return [];
    const limites = limitesSeleccion(seleccionObjetivo);
    return [...document.querySelectorAll<HTMLInputElement>('input[data-grid-mode="desktop"][data-weekly-matrix-input]')]
      .filter((input) => input.dataset.gridDate === seleccionObjetivo.fecha
        && Number(input.dataset.gridRow) >= limites.filaMin
        && Number(input.dataset.gridRow) <= limites.filaMax
        && Number(input.dataset.gridColumn) >= limites.columnaMin
        && Number(input.dataset.gridColumn) <= limites.columnaMax);
  }

  function borrarSeleccion() {
    aplicarValores(inputsDeSeleccion().filter((input) => !input.disabled && input.dataset.gridKey)
      .map((input) => ({ clave: input.dataset.gridKey!, valor: '' })));
  }

  function copiarSeleccion(evento: ReactClipboardEvent<HTMLInputElement>, fecha: string, fila: number, columna: number) {
    const objetivo = seleccion?.fecha === fecha ? seleccion : { fecha, filaInicio: fila, filaFin: fila, columnaInicio: columna, columnaFin: columna };
    const limites = limitesSeleccion(objetivo);
    const valores = new Map(inputsDeSeleccion(objetivo).map((input) => [`${input.dataset.gridRow}|${input.dataset.gridColumn}`, input.value]));
    const filasCopiadas: string[] = [];
    for (let filaActual = limites.filaMin; filaActual <= limites.filaMax; filaActual += 1) {
      const columnas: string[] = [];
      for (let columnaActual = limites.columnaMin; columnaActual <= limites.columnaMax; columnaActual += 1) {
        columnas.push(valores.get(`${filaActual}|${columnaActual}`) ?? '');
      }
      filasCopiadas.push(columnas.join('\t'));
    }
    evento.preventDefault();
    evento.clipboardData.setData('text/plain', filasCopiadas.join('\n'));
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
    evento.preventDefault();
    const matriz = textoPegado.replace(/\r?\n$/, '').split(/\r?\n/).map((renglon) => renglon.split('\t'));
    const entradas: { clave: string; valor: string }[] = [];
    const limpiar = (crudo: string) => {
      const limpio = crudo.trim().replace(/[$,]/g, '');
      return limpio === '' || (Number.isFinite(Number(limpio)) && Number(limpio) >= 0) ? limpio : null;
    };

    const valorUnico = matriz.length === 1 && matriz[0].length === 1 ? limpiar(matriz[0][0]) : null;
    const seleccionMultiple = seleccion?.fecha === fechaEntrega
      && (seleccion.filaInicio !== seleccion.filaFin || seleccion.columnaInicio !== seleccion.columnaFin);
    if (valorUnico !== null && seleccionMultiple) {
      aplicarValores(inputsDeSeleccion().filter((input) => !input.disabled && input.dataset.gridKey)
        .map((input) => ({ clave: input.dataset.gridKey!, valor: valorUnico })));
      return;
    }

    for (const [desplazamientoFila, renglon] of matriz.entries()) {
      const fila = filas[filaInicio + desplazamientoFila];
      if (!fila) break;
      for (const [desplazamientoColumna, crudo] of renglon.entries()) {
        const columna = columnaInicio + desplazamientoColumna;
        const restaurante = restaurantes[columna];
        const producto = fila.productos[columna];
        const pedido = restaurante ? porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega)) : undefined;
        if (!restaurante || !producto || !pedidoEditable(pedido)) continue;
        const limpio = limpiar(crudo);
        if (limpio === null) continue;
        entradas.push({ clave: claveCantidadSemanal(restaurante.ubicacion.id, fechaEntrega, producto.id), valor: limpio });
      }
    }
    aplicarValores(entradas);
    setSeleccion({
      fecha: fechaEntrega,
      filaInicio,
      columnaInicio,
      filaFin: Math.min(filas.length - 1, filaInicio + matriz.length - 1),
      columnaFin: Math.min(restaurantes.length - 1, columnaInicio + Math.max(...matriz.map((fila) => fila.length)) - 1),
    });
  }

  function navegarMatriz(evento: ReactKeyboardEvent<HTMLInputElement>, modo: 'desktop' | 'mobile') {
    const modificador = evento.metaKey || evento.ctrlKey;
    if (modo === 'desktop' && modificador && evento.key.toLowerCase() === 'z') {
      evento.preventDefault();
      deshacer();
      return;
    }
    if (modo === 'desktop' && modificador && evento.key.toLowerCase() === 'a') {
      evento.preventDefault();
      const fecha = evento.currentTarget.dataset.gridDate!;
      const celdasFecha = [...document.querySelectorAll<HTMLInputElement>(`input[data-grid-mode="desktop"][data-grid-date="${fecha}"]`)]
        .filter((input) => !input.disabled);
      if (!celdasFecha.length) return;
      const filas = celdasFecha.map((input) => Number(input.dataset.gridRow));
      const columnas = celdasFecha.map((input) => Number(input.dataset.gridColumn));
      seleccionarRango({ fecha, filaInicio: Math.min(...filas), filaFin: Math.max(...filas), columnaInicio: Math.min(...columnas), columnaFin: Math.max(...columnas) });
      return;
    }
    if (modo === 'desktop' && (evento.key === 'Delete' || evento.key === 'Backspace')) {
      evento.preventDefault();
      borrarSeleccion();
      return;
    }
    if (modo === 'desktop' && evento.key === 'Escape') {
      seleccionarCelda(evento.currentTarget.dataset.gridDate!, Number(evento.currentTarget.dataset.gridRow), Number(evento.currentTarget.dataset.gridColumn));
      return;
    }

    const esAvance = evento.key === 'Enter' || evento.key === 'Tab';
    const esFlecha = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(evento.key);
    if (!esAvance && !esFlecha) return;
    evento.preventDefault();
    const fecha = evento.currentTarget.dataset.gridDate;
    const celdas = [...document.querySelectorAll<HTMLInputElement>(`input[data-grid-mode="${modo}"][data-weekly-matrix-input]:not(:disabled)`)]
      .filter((input) => modo === 'mobile' || input.dataset.gridDate === fecha)
      .sort((a, b) => Number(a.dataset.navOrder) - Number(b.dataset.navOrder));
    const actual = celdas.indexOf(evento.currentTarget);
    if (actual < 0) return;
    let siguiente: HTMLInputElement | undefined;
    if (modo === 'mobile' || esAvance) {
      siguiente = celdas[actual + (evento.shiftKey ? -1 : 1)];
    } else {
      const fila = Number(evento.currentTarget.dataset.gridRow);
      const columna = Number(evento.currentTarget.dataset.gridColumn);
      const candidatas = celdas.filter((input) => {
        const otraFila = Number(input.dataset.gridRow);
        const otraColumna = Number(input.dataset.gridColumn);
        if (evento.key === 'ArrowLeft') return otraFila === fila && otraColumna < columna;
        if (evento.key === 'ArrowRight') return otraFila === fila && otraColumna > columna;
        if (evento.key === 'ArrowUp') return otraColumna === columna && otraFila < fila;
        if (evento.key === 'ArrowDown') return otraColumna === columna && otraFila > fila;
        return otraFila === fila;
      });
      if (evento.key === 'ArrowLeft' || evento.key === 'ArrowUp' || evento.key === 'End') siguiente = candidatas.at(-1);
      else siguiente = candidatas[0];
    }
    if (!siguiente) return;
    if (modo === 'desktop') seleccionarCelda(siguiente.dataset.gridDate!, Number(siguiente.dataset.gridRow), Number(siguiente.dataset.gridColumn), evento.shiftKey);
    siguiente.focus();
    siguiente.select();
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
      <div className="weekly-sales-toolbar-actions"><button className="btn btn-ghost" disabled={cargando || busy || cambios.length > 0} title={cambios.length > 0 ? 'Guarda o descarta tus cambios antes de actualizar' : 'Traer los pedidos más recientes'} onClick={() => setRefresco((actual) => actual + 1)}><Icono name="refresh" size={16} /> Actualizar</button>{historialCambios.length > 0 && <button className="btn btn-ghost" disabled={busy} onClick={deshacer}>Deshacer</button>}<button className="btn btn-secondary" disabled={cargando || busy || semanaCerrada} onClick={() => setHerramientas((actual) => !actual)}>{herramientas ? 'Cerrar herramientas' : 'Herramientas'}</button>{cambios.length === 0 && <button className="btn btn-primary" disabled={cargando || busy || semanaCerrada} onClick={() => void guardarSemana(true)}>{busy ? 'Confirmando…' : 'Confirmar semana'}</button>}</div>
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
    <div className="matrix-edit-guide" role="note">
      <span><strong>Captura rápida:</strong> Enter avanza por columnas · flechas para navegar · Shift extiende · Delete borra · ⌘/Ctrl+C, V y Z funcionan como en Excel.</span>
      {seleccion && <div><b>{celdasEnSeleccion} {celdasEnSeleccion === 1 ? 'celda seleccionada' : 'celdas seleccionadas'}</b><button type="button" className="link-btn txt-danger" disabled={semanaCerrada} onClick={borrarSeleccion}>Borrar selección</button><button type="button" className="link-btn" onClick={() => setSeleccion(null)}>Cancelar</button></div>}
    </div>
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
        <div className="weekly-sales-matrix-wrap"><table className="weekly-sales-matrix" onDragStart={(evento) => evento.preventDefault()}>
          <thead><tr><th><button type="button" className="matrix-header-button" aria-label={`Seleccionar toda la tabla del ${fechaLarga(fechaEntrega)}`} onClick={() => seleccionarRango({ fecha: fechaEntrega, filaInicio: 0, filaFin: filas.length - 1, columnaInicio: 0, columnaFin: restaurantes.length - 1 })}>Todo</button></th><th>Item</th>{restaurantes.map((restaurante, columnaIndice) => {
            const pedido = porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega));
            const columnaSeleccionada = seleccion?.fecha === fechaEntrega && columnaIndice >= limitesSeleccion(seleccion).columnaMin && columnaIndice <= limitesSeleccion(seleccion).columnaMax;
            return <th className={columnaSeleccionada ? 'matrix-header-selected' : ''} key={restaurante.ubicacion.id} title={`${restaurante.ubicacion.nombre} · ${pedido?.estado.replaceAll('_', ' ') ?? 'sin capturar'}`}><button type="button" className="matrix-header-button" onClick={() => seleccionarRango({ fecha: fechaEntrega, filaInicio: 0, filaFin: filas.length - 1, columnaInicio: columnaIndice, columnaFin: columnaIndice })}><strong>{abreviaturaUbicacion(restaurante.ubicacion)}</strong><small>{restaurante.ubicacion.nombre}</small></button><i className={`matrix-status matrix-status--${pedido?.estado ?? 'pendiente'}`} /></th>;
          })}</tr></thead>
          <tbody>{filas.map((fila, filaIndice) => {
            const totalProducto = fila.productos.reduce((total, producto, indice) => total + (producto ? Number(cantidades[claveCantidadSemanal(restaurantes[indice].ubicacion.id, fechaEntrega, producto.id)] || 0) : 0), 0);
            return <tr key={fila.formato.nombre}><th>{totalProducto.toLocaleString('es-MX')}</th><th className={seleccion?.fecha === fechaEntrega && filaIndice >= limitesSeleccion(seleccion).filaMin && filaIndice <= limitesSeleccion(seleccion).filaMax ? 'matrix-header-selected' : ''}><button type="button" className="matrix-row-button" onClick={() => seleccionarRango({ fecha: fechaEntrega, filaInicio: filaIndice, filaFin: filaIndice, columnaInicio: 0, columnaFin: restaurantes.length - 1 })}>{fila.formato.nombre}</button></th>{fila.productos.map((producto, indice) => {
              const restaurante = restaurantes[indice];
              const pedido = porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega));
              if (!producto) return <td key={restaurante.ubicacion.id} className="matrix-cell-empty">—</td>;
              const clave = claveCantidadSemanal(restaurante.ubicacion.id, fechaEntrega, producto.id);
              const modificada = Number(cantidades[clave] || 0) !== Number(cantidadesGuardadas[clave] || 0);
              const seleccionada = estaSeleccionada(fechaEntrega, filaIndice, indice);
              const activa = seleccionada && seleccion?.filaFin === filaIndice && seleccion.columnaFin === indice;
              return <td key={restaurante.ubicacion.id} className={`${!pedidoEditable(pedido) ? 'matrix-cell-locked' : ''} ${modificada ? 'matrix-cell-dirty' : ''} ${seleccionada ? 'matrix-cell-selected' : ''} ${activa ? 'matrix-cell-active' : ''}`}><input data-weekly-matrix-input data-grid-mode="desktop" data-grid-date={fechaEntrega} data-grid-row={filaIndice} data-grid-column={indice} data-grid-key={clave} data-nav-order={fechaIndice * 10000 + filaIndice * 100 + indice} aria-label={`${fila.formato.nombre} · ${restaurante.ubicacion.nombre} · ${fechaEntregaCorta(fechaEntrega)}`} title={`${restaurante.ubicacion.nombre} · ${fila.formato.nombre}`} disabled={semanaCerrada || !pedidoEditable(pedido)} inputMode="decimal" type="number" min="0" step={esPieza(producto) ? '1' : '0.5'} value={cantidades[clave] ?? ''} placeholder="0" onFocus={(e) => e.currentTarget.select()} onMouseDown={(e) => { if (e.button !== 0) return; seleccionarCelda(fechaEntrega, filaIndice, indice, e.shiftKey); arrastrandoSeleccion.current = true; }} onMouseEnter={(e) => { if (arrastrandoSeleccion.current && e.buttons === 1) seleccionarCelda(fechaEntrega, filaIndice, indice, true); }} onCopy={(e) => copiarSeleccion(e, fechaEntrega, filaIndice, indice)} onPaste={(e) => pegarMatriz(e, fechaEntrega, filaIndice, indice, filas, restaurantes)} onKeyDown={(e) => navegarMatriz(e, 'desktop')} onChange={(e) => cambiarCantidad(restaurante.ubicacion.id, fechaEntrega, producto.id, e.target.value)} /></td>;
            })}</tr>;
          })}</tbody>
          <tfoot><tr><th>{totalDia.toLocaleString('es-MX')}</th><th>Total</th>{restaurantes.map((restaurante, indice) => <th key={restaurante.ubicacion.id}>{totalRestaurante(indice).toLocaleString('es-MX')}</th>)}</tr></tfoot>
        </table></div>
        <div className="weekly-sales-mobile-list">
          {restaurantes.map((restaurante, restauranteIndice) => {
            const pedido = porClave.get(clavePedidoSemanal(restaurante.ubicacion.id, fechaEntrega));
            const editable = !semanaCerrada && pedidoEditable(pedido);
            return <article className="weekly-sales-mobile-card" key={restaurante.ubicacion.id}>
              <header>
                <div><strong>{restaurante.ubicacion.nombre}</strong><small>{restaurante.ubicacion.empresa?.nombre ?? 'Restaurante'}</small></div>
                <div><span className={`chip matrix-status-label matrix-status-label--${pedido?.estado ?? 'pendiente'}`}>{pedido?.estado.replaceAll('_', ' ') ?? 'Sin capturar'}</span><b>{totalRestaurante(restauranteIndice).toLocaleString('es-MX')}</b><small>unidades</small></div>
              </header>
              <div className="weekly-sales-mobile-products">
                {filas.map((fila, filaIndice) => {
                  const producto = fila.productos[restauranteIndice];
                  if (!producto) return null;
                  const clave = claveCantidadSemanal(restaurante.ubicacion.id, fechaEntrega, producto.id);
                  const modificada = Number(cantidades[clave] || 0) !== Number(cantidadesGuardadas[clave] || 0);
                  return <label className={modificada ? 'is-dirty' : ''} key={fila.formato.nombre}>
                    <span><strong>{fila.formato.nombre}</strong><small>{producto.unidad}</small></span>
                    <input data-weekly-matrix-input data-grid-mode="mobile" data-nav-order={fechaIndice * 10000 + restauranteIndice * 100 + filaIndice} aria-label={`${fila.formato.nombre} · ${restaurante.ubicacion.nombre} · ${fechaEntregaCorta(fechaEntrega)}`} disabled={!editable} inputMode="decimal" type="number" min="0" step={esPieza(producto) ? '1' : '0.5'} value={cantidades[clave] ?? ''} placeholder="0" onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => navegarMatriz(e, 'mobile')} onChange={(e) => cambiarCantidad(restaurante.ubicacion.id, fechaEntrega, producto.id, e.target.value)} />
                  </label>;
                })}
              </div>
            </article>;
          })}
        </div>
      </CollapsibleSection>;
    })}</div>}
    {!cargando && !visibles.length && <div className="empty-state"><strong>No hay restaurantes programados</strong><span>Revisa la línea seleccionada, la búsqueda o la configuración de rutas.</span></div>}
    {!semanaCerrada && cambios.length > 0 && <div className="weekly-sales-savebar"><span><strong>{cambios.length}</strong> ventas con cambios sin guardar</span><div><button className="btn btn-secondary" disabled={busy} onClick={() => void guardarSemana(false)}>Guardar</button><button className="btn btn-primary" disabled={busy} onClick={() => void guardarSemana(true)}>Guardar y confirmar</button></div></div>}
  </div>;
}
