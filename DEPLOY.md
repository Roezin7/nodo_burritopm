# Despliegue en Coolify (Hetzner)

Un solo servicio: el contenedor sirve la API (`/api`) y la PWA compilada. La build y las
migraciones de Prisma se ejecutan dentro de la imagen (ver `Dockerfile`).

## 1. Base de datos (PostgreSQL en Coolify)

1. En tu proyecto de Coolify: **+ New** → **Database** → **PostgreSQL** (v16).
2. Coolify te da una **Connection String interna** (host = nombre del servicio en la red Docker),
   algo como `postgresql://postgres:PASS@<servicio>:5432/postgres`.
3. Esa cadena será tu `DATABASE_URL`. Para conexión interna **no** necesitas `sslmode=require`.

## 2. App (desde GitHub, con Dockerfile)

1. **+ New** → **Application** → **Public/Private Repository** → elige este repo, rama `main`.
2. **Build Pack: Dockerfile** (Coolify detecta el `Dockerfile` en la raíz).
3. **Port: 3000**. **Health check path: `/api/health`**.
4. Variables de entorno (Settings → Environment Variables):
   - `DATABASE_URL` = la cadena interna del paso 1
   - `JWT_SECRET` = un valor largo y aleatorio (genera con `openssl rand -hex 32`)
   - `NODE_ENV` = `production`
   - `ANTHROPIC_API_KEY` = tu key (para Silvia y el borrador IA; opcional)
   - `ALLOWED_ORIGINS` = vacío (mismo origen). Solo si separas el front.
5. **Deploy.** El contenedor corre `prisma migrate deploy` y luego arranca.
6. Asigna tu **dominio** en Coolify (genera HTTPS con Let's Encrypt automáticamente) y
   **cierra/firewallea el puerto 8000** de Coolify como recomienda la instalación.

## 3. Migrar los datos desde Render → Coolify

Los datos viven hoy en la DB de Render. Para moverlos (una sola vez):

```bash
# 1) Dump desde Render (usa la External Database URL de Render)
pg_dump --no-owner --no-privileges -Fc "postgresql://USER:PASS@HOST.oregon-postgres.render.com/iberico_inventario?sslmode=require" -f iberico.dump

# 2) Restaurar en la DB de Coolify.
#    Si expones temporalmente el puerto de Postgres en Coolify, desde tu Mac:
pg_restore --no-owner --no-privileges -d "postgresql://postgres:PASS@IP_HETZNER:PUERTO/postgres" iberico.dump
#    (o sube el .dump al servidor y haz el restore por la red interna de Docker)
```

> Importante: después de migrar, las migraciones de Prisma ya estarán marcadas como aplicadas
> (la tabla `_prisma_migrations` viaja en el dump), así que `migrate deploy` no repetirá nada.

## 4. Checklist
- [ ] Postgres creado en Coolify, `DATABASE_URL` interna configurada
- [ ] App conectada al repo, Build Pack = Dockerfile, puerto 3000, healthcheck `/api/health`
- [ ] Env vars (`JWT_SECRET`, `NODE_ENV`, `ANTHROPIC_API_KEY`) puestas
- [ ] Datos migrados desde Render
- [ ] Dominio + HTTPS asignados; puerto 8000 de Coolify cerrado
