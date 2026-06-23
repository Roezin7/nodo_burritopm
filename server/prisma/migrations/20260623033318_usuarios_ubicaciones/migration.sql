-- CreateTable
CREATE TABLE "usuario_ubicaciones" (
    "usuario_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,

    CONSTRAINT "usuario_ubicaciones_pkey" PRIMARY KEY ("usuario_id","ubicacion_id")
);

-- CreateIndex
CREATE INDEX "usuario_ubicaciones_ubicacion_id_idx" ON "usuario_ubicaciones"("ubicacion_id");

-- AddForeignKey
ALTER TABLE "usuario_ubicaciones" ADD CONSTRAINT "usuario_ubicaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_ubicaciones" ADD CONSTRAINT "usuario_ubicaciones_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
