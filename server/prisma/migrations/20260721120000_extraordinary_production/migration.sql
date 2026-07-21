CREATE TABLE "producciones_extraordinarias" (
  "id" BIGSERIAL NOT NULL,
  "negocio_id" BIGINT NOT NULL,
  "ubicacion_id" BIGINT NOT NULL,
  "fecha" DATE NOT NULL,
  "registrado_por" BIGINT NOT NULL,
  "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notas" TEXT,
  "idempotency_key" TEXT,
  CONSTRAINT "producciones_extraordinarias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "produccion_extraordinaria_lineas" (
  "produccion_id" BIGINT NOT NULL,
  "product_id" BIGINT NOT NULL,
  "cajas" DECIMAL(12,3) NOT NULL,
  CONSTRAINT "produccion_extraordinaria_lineas_pkey" PRIMARY KEY ("produccion_id", "product_id")
);

CREATE UNIQUE INDEX "producciones_extraordinarias_idempotency_key_key"
  ON "producciones_extraordinarias"("idempotency_key");
CREATE INDEX "producciones_extraordinarias_negocio_id_fecha_idx"
  ON "producciones_extraordinarias"("negocio_id", "fecha");
CREATE INDEX "producciones_extraordinarias_ubicacion_id_fecha_idx"
  ON "producciones_extraordinarias"("ubicacion_id", "fecha");
CREATE INDEX "produccion_extraordinaria_lineas_product_id_idx"
  ON "produccion_extraordinaria_lineas"("product_id");

ALTER TABLE "producciones_extraordinarias"
  ADD CONSTRAINT "producciones_extraordinarias_negocio_id_fkey"
  FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "producciones_extraordinarias"
  ADD CONSTRAINT "producciones_extraordinarias_ubicacion_id_fkey"
  FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "produccion_extraordinaria_lineas"
  ADD CONSTRAINT "produccion_extraordinaria_lineas_produccion_id_fkey"
  FOREIGN KEY ("produccion_id") REFERENCES "producciones_extraordinarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "produccion_extraordinaria_lineas"
  ADD CONSTRAINT "produccion_extraordinaria_lineas_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
