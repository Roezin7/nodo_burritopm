import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useAuth, rolLabel, type Usuario } from '../auth';
import BurritoLockup from '../brand/BurritoLockup';

export default function Login() {
  const { login } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [sel, setSel] = useState<Usuario | null>(null);
  const [q, setQ] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<Usuario[]>('/auth/usuarios?negocio=1', { auth: false })
      .then(setUsuarios)
      .catch(() => setError('No se pudo cargar la lista de usuarios'));
  }, []);

  async function intentar(pinFinal: string) {
    if (!sel) return;
    setEnviando(true);
    setError('');
    try {
      await login(sel.id, pinFinal);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Error de conexión');
      setPin('');
    } finally {
      setEnviando(false);
    }
  }

  function teclear(d: string) {
    if (enviando) return;
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next.length >= 4) void intentar(next); // autoenvía al llegar a 4 dígitos
  }

  // --- Paso 1: elegir usuario ---
  if (!sel) {
    const t = q.trim().toLowerCase();
    const lista = usuarios.filter((u) => !t || u.nombre.toLowerCase().includes(t) || rolLabel(u.rol).toLowerCase().includes(t));
    return (
      <div className="login">
        <div className="login__lockup">
          <BurritoLockup size={64} variante="full" glow />
        </div>
        <p className="subtitle">¿Quién eres?</p>
        {usuarios.length > 6 && (
          <input
            className="login-search"
            type="search"
            autoFocus
            placeholder="Busca tu nombre o sucursal…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        )}
        <div className="user-list">
          {lista.map((u) => (
            <button key={u.id} className="user-row" onClick={() => setSel(u)}>
              <span className="avatar-sm">{u.nombre[0]}</span>
              <span className="user-row-name">{u.nombre}</span>
              <small className="muted">{rolLabel(u.rol)}</small>
            </button>
          ))}
          {lista.length === 0 && <p className="muted">Sin coincidencias.</p>}
        </div>
        {error && <p className="error-msg">{error}</p>}
      </div>
    );
  }

  // --- Paso 2: PIN ---
  return (
    <div className="login">
      <button className="link-btn" onClick={() => { setSel(null); setPin(''); setError(''); }}>
        ← cambiar usuario
      </button>
      <h1>Hola, {sel.nombre}</h1>
      <p className="subtitle">Ingresa tu PIN</p>
      <div className="pin-dots">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`dot ${i < pin.length ? 'dot--full' : ''}`} />
        ))}
      </div>
      {error && <p className="error-msg">{error}</p>}
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => teclear(d)} disabled={enviando}>
            {d}
          </button>
        ))}
        <button className="pinpad__ghost" onClick={() => setPin('')}>C</button>
        <button onClick={() => teclear('0')} disabled={enviando}>0</button>
        <button className="pinpad__ghost" onClick={() => setPin(pin.slice(0, -1))}>⌫</button>
      </div>
    </div>
  );
}
