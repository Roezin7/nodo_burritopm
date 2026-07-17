CREATE TABLE "importaciones_sistema" (
    "negocio_id" BIGINT NOT NULL,
    "clave" TEXT NOT NULL,
    "aplicado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "importaciones_sistema_pkey" PRIMARY KEY ("negocio_id", "clave")
);
