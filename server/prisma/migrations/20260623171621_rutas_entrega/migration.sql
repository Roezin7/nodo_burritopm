-- CreateEnum
CREATE TYPE "EstadoRuta" AS ENUM ('planificada', 'en_curso', 'completada', 'cerrada', 'cancelada');

-- CreateEnum
CREATE TYPE "EstadoParada" AS ENUM ('pendiente', 'en_camino', 'entregada', 'confirmada', 'con_incidencia', 'omitida');

-- CreateTable
CREATE TABLE "rutas" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "distribucion_id" BIGINT NOT NULL,
    "nombre" TEXT,
    "estado" "EstadoRuta" NOT NULL DEFAULT 'planificada',
    "repartidor_id" BIGINT,
    "creado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "despachada_at" TIMESTAMPTZ(6),
    "completada_at" TIMESTAMPTZ(6),
    "notas" TEXT,

    CONSTRAINT "rutas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ruta_paradas" (
    "id" BIGSERIAL NOT NULL,
    "ruta_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "orden" INTEGER NOT NULL,
    "estado" "EstadoParada" NOT NULL DEFAULT 'pendiente',
    "entregada_por" BIGINT,
    "entregada_at" TIMESTAMPTZ(6),
    "confirmada_at" TIMESTAMPTZ(6),
    "notas" TEXT,

    CONSTRAINT "ruta_paradas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rutas_negocio_id_idx" ON "rutas"("negocio_id");

-- CreateIndex
CREATE INDEX "rutas_distribucion_id_idx" ON "rutas"("distribucion_id");

-- CreateIndex
CREATE INDEX "rutas_repartidor_id_idx" ON "rutas"("repartidor_id");

-- CreateIndex
CREATE INDEX "ruta_paradas_ruta_id_idx" ON "ruta_paradas"("ruta_id");

-- CreateIndex
CREATE UNIQUE INDEX "ruta_paradas_ruta_id_ubicacion_id_key" ON "ruta_paradas"("ruta_id", "ubicacion_id");

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_distribucion_id_fkey" FOREIGN KEY ("distribucion_id") REFERENCES "distribuciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_paradas" ADD CONSTRAINT "ruta_paradas_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruta_paradas" ADD CONSTRAINT "ruta_paradas_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
