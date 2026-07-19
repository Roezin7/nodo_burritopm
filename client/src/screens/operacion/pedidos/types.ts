import type { SemanaSeleccionada } from '../../../semana';

export type Linea = 'carne' | 'desechables';

export interface Catalogo {
  ubicaciones: { id: number; nombre: string; codigo: string; tipo: string; empresa: { id: number; nombre: string; codigo: string } | null; entrega_en: { id: number; nombre: string } | null }[];
  productos: { id: number; sku: string; nombre: string; linea: Linea; tipo: string; unidad: string; precio: number | null; precio_pendiente: boolean; peso_caja_lb: number | null }[];
  plantillas: { id: number; nombre: string; codigo: string; linea: Linea; dia_semana: number; conductor: string; paradas: { ubicacion_id: number; nombre: string; orden: number; opcional: boolean }[] }[];
  calendario_pedidos: { ubicacion_id: number; linea: Linea; dia_semana: number; rutas: { id: number; nombre: string; codigo: string; conductor: string }[] }[];
  semanas: { id: number; anio: number; semana: number; inicia_at: string; termina_at: string; estado: string }[];
}

export interface Pedido {
  id: number; linea: Linea; fecha_entrega: string; estado: string; actualizado_at: string; notas?: string | null;
  empresa: { id: number; nombre: string; codigo: string };
  ubicacion: { id: number; nombre: string; entrega_en: { id: number; nombre: string } | null };
  lineas: { id: number; product_id: number; nombre: string; sku: string; linea_producto?: Linea; cantidad: number; precio: number | null }[];
}

export interface ResultadoConfirmacion {
  confirmados: number;
  borradores_vacios: number;
  cobertura_bpm: { fecha: string; total: number; confirmados: number; pendientes: string[] }[];
  preparaciones?: { creadas: number; existentes: number; aprobadas: number };
}

export interface EntregaOpcion {
  fecha: string;
  semana: number;
  rutas: Catalogo['calendario_pedidos'][number]['rutas'];
}

export const lineasDeVenta = (pedido: Pedido, linea: Linea) => pedido.lineas.filter((detalle) => (detalle.linea_producto ?? pedido.linea) === linea);

export function hoy() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); }
export const usd = (n: number | null) => n == null ? 'Precio pendiente' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const esPieza = (p: { unidad: string }) => p.unidad.toLowerCase().includes('pieza');
export const unidadCorta = (p: { unidad: string }) => esPieza(p) ? 'pzas' : 'cajas';
export const fechaLarga = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fechaEntregaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });

export function entregasDeSemana(calendario: Catalogo['calendario_pedidos'], ubicacionId: string, linea: Linea, semana: SemanaSeleccionada): EntregaOpcion[] {
  const programadas = calendario.filter((c) => String(c.ubicacion_id) === ubicacionId && c.linea === linea);
  if (!programadas.length) return [];
  const resultado: EntregaOpcion[] = [];
  for (let iso = semana.inicio; iso <= semana.fin;) {
    const fecha = new Date(`${iso}T12:00:00`);
    const programa = programadas.find((c) => c.dia_semana === fecha.getDay());
    if (programa) resultado.push({ fecha: iso, semana: semana.numero, rutas: programa.rutas });
    fecha.setDate(fecha.getDate() + 1);
    iso = fecha.toLocaleDateString('en-CA');
  }
  return resultado;
}

export const clavePedidoSemanal = (ubicacionId: number, fechaEntrega: string) => `${ubicacionId}|${fechaEntrega}`;
export const claveCantidadSemanal = (ubicacionId: number, fechaEntrega: string, productId: number) => `${ubicacionId}|${fechaEntrega}|${productId}`;
export const pedidoEditable = (pedido?: Pedido) => !pedido || !['cerrado', 'cancelado'].includes(pedido.estado);
export const abreviaturasUbicacion: Record<string, string> = {
  LOMBA: 'LO', NAPER: 'NA', CAROL: 'CS', LISLE: 'LI', GLEND: 'GH', WESTC: 'WEST', BATAV: 'BT', ALGON: 'AL',
  NAPER2: 'N2', ROLLI: 'RM', SCHAU: 'SC', CRYST: 'CRY-L', LAKEZ: 'LZ', FRANK: 'FR', PLAIN: 'PL', AUROR: 'AUR',
  TGE: 'T-GE', TLO: 'T-LO', TST: 'T-ST', TNA: 'T-NA', TBO: 'T-BO',
};
export const abreviaturaUbicacion = (ubicacion: Catalogo['ubicaciones'][number]) => abreviaturasUbicacion[ubicacion.codigo] ?? ubicacion.codigo.slice(0, 5).toUpperCase();
