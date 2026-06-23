// Isotipo de NODO: grafo de 4 nodos (verde, rojo, ámbar, azul) unidos formando
// un cuadrado con una diagonal. Sirve estático (nav/login) y animado (intro).

export const NODO_COLORS = {
  verde: '#21A645',
  rojo: '#FF3B21',
  ambar: '#FBA61A',
  azul: '#1F8EF1',
  edge: '#1b2735',
};

const N = {
  tl: [30, 30],
  tr: [70, 30],
  bl: [30, 70],
  br: [70, 70],
} as const;

// edges con orden de aparición (delay escalonado en la animación)
const EDGES: [keyof typeof N, keyof typeof N][] = [
  ['tl', 'tr'], // arriba
  ['tr', 'br'], // derecha
  ['br', 'bl'], // abajo
  ['bl', 'tl'], // izquierda
  ['tl', 'br'], // diagonal
];

const NODES: { pos: keyof typeof N; color: string }[] = [
  { pos: 'tl', color: NODO_COLORS.verde },
  { pos: 'tr', color: NODO_COLORS.rojo },
  { pos: 'bl', color: NODO_COLORS.ambar },
  { pos: 'br', color: NODO_COLORS.azul },
];

interface Props {
  size?: number;
  animated?: boolean;
  glow?: boolean;
  className?: string;
}

export default function NodoIsotipo({ size = 40, animated = false, glow = false, className = '' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`nodo-iso ${animated ? 'nodo-iso--anim' : ''} ${className}`}
      aria-label="NODO"
      role="img"
    >
      {glow && (
        <defs>
          {NODES.map((n) => (
            <radialGradient key={n.pos} id={`glow-${n.pos}`}>
              <stop offset="0%" stopColor={n.color} stopOpacity="0.9" />
              <stop offset="100%" stopColor={n.color} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
      )}

      {/* Auras de color detrás de los nodos */}
      {glow &&
        NODES.map((n, i) => (
          <circle
            key={`g-${n.pos}`}
            className="nodo-glow"
            cx={N[n.pos][0]}
            cy={N[n.pos][1]}
            r="30"
            fill={`url(#glow-${n.pos})`}
            style={animated ? { animationDelay: `${0.5 + i * 0.12}s` } : undefined}
          />
        ))}

      {/* Aristas */}
      <g className="nodo-edges" stroke={NODO_COLORS.edge} strokeWidth="6" strokeLinecap="round">
        {EDGES.map(([a, b], i) => (
          <line
            key={`e-${i}`}
            className="nodo-edge"
            x1={N[a][0]}
            y1={N[a][1]}
            x2={N[b][0]}
            y2={N[b][1]}
            pathLength={1}
            style={animated ? { animationDelay: `${0.15 + i * 0.1}s` } : undefined}
          />
        ))}
      </g>

      {/* Nodos */}
      {NODES.map((n, i) => (
        <g
          key={`n-${n.pos}`}
          className="nodo-node"
          style={animated ? { animationDelay: `${0.5 + i * 0.12}s` } : undefined}
        >
          <circle cx={N[n.pos][0]} cy={N[n.pos][1]} r="11" fill={n.color} />
          <circle cx={N[n.pos][0]} cy={N[n.pos][1]} r="4.5" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="2" />
        </g>
      ))}
    </svg>
  );
}
