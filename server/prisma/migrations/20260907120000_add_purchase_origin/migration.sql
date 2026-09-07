-- Identifica las entradas de inventario generadas automáticamente al reconciliar
-- un conteo físico. No son compras reales ni deben entrar a cuentas por pagar.
ALTER TABLE "compras"
  ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX "compras_negocio_id_origen_fecha_idx"
  ON "compras"("negocio_id", "origen", "fecha");
