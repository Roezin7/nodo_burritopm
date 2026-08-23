-- Reparación idempotente para instalaciones donde la migración de eliminación
-- de vencimientos quedó marcada como aplicada, pero las columnas sobrevivieron.
-- La operación usa ciclo móvil de tres semanas y pagos por proveedor; no usa
-- vencimientos financieros.
ALTER TABLE "facturas" DROP COLUMN IF EXISTS "vence_at";
ALTER TABLE "compras" DROP COLUMN IF EXISTS "vence_at";
