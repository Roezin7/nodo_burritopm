CREATE TABLE "recetas_produccion" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "materia_prima_id" BIGINT NOT NULL,
    "producto_salida_id" BIGINT NOT NULL,
    "sin_costo" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "recetas_produccion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recetas_produccion_producto_salida_id_key" ON "recetas_produccion"("producto_salida_id");
CREATE UNIQUE INDEX "recetas_produccion_materia_prima_id_producto_salida_id_key" ON "recetas_produccion"("materia_prima_id", "producto_salida_id");
CREATE INDEX "recetas_produccion_negocio_id_materia_prima_id_idx" ON "recetas_produccion"("negocio_id", "materia_prima_id");

ALTER TABLE "recetas_produccion" ADD CONSTRAINT "recetas_produccion_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recetas_produccion" ADD CONSTRAINT "recetas_produccion_materia_prima_id_fkey" FOREIGN KEY ("materia_prima_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recetas_produccion" ADD CONSTRAINT "recetas_produccion_producto_salida_id_fkey" FOREIGN KEY ("producto_salida_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
