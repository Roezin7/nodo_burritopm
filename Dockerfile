# Sistema Ibérico — imagen de un solo servicio (API + PWA) para Coolify/Hetzner.
# Debian slim (no Alpine) para evitar problemas de Prisma con musl/openssl.
FROM node:22-slim

# openssl/ca-certificates: Prisma en runtime. curl: para el healthcheck de Coolify/Docker.
RUN apt-get update -y && apt-get install -y openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Manifests primero (mejor caché de capas). Instala TODAS las deps (incluye dev:
#    tsc, vite y el CLI de prisma hacen falta para build y migrate).
COPY package*.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

# 2) Código y build: prisma generate + (client -> server/public, server -> server/dist)
COPY . .
RUN npm run prisma:generate -w server && npm run build

# El entorno de ejecución es producción (no afecta a las capas de instalación de arriba).
ENV NODE_ENV=production
EXPOSE 3000

# Healthcheck del contenedor (curl ya disponible). Coincide con el de Coolify.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

# Aplica migraciones pendientes y arranca. migrate deploy es idempotente y seguro.
CMD ["sh", "-c", "npx --workspace server prisma migrate deploy && npm start"]
