-- Condición de pago configurable por proveedor. Las compras históricas conservan
-- su fecha de vencimiento; el término sólo se usa al crear o editar documentos.
ALTER TABLE "proveedores" ADD COLUMN "dias_credito" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_dias_credito_check" CHECK ("dias_credito" BETWEEN 0 AND 180);
