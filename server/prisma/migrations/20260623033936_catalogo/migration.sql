-- CreateTable
CREATE TABLE "categorias" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "codigo_barras" TEXT,
    "categoria_id" BIGINT,
    "unidad_distribucion_id" BIGINT NOT NULL,
    "unidad_compra_id" BIGINT,
    "unidad_almacen_id" BIGINT,
    "factor_compra_almacen" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "factor_almacen_distribucion" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "costo_promedio" DECIMAL(12,4),
    "ultimo_costo" DECIMAL(12,4),
    "administrado_bodega" BOOLEAN NOT NULL DEFAULT true,
    "requiere_refrigeracion" BOOLEAN NOT NULL DEFAULT false,
    "stock_min_bodega" DECIMAL(12,3),
    "stock_seguridad_bodega" DECIMAL(12,3),
    "lead_time_dias" INTEGER,
    "imagen_url" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categorias_negocio_id_idx" ON "categorias"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_negocio_id_nombre_key" ON "categorias"("negocio_id", "nombre");

-- CreateIndex
CREATE INDEX "unidades_negocio_id_idx" ON "unidades"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_negocio_id_nombre_key" ON "unidades"("negocio_id", "nombre");

-- CreateIndex
CREATE INDEX "products_negocio_id_idx" ON "products"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_negocio_id_sku_key" ON "products"("negocio_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_negocio_id_nombre_key" ON "products"("negocio_id", "nombre");

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades" ADD CONSTRAINT "unidades_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unidad_distribucion_id_fkey" FOREIGN KEY ("unidad_distribucion_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unidad_compra_id_fkey" FOREIGN KEY ("unidad_compra_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_unidad_almacen_id_fkey" FOREIGN KEY ("unidad_almacen_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;
