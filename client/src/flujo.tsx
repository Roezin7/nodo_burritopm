// Lenguaje visual compartido del flujo de abastecimiento: chips de estado consistentes
// y el stepper de 5 pasos (Inventario → Plan → Bodega → Ruta → Recepción), interactivo.
import { NavLink } from 'react-router-dom';
import { useAuth, type Rol } from './auth';

// ── Estado de la distribución ──────────────────────────────────────────────
const DIST: Record<string, { label: string; cls: string }> = {
  calculada: { label: 'Calculada', cls: 'chip--info' },
  en_revision: { label: 'En revisión', cls: 'chip--warn' },
  aprobada: { label: 'Aprobada', cls: 'chip--ok' },
  en_preparacion: { label: 'Surtiendo', cls: 'chip--info' },
  preparada: { label: 'Surtida', cls: 'chip--info' },
  verificada: { label: 'Verificada', cls: 'chip--info' },
  en_carga: { label: 'Cargando', cls: 'chip--info' },
  cargada: { label: 'Cargada', cls: 'chip--info' },
  en_transito: { label: 'En ruta', cls: 'chip--accent' },
  parcialmente_entregada: { label: 'Entrega parcial', cls: 'chip--warn' },
  entregada: { label: 'Entregada', cls: 'chip--ok' },
  cerrada: { label: 'Cerrada', cls: 'chip--ok' },
  cerrada_con_incidencias: { label: 'Cerrada c/ incidencias', cls: 'chip--warn' },
  cancelada: { label: 'Cancelada', cls: 'chip--danger' },
};

export function EstadoDistChip({ estado }: { estado: string }) {
  const e = DIST[estado];
  return <span className={`chip chip-estado ${e?.cls ?? 'chip--muted'}`}>{e?.label ?? estado}</span>;
}

// ── Fase del pedido: agrupa los 16 estados en 4 fases legibles (para no confundir al admin) ──
export type FaseDist = 'planeacion' | 'bodega' | 'ruta' | 'recibido' | 'cancelada';
const FASE_DE: Record<string, FaseDist> = {
  borrador: 'planeacion', esperando_conteos: 'planeacion', calculada: 'planeacion', en_revision: 'planeacion', aprobada: 'planeacion',
  en_preparacion: 'bodega', preparada: 'bodega', verificada: 'bodega', en_carga: 'bodega', cargada: 'bodega',
  en_transito: 'ruta', parcialmente_entregada: 'ruta',
  entregada: 'recibido', cerrada: 'recibido', cerrada_con_incidencias: 'recibido',
  cancelada: 'cancelada',
};
const FASE_META: Record<FaseDist, { label: string; cls: string }> = {
  planeacion: { label: 'Planeación', cls: 'chip--info' },
  bodega: { label: 'En bodega', cls: 'chip--accent' },
  ruta: { label: 'En ruta', cls: 'chip--warn' },
  recibido: { label: 'Recibido', cls: 'chip--ok' },
  cancelada: { label: 'Cancelada', cls: 'chip--danger' },
};

export function faseDistribucion(estado: string): { clave: FaseDist; label: string; cls: string } {
  const clave = FASE_DE[estado] ?? 'planeacion';
  return { clave, ...FASE_META[clave] };
}

/** Chip de FASE (4 fases) — vista simple del admin. El detalle granular usa EstadoDistChip. */
export function FaseChip({ estado }: { estado: string }) {
  const f = faseDistribucion(estado);
  return <span className={`chip chip-estado ${f.cls}`}>{f.label}</span>;
}

// ── Estado de una parada de ruta ───────────────────────────────────────────
const PARADA: Record<string, { label: string; cls: string }> = {
  pendiente: { label: 'Pendiente', cls: 'chip--muted' },
  en_camino: { label: 'En camino', cls: 'chip--warn' },
  entregada: { label: 'Entregada', cls: 'chip--info' },
  confirmada: { label: 'Confirmada', cls: 'chip--ok' },
  con_incidencia: { label: 'Con incidencia', cls: 'chip--danger' },
  omitida: { label: 'Omitida', cls: 'chip--muted' },
};

export function ParadaChip({ estado }: { estado: string }) {
  const e = PARADA[estado];
  return <span className={`chip chip-estado ${e?.cls ?? 'chip--muted'}`}>{e?.label ?? estado}</span>;
}

export const paradaLabel = (estado: string) => PARADA[estado]?.label ?? estado;

// ── Stepper de 5 pasos (menú interactivo) ──────────────────────────────────
export type PasoFlujo = 'conteo' | 'plan' | 'bodega' | 'ruta' | 'recepcion';
const PASOS: { clave: PasoFlujo; label: string; ruta: string; roles: Rol[] }[] = [
  { clave: 'conteo', label: 'Ventas', ruta: '/semana/ventas', roles: ['admin', 'encargado_sucursal'] },
  { clave: 'plan', label: 'Preparación', ruta: '/distribucion', roles: ['admin'] },
  { clave: 'bodega', label: 'Despacho', ruta: '/bodega', roles: ['admin', 'encargado_bodega'] },
  { clave: 'ruta', label: 'Reparto', ruta: '/ruta', roles: ['admin', 'encargado_bodega'] },
  { clave: 'recepcion', label: 'Recepción', ruta: '/recepcion', roles: ['admin', 'encargado_sucursal'] },
];

/**
 * Barra de pasos interactiva: marca el paso activo y los previos como completados; cada paso
 * navega a su pantalla. Los pasos que el rol no puede abrir quedan deshabilitados (solo contexto).
 */
export function FlujoStepper({ activo }: { activo: PasoFlujo }) {
  const { usuario } = useAuth();
  const idxActivo = PASOS.findIndex((p) => p.clave === activo);
  return (
    <nav className="flujo-stepper" aria-label="Etapas del abastecimiento">
      {PASOS.map((p, i) => {
        const estado = i < idxActivo ? 'done' : i === idxActivo ? 'on' : 'todo';
        const accesible = !!usuario && p.roles.includes(usuario.rol);
        const cls = `flujo-paso ${estado === 'on' ? 'flujo-paso--on' : ''} ${estado === 'done' ? 'flujo-paso--done' : ''} ${accesible ? 'flujo-paso--link' : 'flujo-paso--off'}`;
        const contenido = (
          <>
            <span className="flujo-num">{estado === 'done' ? '✓' : i + 1}</span>
            {p.label}
          </>
        );
        return (
          <div key={p.clave} style={{ display: 'contents' }}>
            {accesible ? (
              <NavLink to={p.ruta} end className={cls} aria-current={estado === 'on' ? 'page' : undefined}>
                {contenido}
              </NavLink>
            ) : (
              <span className={cls} aria-disabled="true" title="No disponible para tu rol">{contenido}</span>
            )}
            {i < PASOS.length - 1 && <span className="flujo-sep">›</span>}
          </div>
        );
      })}
    </nav>
  );
}
