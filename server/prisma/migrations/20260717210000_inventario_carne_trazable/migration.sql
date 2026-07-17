-- Los ajustes físicos de materia prima deben poder revertirse junto con el conteo.
CREATE TABLE "conteo_ajustes_lote" (
    "conteo_id" BIGINT NOT NULL,
    "lote_id" BIGINT NOT NULL,
    "cajas" DECIMAL(12,3) NOT NULL,
    "peso_lb" DECIMAL(12,3) NOT NULL,
    "costo" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "conteo_ajustes_lote_pkey" PRIMARY KEY ("conteo_id", "lote_id")
);

CREATE INDEX "conteo_ajustes_lote_lote_id_idx" ON "conteo_ajustes_lote"("lote_id");

ALTER TABLE "conteo_ajustes_lote"
ADD CONSTRAINT "conteo_ajustes_lote_conteo_id_fkey"
FOREIGN KEY ("conteo_id") REFERENCES "conteos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conteo_ajustes_lote"
ADD CONSTRAINT "conteo_ajustes_lote_lote_id_fkey"
FOREIGN KEY ("lote_id") REFERENCES "lotes_materia_prima"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
