-- La captura semanal conserva el mismo orden de ubicaciones y productos que los Excel.
ALTER TABLE "ubicaciones" ADD COLUMN "orden_operativo" INTEGER NOT NULL DEFAULT 999;
ALTER TABLE "products" ADD COLUMN "orden_operativo" INTEGER NOT NULL DEFAULT 999;

CREATE INDEX "ubicaciones_negocio_id_orden_operativo_idx"
  ON "ubicaciones"("negocio_id", "orden_operativo");
CREATE INDEX "products_negocio_id_orden_operativo_idx"
  ON "products"("negocio_id", "orden_operativo");
