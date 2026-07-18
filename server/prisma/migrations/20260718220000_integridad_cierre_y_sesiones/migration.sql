-- Sesiones revocables cuando cambia el PIN, rol o estado del usuario.
ALTER TABLE "usuarios" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 1;

-- Fotografía contable utilizada por cierres y exportaciones históricas.
CREATE TABLE "inventario_semanal" (
    "semana_id" BIGINT NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "cantidad_disponible" DECIMAL(12,3) NOT NULL,
    "cantidad_reservada" DECIMAL(12,3) NOT NULL,
    "cantidad_transito" DECIMAL(12,3) NOT NULL,
    "costo_promedio" DECIMAL(12,4),
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inventario_semanal_pkey" PRIMARY KEY ("semana_id", "ubicacion_id", "product_id")
);

CREATE INDEX "inventario_semanal_negocio_id_semana_id_idx" ON "inventario_semanal"("negocio_id", "semana_id");
CREATE INDEX "inventario_semanal_product_id_idx" ON "inventario_semanal"("product_id");

ALTER TABLE "inventario_semanal" ADD CONSTRAINT "inventario_semanal_semana_id_fkey"
  FOREIGN KEY ("semana_id") REFERENCES "semanas_operativas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventario_semanal" ADD CONSTRAINT "inventario_semanal_negocio_id_fkey"
  FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventario_semanal" ADD CONSTRAINT "inventario_semanal_ubicacion_id_fkey"
  FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventario_semanal" ADD CONSTRAINT "inventario_semanal_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bitácora append-only para que eliminar una captura no elimine su rastro de auditoría.
CREATE TABLE "auditoria_operativa" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "usuario_id" BIGINT NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" BIGINT,
    "datos" JSONB NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auditoria_operativa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auditoria_operativa_negocio_id_creado_at_idx" ON "auditoria_operativa"("negocio_id", "creado_at");
CREATE INDEX "auditoria_operativa_entidad_entidad_id_idx" ON "auditoria_operativa"("entidad", "entidad_id");
ALTER TABLE "auditoria_operativa" ADD CONSTRAINT "auditoria_operativa_negocio_id_fkey"
  FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
