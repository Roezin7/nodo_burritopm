export interface SemanaSeleccionada {
  inicio: string;
  fin: string;
  anio: number;
  numero: number;
  actual: boolean;
}

export const hoyChicago = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

const isoLocal = (d: Date) => d.toLocaleDateString('en-CA');

export function inicioDeSemana(valor: string) {
  const d = new Date(`${valor}T12:00:00`);
  if (Number.isNaN(d.getTime())) return inicioDeSemana(hoyChicago());
  d.setDate(d.getDate() - d.getDay());
  return isoLocal(d);
}

function datosIso(valor: string) {
  const d = new Date(`${valor}T00:00:00.000Z`);
  // La semana operativa abre el domingo, pero conserva el número ISO del lunes
  // que le sigue. Ejemplo: dom 19 jul 2026 pertenece a la semana 30.
  d.setUTCDate(d.getUTCDate() - d.getUTCDay() + 1);
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { anio: d.getUTCFullYear(), numero: Math.ceil((((d.getTime() - inicio.getTime()) / 86400000) + 1) / 7) };
}

export const numeroDeSemana = (valor: string) => datosIso(valor).numero;

export function crearSemana(valor = hoyChicago()): SemanaSeleccionada {
  const inicio = inicioDeSemana(valor);
  const d = new Date(`${inicio}T12:00:00`);
  d.setDate(d.getDate() + 6);
  const datos = datosIso(inicio);
  return {
    inicio,
    fin: isoLocal(d),
    anio: datos.anio,
    numero: datos.numero,
    actual: inicio === inicioDeSemana(hoyChicago()),
  };
}

export function moverSemana(semana: SemanaSeleccionada, cantidad: number) {
  const d = new Date(`${semana.inicio}T12:00:00`);
  d.setDate(d.getDate() + cantidad * 7);
  return crearSemana(isoLocal(d));
}

export function semanasAlrededor(centro: SemanaSeleccionada, anteriores = 104, siguientes = 52) {
  const opciones: SemanaSeleccionada[] = [];
  for (let i = -anteriores; i <= siguientes; i += 1) opciones.push(moverSemana(centro, i));
  return opciones.reverse();
}

export function fechaDentroDeSemana(semana: SemanaSeleccionada) {
  const hoy = hoyChicago();
  return hoy >= semana.inicio && hoy <= semana.fin ? hoy : semana.fin;
}

export const rangoQuery = (semana: SemanaSeleccionada) => `desde=${semana.inicio}&hasta=${semana.fin}`;

export function etiquetaRango(semana: SemanaSeleccionada) {
  const inicio = new Date(`${semana.inicio}T12:00:00`);
  const fin = new Date(`${semana.fin}T12:00:00`);
  const a = inicio.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  const b = fin.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${a}–${b}`;
}
