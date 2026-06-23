-- CreateEnum
CREATE TYPE "EstadoDistribucion" AS ENUM ('borrador', 'esperando_conteos', 'calculada', 'en_revision', 'aprobada', 'en_preparacion', 'preparada', 'verificada', 'en_carga', 'cargada', 'en_transito', 'parcialmente_entregada', 'entregada', 'cerrada', 'cerrada_con_incidencias', 'cancelada');

-- CreateTable
CREATE TABLE "distribuciones" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "estado" "EstadoDistribucion" NOT NULL DEFAULT 'calculada',
    "creado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprobado_por" BIGINT,
    "aprobado_at" TIMESTAMPTZ(6),
    "notas" TEXT,

    CONSTRAINT "distribuciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribucion_lineas" (
    "id" BIGSERIAL NOT NULL,
    "distribucion_id" BIGINT NOT NULL,
    "ubicacion_destino_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "conteo_id" BIGINT,
    "inventario_disponible" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "en_transito" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "stock_objetivo" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "stock_seguridad" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "cantidad_sugerida" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "cantidad_aprobada" DECIMAL(12,3),
    "costo_unitario" DECIMAL(12,4),
    "costo_total" DECIMAL(12,2),

    CONSTRAINT "distribucion_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "distribuciones_negocio_id_idx" ON "distribuciones"("negocio_id");

-- CreateIndex
CREATE INDEX "distribucion_lineas_distribucion_id_idx" ON "distribucion_lineas"("distribucion_id");

-- CreateIndex
CREATE INDEX "distribucion_lineas_ubicacion_destino_id_idx" ON "distribucion_lineas"("ubicacion_destino_id");

-- CreateIndex
CREATE INDEX "distribucion_lineas_product_id_idx" ON "distribucion_lineas"("product_id");

-- AddForeignKey
ALTER TABLE "distribucion_lineas" ADD CONSTRAINT "distribucion_lineas_distribucion_id_fkey" FOREIGN KEY ("distribucion_id") REFERENCES "distribuciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribucion_lineas" ADD CONSTRAINT "distribucion_lineas_ubicacion_destino_id_fkey" FOREIGN KEY ("ubicacion_destino_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribucion_lineas" ADD CONSTRAINT "distribucion_lineas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
