import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LineaOperacion } from './operationOrder';

const LINEAS: readonly LineaOperacion[] = ['carne', 'desechables'];

function esLinea(valor: string | null): valor is LineaOperacion {
  return valor != null && LINEAS.includes(valor as LineaOperacion);
}

/** Mantiene visible y estable la línea de operación entre pantallas. */
export function useLineaOperacion(predeterminada: LineaOperacion = 'carne') {
  const [params, setParams] = useSearchParams();
  const lineaUrl = params.get('linea');
  const [linea, setLinea] = useState<LineaOperacion>(esLinea(lineaUrl) ? lineaUrl : predeterminada);

  useEffect(() => {
    if (esLinea(lineaUrl)) {
      setLinea((actual) => actual === lineaUrl ? actual : lineaUrl);
      return;
    }
    const siguientes = new URLSearchParams(params);
    siguientes.set('linea', linea);
    setParams(siguientes, { replace: true });
  }, [lineaUrl, linea, params, setParams]);

  function cambiarLinea(siguiente: LineaOperacion) {
    setLinea(siguiente);
    const siguientes = new URLSearchParams(params);
    siguientes.set('linea', siguiente);
    setParams(siguientes, { replace: true });
  }

  return { linea, cambiarLinea };
}
