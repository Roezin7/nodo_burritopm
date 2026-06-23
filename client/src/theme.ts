import { useEffect, useState } from 'react';

export type Tema = 'light' | 'dark';

const CLAVE = 'bpm-tema';

function temaActual(): Tema {
  const v = document.documentElement.dataset.tema;
  return v === 'dark' ? 'dark' : 'light';
}

function aplicar(t: Tema) {
  document.documentElement.dataset.tema = t;
  try {
    localStorage.setItem(CLAVE, t);
  } catch {
    /* almacenamiento no disponible: el tema vive solo en memoria */
  }
}

/** Hook de tema claro/oscuro. El valor inicial lo resuelve el script en index.html. */
export function useTema(): { tema: Tema; alternar: () => void } {
  const [tema, setTema] = useState<Tema>(temaActual);

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
  }, [tema]);

  return {
    tema,
    alternar: () => {
      const siguiente: Tema = tema === 'dark' ? 'light' : 'dark';
      aplicar(siguiente);
      setTema(siguiente);
    },
  };
}
