-- Distingue la fotografía de apertura, el cierre físico y los conteos diarios.
ALTER TABLE "conteos"
  ADD COLUMN IF NOT EXISTS "tipo_captura" TEXT NOT NULL DEFAULT 'diario';

UPDATE "conteos"
SET "tipo_captura" = 'apertura'
WHERE "notas" LIKE 'inventario_inicial_operativo%';

UPDATE "conteos"
SET "tipo_captura" = 'cierre'
WHERE "notas" LIKE 'inventario_final_operativo%';

CREATE INDEX IF NOT EXISTS "conteos_negocio_ubicacion_tipo_fecha_idx"
  ON "conteos"("negocio_id", "ubicacion_id", "tipo_captura", "fecha");
