# NODO · Burrito Parrilla Mexicana

Sistema operativo y contable de **Burrito Parrilla Mexicana** como **PWA**. Integra las dos
operaciones físicas: carne en Carnicería y desechables en Bodega Addison, además de empresas,
restaurantes, rutas, ventas, facturas, inventario y cierre semanal.
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
│       ├── operacion/     compras, producción, ventas y conciliación semanal
│       ├── distribuciones/ preparación, despacho, recepción y reparto opcional
│       ├── cierre/        facturación, balance y libros Excel
│       └── dashboard/     panorama seleccionable por semana
├── client/          PWA (React + Vite + vite-plugin-pwa) → build a server/public
├── reference/       código de NODO conservado para fases posteriores (IA de conteo)
└── package.json     workspaces npm
```

## Modelo

Organización (`negocios`) → empresas de facturación → **ubicaciones** (bodega | sucursal) →
inventario por `(ubicacion_id, product_id)`. Roles: `admin`, `encargado_bodega` y
`encargado_sucursal`. Cantidades `Decimal(12,3)`; costos/factores `Decimal(12,4)`.

**Flujo semanal:** Compras → Producción → Ventas → Preparación → Despacho → Reparto opcional →
Recepción → Inventario final → Cierre. La captura habitual se concentra en compras, producción
y ventas; los demás pasos muestran o validan lo que el sistema deriva. En carne se permiten
saldos provisionales durante la semana para capturar la producción retroactivamente el sábado,
pero el cierre exige inventario físico completo y ningún saldo negativo.

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
- `SEED_ADMIN_PIN` y `SEED_REPARTO_PIN` — obligatorios en una instalación nueva de producción;
  no se usan para sobrescribir cuentas que ya existen.
- `ALLOWED_ORIGINS` — el dominio público (ej. `https://abasto.burritoparrilla.com`).
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — avisos web push
  (`npx web-push generate-vapid-keys`). Si faltan, la app corre sin avisos.
- `NODE_ENV=production` lo fija el Dockerfile · `PORT` lo inyecta el proxy · `ANTHROPIC_API_KEY` opcional.

**HTTPS con dominio es obligatorio** para PWA/push (Coolify lo da con Let's Encrypt). En
iPhone/iPad el push solo funciona con la **PWA instalada** (Compartir → Agregar a inicio).

Al arrancar como usuario sin privilegios, el contenedor aplica `prisma migrate deploy`, crea las
cuentas iniciales si hacen falta y ejecuta el **bootstrap operativo idempotente**. Este último
completa empresas, productos, proveedores y rutas faltantes sin borrar compras, producción,
pedidos, inventario ni facturas capturadas por el admin.

Las importaciones históricas, backfills y reinicios de semana quedan disponibles como comandos
manuales, pero **no se ejecutan durante un deploy**. En particular, un redeploy no vuelve a importar
los Excel ni reinicia la semana 29. (En desarrollo local, el PIN inicial por defecto es `1234`).
Healthcheck: `/api/health`. Datos de prueba (sucursales/usuarios): scripts en `server/scripts/`.

## Integridad y trazabilidad

- Compras de materia prima crean lotes con cajas variables, peso total y costo total.
- Producción consume lotes FIFO y calcula yield, costo por caja y precio semanal `costo + $15`
  únicamente para proteínas.
- Cerrar y reabrir una semana es atómico. Cada cierre congela cantidades y costos para que el
  dashboard y los Excel históricos no cambien con el inventario vivo.
- Cambiar PIN, rol o estado revoca sesiones anteriores. Los pedidos offline llevan versión y una
  captura antigua se rechaza en vez de sobrescribir una corrección posterior.
- Eliminaciones de compras, producción e inventarios dejan una entrada en la bitácora operativa.

## Reglas de oro

- Todo registro lleva `negocio_id`; el inventario se scopea además por `ubicacion_id`.
- La sucursal pide directo; la existencia cambia al despachar/recibir y al conciliar almacenes.
- Cada encargado solo opera sus ubicaciones asignadas (gating en backend, no solo UI).
- Un pedido cerrado y una distribución aprobada no cambian en silencio.
