ALTER TABLE "movimientos_inventario"
  ADD COLUMN "distribucion_linea_id" BIGINT;

CREATE INDEX "movimientos_inventario_distribucion_linea_id_idx"
  ON "movimientos_inventario"("distribucion_linea_id");

ALTER TABLE "movimientos_inventario"
  ADD CONSTRAINT "movimientos_inventario_distribucion_linea_id_fkey"
  FOREIGN KEY ("distribucion_linea_id") REFERENCES "distribucion_lineas"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
