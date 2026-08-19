-- Cola durable de avisos de cambios operativos.
CREATE TABLE "notificacion_eventos" (
  "id" BIGSERIAL NOT NULL,
  "negocio_id" BIGINT NOT NULL,
  "tipo" TEXT NOT NULL,
  "entidad" TEXT NOT NULL,
  "entidad_id" BIGINT,
  "actor_id" BIGINT,
  "dedupe_key" TEXT NOT NULL,
  "titulo" TEXT NOT NULL,
  "cuerpo" TEXT NOT NULL,
  "url" TEXT,
  "datos" JSONB NOT NULL,
  "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notificacion_eventos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notificacion_entregas" (
  "id" BIGSERIAL NOT NULL,
  "evento_id" BIGINT NOT NULL,
  "usuario_id" BIGINT NOT NULL,
  "canal" TEXT NOT NULL DEFAULT 'web_push',
  "estado" TEXT NOT NULL DEFAULT 'pendiente',
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "disponible_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enviado_at" TIMESTAMPTZ(6),
  "ultimo_error" TEXT,
  "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notificacion_entregas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notificacion_eventos_negocio_id_dedupe_key_key"
  ON "notificacion_eventos" ("negocio_id", "dedupe_key");
CREATE INDEX "notificacion_eventos_negocio_id_creado_at_idx"
  ON "notificacion_eventos" ("negocio_id", "creado_at");
CREATE UNIQUE INDEX "notificacion_entregas_evento_id_usuario_id_canal_key"
  ON "notificacion_entregas" ("evento_id", "usuario_id", "canal");
CREATE INDEX "notificacion_entregas_estado_disponible_at_idx"
  ON "notificacion_entregas" ("estado", "disponible_at");
CREATE INDEX "notificacion_entregas_usuario_id_creado_at_idx"
  ON "notificacion_entregas" ("usuario_id", "creado_at");

ALTER TABLE "notificacion_eventos"
  ADD CONSTRAINT "notificacion_eventos_negocio_id_fkey"
  FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notificacion_entregas"
  ADD CONSTRAINT "notificacion_entregas_evento_id_fkey"
  FOREIGN KEY ("evento_id") REFERENCES "notificacion_eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notificacion_entregas"
  ADD CONSTRAINT "notificacion_entregas_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
