-- Inventario programado por días de la semana + sesiones por fecha.

-- Días de inventario a nivel organización (0=Dom … 6=Sáb).
ALTER TABLE "negocios" ADD COLUMN "inventario_dias" INTEGER[] NOT NULL DEFAULT '{}';

-- Fecha de la sesión de inventario a la que pertenece cada conteo.
ALTER TABLE "conteos" ADD COLUMN "fecha" DATE;

-- Backfill: a los conteos existentes les asignamos la fecha de su creación (en zona del negocio).
UPDATE "conteos" SET "fecha" = ("creado_at" AT TIME ZONE 'America/Chicago')::date WHERE "fecha" IS NULL;

CREATE INDEX "conteos_ubicacion_id_fecha_idx" ON "conteos" ("ubicacion_id", "fecha");
