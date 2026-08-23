-- Protecciones de integridad para conteos y compras.
CREATE UNIQUE INDEX IF NOT EXISTS "conteos_negocio_ubicacion_fecha_key"
  ON "conteos"("negocio_id", "ubicacion_id", "fecha");

ALTER TABLE "compras"
  ADD COLUMN IF NOT EXISTS "ajuste_contable" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "compras" c
SET "ajuste_contable" = ROUND((c."total" - COALESCE((
  SELECT SUM(cl."costo_total") FROM "compra_lineas" cl WHERE cl."compra_id" = c."id"
), 0))::numeric, 2)
WHERE ABS(c."total" - COALESCE((
  SELECT SUM(cl."costo_total") FROM "compra_lineas" cl WHERE cl."compra_id" = c."id"
), 0)) > 0.005;
