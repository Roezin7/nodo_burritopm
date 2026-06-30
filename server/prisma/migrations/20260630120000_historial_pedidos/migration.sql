-- Fase 3: pedidos históricos (migrados de los PDFs). Señal de demanda para el stock objetivo.
CREATE TABLE "historial_pedidos" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "origen" TEXT DEFAULT 'import',
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "historial_pedidos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "historial_pedidos_negocio_id_idx" ON "historial_pedidos"("negocio_id");
CREATE INDEX "historial_pedidos_ubicacion_id_product_id_fecha_idx" ON "historial_pedidos"("ubicacion_id", "product_id", "fecha");

ALTER TABLE "historial_pedidos" ADD CONSTRAINT "historial_pedidos_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "historial_pedidos" ADD CONSTRAINT "historial_pedidos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
