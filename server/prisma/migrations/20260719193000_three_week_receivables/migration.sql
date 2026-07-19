-- Cuentas por cobrar del cierre = semana actual + dos semanas anteriores.
-- Las deudas más antiguas siguen visibles en Facturación, pero ya no forman
-- parte del balance móvil del libro semanal.
WITH cartera_por_semana AS (
  SELECT
    s.id AS semana_id,
    COALESCE(SUM(GREATEST(saldo_ubicacion.saldo, 0)), 0) AS por_cobrar
  FROM "semanas_operativas" s
  LEFT JOIN LATERAL (
    SELECT
      f."ubicacion_id",
      SUM(f."total") AS saldo
    FROM "facturas" f
    JOIN "semanas_operativas" fs ON fs.id = f."semana_id"
    WHERE f."negocio_id" = s."negocio_id"
      AND f."estado" IN ('emitida', 'pagada')
      AND f."emitida_at" <= s."termina_at"
      AND fs."inicia_at" >= s."inicia_at" - INTERVAL '14 days'
      AND fs."termina_at" <= s."termina_at"
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
