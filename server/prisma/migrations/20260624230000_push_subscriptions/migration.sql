-- Suscripciones de Web Push por dispositivo.
CREATE TABLE "push_subscriptions" (
  "id"         BIGSERIAL NOT NULL,
  "negocio_id" BIGINT NOT NULL,
  "usuario_id" BIGINT NOT NULL,
  "endpoint"   TEXT NOT NULL,
  "p256dh"     TEXT NOT NULL,
  "auth"       TEXT NOT NULL,
  "creado_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" ("endpoint");
CREATE INDEX "push_subscriptions_usuario_id_idx" ON "push_subscriptions" ("usuario_id");
