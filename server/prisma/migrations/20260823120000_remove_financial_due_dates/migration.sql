-- La operación no usa vencimientos: CxC se limita a la ventana móvil de tres
-- semanas y CxP se liquida manualmente por proveedor. Las columnas se eliminan
-- después de conservar la historia de emisión/recepción y de pagos.
ALTER TABLE "facturas" DROP COLUMN IF EXISTS "vence_at";
ALTER TABLE "compras" DROP COLUMN IF EXISTS "vence_at";
ALTER TABLE "proveedores" DROP COLUMN IF EXISTS "dias_credito";
ALTER TABLE "empresas_clientes" DROP COLUMN IF EXISTS "dias_credito_carne";
ALTER TABLE "empresas_clientes" DROP COLUMN IF EXISTS "dias_credito_desechables";
