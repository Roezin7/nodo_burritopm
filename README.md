# Sistema Ibérico

Back-office multi-negocio (Finanzas, Inventario, Tareas, Patrimonio) como **PWA**.
Primer negocio: **Ibérico** (bar). UI en español · MXN · `America/Mexico_City`.

## Arquitectura

Monorepo con despliegue de **un solo servicio** en Render: el servidor Node sirve
la API REST bajo `/api` y los archivos estáticos de la PWA compilada.

```
/
├── server/          API REST (Express + TypeScript + Prisma + Zod)
│   ├── prisma/       esquema y migraciones
│   └── src/
├── client/          PWA (React + Vite + vite-plugin-pwa)  → build a server/public
├── render.yaml       config de despliegue (single service)
└── package.json      workspaces npm
```

## Puesta en marcha

1. Copia el ejemplo de entorno y llena `DATABASE_URL` (Postgres de Render):
   ```bash
   cp .env.example .env
   # edita .env -> DATABASE_URL y JWT_SECRET
   ```
   > ⚠️ Rota la contraseña de la DB antes de usar credenciales en producción.

2. Instala dependencias:
   ```bash
   npm install
   ```

3. Adopta el esquema existente y aplica migraciones (ver `server/prisma`):
   ```bash
   npm run prisma:introspect   # db pull: trae las tablas existentes
   npm run prisma:generate
   # baseline + migraciones por fase (documentado en server/prisma/MIGRACIONES.md)
   ```

4. Desarrollo (API en :3000, PWA en :5173 con proxy a /api):
   ```bash
   npm run dev
   ```

5. Producción local (build + servir todo desde :3000):
   ```bash
   npm run build && npm start
   ```

## Estado por fase

- [x] Fase 0 — Scaffold (monorepo, single-service, PWA shell, health)
- [x] Fase 1 — Multi-tenant + auth (PIN + JWT, login visual, gating por rol)
- [x] Fase 2 — Inventario v2 (zonas, unidades por zona, conteo, lista de compras, valor)
- [x] Fase 3 — Finanzas (semanas encadenadas, movimientos, comisión 1.99%, cuadre, resumen, capital socio)
- [x] Fase 4 — Patrimonio (snapshot automático al cerrar semana, pasivos, tendencia)
- [x] Fase 5 — Tareas (checklists apertura/cierre, instancias diarias, completado por empleados)
- [x] Fase 6 — PWA offline (cola de escrituras en IndexedDB, sync al reconectar, indicador, iconos)
- [x] **Silvia** — coach de negocio con IA y memoria (burbuja flotante, admin) · requiere `ANTHROPIC_API_KEY`
- [x] Fase 7 — IA opcional para conteos (borrador editable desde foto/texto) · pestaña "Borrador IA" en Inventario · requiere `ANTHROPIC_API_KEY`
- [x] Configuración (admin) — negocio, productos/mínimos, zonas y unidades, saldos, ubicaciones/categorías/socios, **usuarios y PINs**
- [x] Operación — reabrir/editar semanas cerradas · export CSV (finanzas/patrimonio) · `/api/health` verifica la DB · la cola offline avisa cambios rechazados

## Silvia (coach de negocio con IA)

Burbuja flotante (esquina inferior derecha, solo admin) con una coach que observa los
KPIs reales del negocio (ventas/semana, utilidad, margen, comisión, patrimonio, inventario)
y da recomendaciones accionables. Tiene **memoria**: conversación persistente, registro de
**eventos/cambios** del negocio (botón 📌) y **aprendizajes** que ella misma guarda vía
tool-use. Modelo: `claude-opus-4-8` con adaptive thinking.

- Solo se activa si `ANTHROPIC_API_KEY` está configurada en el servidor (si no, la burbuja
  no aparece y `/api/silvia/chat` responde 503).
- La IA **solo escribe en su propia tabla de memoria** (`silvia_memoria`), nunca en datos
  del negocio.

## Reglas de oro

- Todo registro lleva `negocio_id` (multi-negocio desde el día 1).
- `empleado` solo accede a Inventario y Tareas (gating en backend, no solo UI).
- La IA **nunca** escribe en la DB: devuelve borradores que el usuario confirma.
- No se usa la tabla `ingests` (sistema viejo de Telegram, deprecado).
