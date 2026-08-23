CREATE TABLE IF NOT EXISTS "scheduler_locks" (
  "clave" TEXT NOT NULL,
  "propietario" TEXT NOT NULL,
  "vence_at" TIMESTAMPTZ(6) NOT NULL,
  "actualizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scheduler_locks_pkey" PRIMARY KEY ("clave")
);
