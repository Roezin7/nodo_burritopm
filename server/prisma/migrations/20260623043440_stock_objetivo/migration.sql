-- CreateEnum
CREATE TYPE "OrigenCalculo" AS ENUM ('manual', 'historico', 'automatico');

-- CreateTable
CREATE TABLE "producto_ubicacion" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "stock_objetivo" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "stock_min" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "stock_max" DECIMAL(12,3),
    "stock_seguridad" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "frecuencia_abasto" TEXT,
    "consumo_promedio" DECIMAL(12,3),
    "dias_cobertura" INTEGER,
    "multiplo_distribucion" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "minimo_envio" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "origen_calculo" "OrigenCalculo" NOT NULL DEFAULT 'manual',
    "actualizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_por" BIGINT,

    CONSTRAINT "producto_ubicacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "producto_ubicacion_negocio_id_idx" ON "producto_ubicacion"("negocio_id");

-- CreateIndex
CREATE INDEX "producto_ubicacion_product_id_idx" ON "producto_ubicacion"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "producto_ubicacion_ubicacion_id_product_id_key" ON "producto_ubicacion"("ubicacion_id", "product_id");

-- AddForeignKey
ALTER TABLE "producto_ubicacion" ADD CONSTRAINT "producto_ubicacion_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producto_ubicacion" ADD CONSTRAINT "producto_ubicacion_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
