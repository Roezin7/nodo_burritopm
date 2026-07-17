import { useEffect, useRef, useState } from 'react';
import NodoIsotipo from './NodoIsotipo';

/**
 * Intro de bienvenida co-branded: auroras de color en movimiento, el isotipo NODO se
 * dibuja, entra el wordmark "NODO" y luego sube el logo de Burrito Parrilla. Flota suave
 * y permanece visible hasta que el usuario toca o hace clic para entrar.
 */
export default function SplashIntro({ onDone }: { onDone: () => void }) {
  const [saliendo, setSaliendo] = useState(false);
  const cerrado = useRef(false);
  const salidaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (salidaTimer.current) clearTimeout(salidaTimer.current);
    };
  }, []);

  function finalizar() {
    if (cerrado.current) return;
    cerrado.current = true;
    onDone();
  }

  function entrar() {
    if (saliendo || cerrado.current) return;
    setSaliendo(true);
    salidaTimer.current = setTimeout(finalizar, 650);
  }

  function manejarTeclado(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    entrar();
  }

  return (
    <div
      className={`splash ${saliendo ? 'splash--out' : ''}`}
      onClick={entrar}
      onKeyDown={manejarTeclado}
      role="button"
      tabIndex={0}
      aria-label="Toca para entrar a la aplicación"
    >
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
