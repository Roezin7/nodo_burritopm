import './lib/bigint.js'; // habilita JSON.stringify de BigInt (debe ir primero)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { env, isProd } from './env.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

const app = express();

// Detrás de un proxy (Coolify/Traefik, Render): confiar en 1 salto para que el
// rate-limit y los logs vean la IP real del cliente (X-Forwarded-For), no la del proxy.
if (isProd) app.set('trust proxy', 1);

// Compresión gzip de toda respuesta (API JSON + estáticos): clave cuando el cliente
// está lejos del servidor, reduce mucho el tiempo de transferencia.
app.use(compression());

// Content-Security-Policy explícita para producción: la PWA usa un script inline
// (bootstrap de tema), Google Fonts y previews de imagen en data:. Sin esto, el
// CSP por defecto de helmet rompería la app servida.
const csp = {
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    workerSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    upgradeInsecureRequests: [],
  },
};
app.use(helmet({ contentSecurityPolicy: isProd ? csp : false }));

// CORS: por defecto solo mismo origen (el despliegue es un solo servicio). Si se
// define ALLOWED_ORIGINS, se habilitan esos orígenes; si no, no se emiten cabeceras
// CORS y el navegador bloquea peticiones cross-origin.
const origenes = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origenes.length ? origenes : false }));

app.use(express.json({ limit: '10mb' })); // 10mb para imágenes del borrador IA (Fase 7)

// --- Rate limiting ---
// Límite general por IP (generoso: una tablet en piso hace muchas peticiones legítimas).
// Omite /auth/login para que ahí mande el límite estricto de abajo.
const limiteGeneral = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.originalUrl.startsWith('/api/auth/login'),
});
// Límite estricto al login (anti fuerza bruta del PIN).
const limiteLogin = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Espera unos minutos e intenta de nuevo.' },
});

// --- API ---
app.use('/api/auth/login', limiteLogin);
app.use('/api', limiteGeneral);
app.use('/api', apiRouter);

// --- PWA estática (single-service) ---
// Los assets de Vite llevan hash en el nombre → se pueden cachear de forma agresiva.
app.use(
  express.static(publicDir, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);
// SPA fallback: cualquier ruta que no sea /api devuelve index.html (sin cache, para
// que un deploy nuevo se vea de inmediato).
app.get(/^(?!\/api).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`🌯 NODO · Burrito Parrilla API + PWA escuchando en http://localhost:${env.PORT}`);
});
