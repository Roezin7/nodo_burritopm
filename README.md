# NODO · Burrito Parrilla Mexicana

Sistema de **abastecimiento centralizado** (bodega central + ~15 sucursales) como **PWA**.
La sucursal **no pide a ojo**: captura su inventario físico y el sistema calcula cuánto
enviarle para volver a su stock objetivo, consolida un pedido maestro y el admin lo aprueba.
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
│       ├── catalogo/     categorías, unidades, productos, stock objetivo
│       ├── conteos/      conteo físico por ubicación (máquina de estados)
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

**Flujo (Fase 1, MVP):** el encargado de cada sucursal captura su conteo físico → al cerrarlo
es la fotografía oficial del inventario → el admin **calcula la distribución** (sugerido =
objetivo + seguridad − disponible − en tránsito, redondeado al múltiplo de empaque, nunca
negativo) → revisa el consolidado (por producto / por sucursal, con disponibilidad de bodega
y faltante) → ajusta y **aprueba**. Picking, carga, entrega y recepción son Fase 2 (la máquina
de estados ya está diseñada).

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
3. Desarrollo (API :3000, PWA :5173 con proxy a /api):
   ```bash
   npm run dev
   ```
4. Producción local (build + servir todo desde :3000):
   ```bash
   npm run build && npm start
   ```

> Si corres **otro NODO** (p. ej. Ibérico) en el :3000, levanta este en otro puerto:
> `PORT=3100 npm start`.

## Pruebas

```bash
npm test            # vitest: fórmula de abastecimiento (server/src/distribuciones/logic.test.ts)
```

## Despliegue (Coolify)

Servicio propio + PostgreSQL propio. Build con el `Dockerfile` (single-service, Node 22-slim).
Variables: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `ALLOWED_ORIGINS` (dominio),
opcional `ANTHROPIC_API_KEY`. Healthcheck: `/api/health`. El contenedor aplica
`prisma migrate deploy` al arrancar.

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

Cadena de trazabilidad: conteo → cálculo → aprobación → **reserva** → preparación →
**verificación (2ª persona)** → carga → **tránsito** → recepción → **incidencia**. Cada paso
físico escribe un movimiento idempotente y actualiza `existencias` (disponible / reservada /
tránsito) con costo promedio ponderado al recibir.

**Siguiente (Fase 3 — compras y costos):** proveedores, sugerencias y órdenes de compra,
recepción en bodega, reportes financieros de inventario.

## Reglas de oro

- Todo registro lleva `negocio_id`; el inventario se scopea además por `ubicacion_id`.
- La sucursal **no decide** cuánto pedir: la cantidad surge del conteo + parámetros.
- Cada encargado solo opera sus ubicaciones asignadas (gating en backend, no solo UI).
- Un conteo cerrado y una distribución aprobada no cambian en silencio.
