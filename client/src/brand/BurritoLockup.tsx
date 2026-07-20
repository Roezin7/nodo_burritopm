import NodoIsotipo from './NodoIsotipo';

interface Props {
  /** Tamaño del isotipo NODO en px. */
  size?: number;
  /** 'rail' (compacto, nav lateral), 'full' (login/splash). */
  variante?: 'rail' | 'full';
  animated?: boolean;
  glow?: boolean;
}

/**
 * Lockup co-branded: NODO (isotipo + wordmark) arriba y el logo de Burrito abajo.
 * Se muestra el logo con subtítulo negro en tema claro y el de subtítulo blanco en oscuro.
 */
export default function BurritoLockup({ size = 32, variante = 'rail', animated = false, glow = false }: Props) {
  return (
    <div className={`bpm-lockup bpm-lockup--${variante}`}>
      <div className="bpm-lockup-nodo">
        <NodoIsotipo size={size} animated={animated} glow={glow} />
        <span className="bpm-lockup-word">NODO</span>
      </div>
      <img className={`bpm-logo bpm-logo--${variante}`} src="/burrito-logo.png" alt="Burrito Parrilla Mexicana" draggable={false} />
    </div>
  );
}
