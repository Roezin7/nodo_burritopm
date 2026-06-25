-- Marca del último aviso diario "hoy toca inventario" enviado (idempotencia del scheduler).
ALTER TABLE "negocios" ADD COLUMN "aviso_inventario_at" DATE;
