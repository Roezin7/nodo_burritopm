# NODO · Burrito Parrilla Mexicana

Sistema de **abastecimiento centralizado** (bodega central + ~15 sucursales) como **PWA**.
Cada sucursal captura un **pedido directo** (cuánto quiere recibir, sin conteo físico ni stock
objetivo); el sistema consolida los pedidos cerrados en un pedido maestro y el admin lo revisa
y aprueba. La **bodega central** sí lleva inventario físico: su conteo cerrado reconcilia
existencias y la carga del camión nunca excede lo disponible.
UI en español · USD · `America/Chicago`.

Proyecto independiente derivado del esqueleto de NODO (repo, base de datos y servicio
propios). Reutiliza infraestructura, auth (PIN+JWT), PWA/offline y diseño; el dominio de
inventario/abastecimiento se construyó desde cero.

## Arquitectura

Monorepo con despliegue de **un solo servicio**: el servidor Node sirve la API REST bajo
`/api` y los archivos estáticos de la PWA compilada.

```
/
├── server/          API REST (Express + TypeScript + Prisma + Zod)
│   ├── prisma/       esquema y migraciones
│   └── src/
│       ├── auth/         PIN + JWT, roles, asignación de ubicación
│       ├── ubicaciones/  bodega + sucursales
│       ├── catalogo/     categorías, unidades, productos por ubicación
│       ├── conteos/      pedido de sucursal / conteo físico de bodega (máquina de estados)
│       ├── distribuciones/  abastecimiento, consolidado, aprobación (+ tests)
│       └── dashboard/    panel del admin
├── client/          PWA (React + Vite + vite-plugin-pwa) → build a server/public
├── reference/       código de NODO conservado para fases posteriores (IA de conteo)
└── package.json     workspaces npm
```

## Modelo

Organización (`negocios`, una fila) → **ubicaciones** (bodega | sucursal) → inventario por
`(negocio_id, ubicacion_id)`. Roles: `admin`, `encargado_bodega`, `encargado_sucursal`,
`repartidor`. Cantidades `Decimal(12,3)`; costos/factores `Decimal(12,4)`.

**Flujo:** el encargado de cada sucursal captura su **pedido** (las cantidades que quiere
recibir) y lo cierra → el admin **crea la distribución** copiando los pedidos cerrados →
revisa el consolidado (por producto / por sucursal, con disponibilidad de bodega y faltante)
→ ajusta y **aprueba** → bodega surte y carga (topado a sus existencias reales), reparto y
recepción en sucursal. El conteo físico de sucursal ya no existe: solo la bodega concilia
existencias con su conteo.

## Puesta en marcha (local)

1. Entorno (usa una base de datos **propia**, separada de cualquier otro proyecto):
   ```bash
   cp server/.env.example .env && cp .env server/.env
   # edita DATABASE_URL y JWT_SECRET
   ```
2. Instala y prepara la base de datos:
   ```bash
   npm install
   npm run prisma:generate
   npx --workspace server prisma migrate deploy
   npm run seed                 # admin "Admin" (PIN 1234)
   # opcional: datos de ejemplo (3 ubicaciones, 5 productos, usuarios Maria/Beto)
   SEED_DEMO=1 npm run seed
   ```
3. Desarrollo (API :3100, PWA :5173 con proxy a /api):
   ```bash
   npm run dev
   ```
4. Producción local (build + servir todo desde :3100):
   ```bash
   npm run build && npm start
   ```

> El puerto por defecto es **3100**. Para usar otro: `PORT=XXXX npm start`.

## Pruebas

```bash
npm test            # vitest: lógica de rutas de entrega (server/src/distribuciones/rutas.logic.test.ts)
```

## Despliegue (Coolify)

Servicio propio + PostgreSQL propio. Build con el `Dockerfile` (single-service, Node 22-slim).

**Variables de entorno (Coolify):**
- `DATABASE_URL` — Postgres de Coolify (red interna: `...@<servicio-db>:5432/...?sslmode=disable`).
- `JWT_SECRET` — valor largo y aleatorio.
- `ALLOWED_ORIGINS` — el dominio público (ej. `https://abasto.burritoparrilla.com`).
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — avisos web push
  (`npx web-push generate-vapid-keys`). Si faltan, la app corre sin avisos.
- `NODE_ENV=production` lo fija el Dockerfile · `PORT` lo inyecta el proxy · `ANTHROPIC_API_KEY` opcional.

**HTTPS con dominio es obligatorio** para PWA/push (Coolify lo da con Let's Encrypt). En
iPhone/iPad el push solo funciona con la **PWA instalada** (Compartir → Agregar a inicio).

Al arrancar, el contenedor aplica `prisma migrate deploy`, crea el admin si hace falta y ejecuta
el **bootstrap operativo idempotente**. Este último completa empresas, productos, proveedores y
rutas faltantes sin sobrescribir cambios hechos por el admin (admin inicial `Admin`, PIN `1234` — cámbialo).
Healthcheck: `/api/health`. Datos de prueba (sucursales/usuarios): scripts en `server/scripts/`.

## Estado por bloque (Fase 1 — MVP)

- [x] Bloque 0 — Bootstrap (proyecto nuevo, auth, PWA, re-marca)
- [x] Bloque 1 — Organización + ubicaciones
- [x] Bloque 2 — Usuarios, roles y asignación de ubicación
- [x] Bloque 3 — Catálogo (categorías, unidades, productos con conversiones)
- [x] Bloque 4 — Stock objetivo por (producto, ubicación)
- [x] Bloque 5 — Conteo físico por ubicación (tablet)
- [x] Bloque 6 — Abastecimiento + consolidado + aprobación
- [x] Bloque 7 — Panel del administrador

### Fase 2 — operación de bodega y entregas

- [x] Bloque 8 — Ledger de movimientos + existencias (conteo cerrado siembra existencias)
- [x] Bloque 9 — Preparación (picking), reserva en bodega y doble verificación
- [x] Bloque 10 — Carga del camión y tránsito
- [x] Bloque 11 — Recepción en sucursal e incidencias por diferencias

Cadena de trazabilidad: pedido de sucursal → distribución → aprobación → **reserva** → preparación →
**verificación (2ª persona)** → carga → **tránsito** → recepción → **incidencia**. Cada paso
físico escribe un movimiento idempotente y actualiza `existencias` (disponible / reservada /
tránsito) con costo promedio ponderado al recibir.

**Siguiente (Fase 3 — compras y costos):** proveedores, sugerencias y órdenes de compra,
recepción en bodega, reportes financieros de inventario.

## Reglas de oro

- Todo registro lleva `negocio_id`; el inventario se scopea además por `ubicacion_id`.
- La sucursal **pide directo**: su pedido cerrado es lo que el admin revisa y aprueba; no
  toca existencias. Solo el conteo de **bodega** reconcilia inventario.
- Cada encargado solo opera sus ubicaciones asignadas (gating en backend, no solo UI).
- Un pedido cerrado y una distribución aprobada no cambian en silencio.
