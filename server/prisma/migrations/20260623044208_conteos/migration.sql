-- CreateEnum
CREATE TYPE "EstadoConteo" AS ENUM ('borrador', 'en_captura', 'cerrado', 'reabierto');

-- CreateTable
CREATE TABLE "conteos" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "estado" "EstadoConteo" NOT NULL DEFAULT 'en_captura',
    "creado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrado_por" BIGINT,
    "cerrado_at" TIMESTAMPTZ(6),
    "notas" TEXT,

    CONSTRAINT "conteos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conteo_lineas" (
    "conteo_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "unidad_id" BIGINT NOT NULL,
    "factor" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "contado" BOOLEAN NOT NULL DEFAULT false,
    "atipico" BOOLEAN NOT NULL DEFAULT false,
    "comentario" TEXT,

    CONSTRAINT "conteo_lineas_pkey" PRIMARY KEY ("conteo_id","product_id")
);

-- CreateIndex
CREATE INDEX "conteos_negocio_id_ubicacion_id_idx" ON "conteos"("negocio_id", "ubicacion_id");

-- CreateIndex
CREATE INDEX "conteos_ubicacion_id_estado_idx" ON "conteos"("ubicacion_id", "estado");

-- CreateIndex
CREATE INDEX "conteo_lineas_product_id_idx" ON "conteo_lineas"("product_id");

-- AddForeignKey
ALTER TABLE "conteos" ADD CONSTRAINT "conteos_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteo_lineas" ADD CONSTRAINT "conteo_lineas_conteo_id_fkey" FOREIGN KEY ("conteo_id") REFERENCES "conteos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteo_lineas" ADD CONSTRAINT "conteo_lineas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
