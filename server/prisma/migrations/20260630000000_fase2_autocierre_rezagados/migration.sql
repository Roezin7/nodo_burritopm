-- Fase 2: auto-cierre del tránsito sin confirmar y aviso al admin de sucursales rezagadas.
ALTER TABLE "negocios" ADD COLUMN "auto_cierre_horas" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "negocios" ADD COLUMN "aviso_rezagados_at" DATE;
