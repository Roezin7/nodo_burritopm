CREATE TABLE "pagos_compra" (
    "id" BIGSERIAL NOT NULL,
    "compra_id" BIGINT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "pagado_at" DATE NOT NULL,
    "registrado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pagos_compra_pkey" PRIMARY KEY ("id")
);

INSERT INTO "pagos_compra" ("compra_id", "monto", "pagado_at", "registrado_por")
SELECT "id", "total", "pagado_at"::date, "registrado_por"
FROM "compras"
WHERE "estado" = 'pagada' AND "pagado_at" IS NOT NULL;

CREATE INDEX "pagos_compra_compra_id_pagado_at_idx" ON "pagos_compra"("compra_id", "pagado_at");

ALTER TABLE "pagos_compra"
ADD CONSTRAINT "pagos_compra_compra_id_fkey"
FOREIGN KEY ("compra_id") REFERENCES "compras"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
