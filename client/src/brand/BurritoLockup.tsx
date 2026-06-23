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
 * Lockup de marca: isotipo NODO + wordmark "NODO·BurritoPM" donde "Burrito" toma el
 * verde de la parrilla. Es la versión co-branded de NODO para Burrito Parrilla Mexicana.
 */
export default function BurritoLockup({ size = 32, variante = 'rail', animated = false, glow = false }: Props) {
  return (
    <div className={`bpm-lockup bpm-lockup--${variante}`}>
      <NodoIsotipo size={size} animated={animated} glow={glow} />
      <div className="bpm-lockup-text">
        <span className="bpm-lockup-nodo">NODO</span>
        <span className="bpm-lockup-burrito">
          Burrito<span className="bpm-lockup-pm">PM</span>
        </span>
      </div>
    </div>
  );
}
