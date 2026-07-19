-- Llaves estables de solicitud para compras y batches de producción. Son opcionales para
-- conservar compatibilidad con los registros históricos y obligatorias en las capturas nuevas.
ALTER TABLE "compras" ADD COLUMN "idempotency_key" TEXT;
ALTER TABLE "producciones" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "compras_idempotency_key_key" ON "compras"("idempotency_key");
CREATE UNIQUE INDEX "producciones_idempotency_key_key" ON "producciones"("idempotency_key");
