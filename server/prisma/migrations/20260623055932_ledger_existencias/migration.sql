-- CreateEnum
CREATE TYPE "TipoMovInventario" AS ENUM ('conteo_inicial', 'compra_recibida', 'transferencia', 'devolucion', 'consumo', 'merma', 'dano', 'ajuste_positivo', 'ajuste_negativo', 'cancelacion', 'correccion', 'recepcion_parcial');

-- AlterTable
ALTER TABLE "distribucion_lineas" ADD COLUMN     "cantidad_cargada" DECIMAL(12,3),
ADD COLUMN     "cantidad_preparada" DECIMAL(12,3),
ADD COLUMN     "cantidad_recibida" DECIMAL(12,3),
ADD COLUMN     "cantidad_verificada" DECIMAL(12,3),
ADD COLUMN     "estado_linea" TEXT,
ADD COLUMN     "incidencia_id" BIGINT;

-- AlterTable
ALTER TABLE "distribuciones" ADD COLUMN     "cargado_at" TIMESTAMPTZ(6),
ADD COLUMN     "cargado_por" BIGINT,
ADD COLUMN     "preparado_at" TIMESTAMPTZ(6),
ADD COLUMN     "preparado_por" BIGINT,
ADD COLUMN     "verificado_at" TIMESTAMPTZ(6),
ADD COLUMN     "verificado_por" BIGINT;

-- CreateTable
CREATE TABLE "existencias" (
    "negocio_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "cantidad_disponible" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "cantidad_reservada" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "cantidad_transito" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "costo_promedio" DECIMAL(12,4),
    "actualizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "existencias_pkey" PRIMARY KEY ("ubicacion_id","product_id")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "ubicacion_origen_id" BIGINT,
    "ubicacion_destino_id" BIGINT,
    "tipo" "TipoMovInventario" NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costo_unitario" DECIMAL(12,4),
    "costo_total" DECIMAL(12,2),
    "documento_tipo" TEXT,
    "documento_id" BIGINT,
    "usuario_id" BIGINT NOT NULL,
    "fecha" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comentario" TEXT,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidencias" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "tipo" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL DEFAULT 'media',
    "ubicacion_id" BIGINT,
    "documento_tipo" TEXT,
    "documento_id" BIGINT,
    "distribucion_linea_id" BIGINT,
    "product_id" BIGINT,
    "responsable_id" BIGINT,
    "estado" TEXT NOT NULL DEFAULT 'abierta',
    "comentarios" TEXT,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resuelto_at" TIMESTAMPTZ(6),
    "resuelto_por" BIGINT,

    CONSTRAINT "incidencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "existencias_negocio_id_idx" ON "existencias"("negocio_id");

-- CreateIndex
CREATE INDEX "existencias_product_id_idx" ON "existencias"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_inventario_idempotency_key_key" ON "movimientos_inventario"("idempotency_key");

-- CreateIndex
CREATE INDEX "movimientos_inventario_negocio_id_idx" ON "movimientos_inventario"("negocio_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_product_id_idx" ON "movimientos_inventario"("product_id");

-- CreateIndex
CREATE INDEX "movimientos_inventario_documento_tipo_documento_id_idx" ON "movimientos_inventario"("documento_tipo", "documento_id");

-- CreateIndex
CREATE INDEX "incidencias_negocio_id_estado_idx" ON "incidencias"("negocio_id", "estado");

-- AddForeignKey
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "existencias" ADD CONSTRAINT "existencias_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ubicacion_origen_id_fkey" FOREIGN KEY ("ubicacion_origen_id") REFERENCES "ubicaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_ubicacion_destino_id_fkey" FOREIGN KEY ("ubicacion_destino_id") REFERENCES "ubicaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
