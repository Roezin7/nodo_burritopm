// Lenguaje visual compartido del flujo de abastecimiento: chips de estado consistentes
// y el stepper de 5 pasos (Conteo → Plan → Bodega → Ruta → Recepción).

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

// ── Stepper de 5 pasos ─────────────────────────────────────────────────────
export type PasoFlujo = 'conteo' | 'plan' | 'bodega' | 'ruta' | 'recepcion';
const PASOS: { clave: PasoFlujo; label: string }[] = [
  { clave: 'conteo', label: 'Inventario' },
  { clave: 'plan', label: 'Plan' },
  { clave: 'bodega', label: 'Bodega' },
  { clave: 'ruta', label: 'Ruta' },
  { clave: 'recepcion', label: 'Recepción' },
];

/** Barra de pasos: marca el paso activo y los anteriores como completados. */
export function FlujoStepper({ activo }: { activo: PasoFlujo }) {
  const idxActivo = PASOS.findIndex((p) => p.clave === activo);
  return (
    <div className="flujo-stepper" role="list" aria-label="Etapas del abastecimiento">
      {PASOS.map((p, i) => {
        const estado = i < idxActivo ? 'done' : i === idxActivo ? 'on' : 'todo';
        return (
          <div key={p.clave} className="flujo-stepper-grupo" style={{ display: 'contents' }}>
            <span className={`flujo-paso ${estado === 'on' ? 'flujo-paso--on' : ''} ${estado === 'done' ? 'flujo-paso--done' : ''}`} role="listitem">
              <span className="flujo-num">{estado === 'done' ? '✓' : i + 1}</span>
              {p.label}
            </span>
            {i < PASOS.length - 1 && <span className="flujo-sep">›</span>}
          </div>
        );
      })}
    </div>
  );
}
