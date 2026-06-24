import NodoIsotipo from './NodoIsotipo';

interface Props {
  /** Tamaño del isotipo en px. */
  size?: number;
  /** 'rail' (compacto, nav lateral), 'full' (login/splash). */
  variante?: 'rail' | 'full';
  animated?: boolean;
  glow?: boolean;
}

/**
 * Lockup de marca fiel al logo real: "burrito" en script verde sobre "PARRILLA MEXICANA",
 * acompañado del isotipo NODO (marca de la plataforma).
 */
export default function BurritoLockup({ size = 32, variante = 'rail', animated = false, glow = false }: Props) {
  return (
    <div className={`bpm-lockup bpm-lockup--${variante}`}>
      <NodoIsotipo size={size} animated={animated} glow={glow} />
      <div className="bpm-lockup-text">
        <span className="bpm-wm-burrito">burrito</span>
        <span className="bpm-wm-sub">Parrilla Mexicana<sup>®</sup></span>
      </div>
    </div>
  );
}
