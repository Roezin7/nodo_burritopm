-- CreateEnum
CREATE TYPE "TipoUbicacion" AS ENUM ('bodega', 'sucursal');

-- CreateTable
CREATE TABLE "ubicaciones" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "direccion" TEXT,
    "tipo" "TipoUbicacion" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ubicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ubicaciones_negocio_id_idx" ON "ubicaciones"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "ubicaciones_negocio_id_codigo_key" ON "ubicaciones"("negocio_id", "codigo");

-- AddForeignKey
ALTER TABLE "ubicaciones" ADD CONSTRAINT "ubicaciones_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
