import { useEffect, useRef, useState } from 'react';
import NodoIsotipo from './NodoIsotipo';

/**
 * Intro de bienvenida: aparece el isotipo (animado) y el wordmark NODO, luego se
 * desvanece para revelar el menú de bienvenida (login). Tap/click para saltar.
 */
export default function SplashIntro({ onDone }: { onDone: () => void }) {
  const [saliendo, setSaliendo] = useState(false);
  const cerrado = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const holdMs = reduce ? 800 : 2700;
    const t1 = setTimeout(() => setSaliendo(true), holdMs);
    const t2 = setTimeout(finalizar, holdMs + 650);
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
    setTimeout(finalizar, 400);
  }

  return (
    <div className={`splash ${saliendo ? 'splash--out' : ''}`} onClick={saltar} role="presentation">
      <div className="splash-lockup">
        <NodoIsotipo size={132} animated glow />
        <div className="splash-word">NODO</div>
      </div>
    </div>
  );
}
