import { useEffect, useRef, useState } from 'react';
import NodoIsotipo from './NodoIsotipo';

/**
 * Intro de bienvenida co-branded: auroras de color en movimiento, el isotipo NODO se
 * dibuja, entra el wordmark "NODO" y luego sube el logo de Burrito Parrilla. Flota suave
 * y se desvanece para revelar el login. Tap/click para saltar.
 */
export default function SplashIntro({ onDone }: { onDone: () => void }) {
  const [saliendo, setSaliendo] = useState(false);
  const cerrado = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const holdMs = reduce ? 900 : 3000;
    const t1 = setTimeout(() => setSaliendo(true), holdMs);
    const t2 = setTimeout(finalizar, holdMs + 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finalizar() {
    if (cerrado.current) return;
    cerrado.current = true;
    onDone();
  }

  function saltar() {
    setSaliendo(true);
    setTimeout(finalizar, 420);
  }

  return (
    <div className={`splash ${saliendo ? 'splash--out' : ''}`} onClick={saltar} role="presentation">
      <div className="splash-aurora" aria-hidden="true" />
      <div className="splash-stage">
        <div className="splash-lockup">
          <NodoIsotipo size={120} animated glow />
          <div className="splash-word">NODO</div>
        </div>
        <img
          className="splash-burrito"
          src="/burrito-logo-dark.png"
          alt="Burrito Parrilla Mexicana"
          draggable={false}
        />
      </div>
      <span className="splash-skip">Toca para entrar</span>
    </div>
  );
}
