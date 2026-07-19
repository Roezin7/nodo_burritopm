-- Permite incluir gastos de la misma factura sin convertirlos en inventario.
ALTER TABLE "products"
ADD COLUMN "es_cargo_compra" BOOLEAN NOT NULL DEFAULT false;
