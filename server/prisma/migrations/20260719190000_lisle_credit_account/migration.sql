-- Los créditos de producción pertenecen a la cuenta de Lisle y deben ser
-- idempotentes para evitar duplicados por doble clic o reintento de red.
ALTER TABLE "ajustes_facturacion"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ajustes_facturacion_negocio_id_idempotency_key_key"
  ON "ajustes_facturacion"("negocio_id", "idempotency_key");

-- Recalcula la fotografía de cuentas por cobrar de cada cierre. Los saldos se
-- compensan por ubicación antes de llevarlos a cero; de este modo el crédito de
-- Lisle reduce Lisle, pero nunca la deuda de otro restaurante.
WITH cartera_por_semana AS (
  SELECT
    s.id AS semana_id,
    COALESCE(SUM(GREATEST(saldo_ubicacion.saldo, 0)), 0) AS por_cobrar
  FROM "semanas_operativas" s
  LEFT JOIN LATERAL (
    SELECT
      f."ubicacion_id",
      SUM(
        f."total" - COALESCE((
          SELECT SUM(p."monto")
          FROM "pagos_cliente" p
          WHERE p."factura_id" = f.id
            AND p."pagado_at" <= s."termina_at"
        ), 0)
      ) AS saldo
    FROM "facturas" f
    WHERE f."negocio_id" = s."negocio_id"
      AND f."estado" IN ('emitida', 'pagada')
      AND f."emitida_at" <= s."termina_at"
    GROUP BY f."ubicacion_id"
  ) saldo_ubicacion ON TRUE
  WHERE s."estado" = 'cerrada'
  GROUP BY s.id
)
UPDATE "semanas_operativas" s
SET
  "cuentas_por_cobrar" = ROUND(c.por_cobrar, 2),
  "balance_neto" = ROUND(
    s."valor_carne" + s."valor_congelado" + s."valor_desechables"
    + c.por_cobrar - s."cuentas_por_pagar",
    2
  )
FROM cartera_por_semana c
WHERE s.id = c.semana_id;
