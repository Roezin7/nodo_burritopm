-- El faltante pertenece a la semana en que se detectó. La fotografía conserva
-- esa evidencia aunque el saldo vivo de la siguiente semana comience en cero.
ALTER TABLE "inventario_semanal"
ADD COLUMN "cantidad_faltante" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- Las versiones anteriores guardaron el monto en la incidencia, pero valuaron
-- la fotografía en cero. Recuperamos ese dato histórico sin cerrar incidencias.
WITH "faltantes_historicos" AS (
  SELECT DISTINCT ON (i."documento_id", i."ubicacion_id", i."product_id")
    i."documento_id" AS "semana_id",
    i."ubicacion_id",
    i."product_id",
    CAST(substring(i."comentarios" FROM '^([0-9]+([.][0-9]+)?)') AS DECIMAL(12,3)) AS "cantidad"
  FROM "incidencias" i
  WHERE i."tipo" = 'cajas_perdidas_inventario'
    AND i."documento_tipo" = 'cierre'
    AND i."documento_id" IS NOT NULL
    AND i."ubicacion_id" IS NOT NULL
    AND i."product_id" IS NOT NULL
    AND i."comentarios" ~ '^[0-9]+([.][0-9]+)? cajas faltantes'
  ORDER BY i."documento_id", i."ubicacion_id", i."product_id", i."creado_at" DESC
)
UPDATE "inventario_semanal" inv
SET "cantidad_faltante" = f."cantidad"
FROM "faltantes_historicos" f
WHERE inv."semana_id" = f."semana_id"
  AND inv."ubicacion_id" = f."ubicacion_id"
  AND inv."product_id" = f."product_id";

-- Reparación idempotente para el despliegue en curso (semana 30): toma solo el
-- cierre más reciente de cada negocio. Sumar exactamente el faltante documentado
-- elimina el arrastre de la 29 sin borrar compras, producción o salidas de la 30.
WITH "ultimo_cierre" AS (
  SELECT DISTINCT ON (s."negocio_id")
    s."id", s."negocio_id", s."semana", s."termina_at", s."cerrado_por"
  FROM "semanas_operativas" s
  WHERE s."estado" = 'cerrada' AND s."cerrado_por" IS NOT NULL
  ORDER BY s."negocio_id", s."termina_at" DESC, s."id" DESC
),
"por_reparar" AS (
  SELECT
    inv."negocio_id", inv."semana_id", inv."ubicacion_id", inv."product_id",
    inv."cantidad_faltante" AS "cantidad", uc."semana", uc."termina_at", uc."cerrado_por"
  FROM "inventario_semanal" inv
  JOIN "ultimo_cierre" uc ON uc."id" = inv."semana_id"
  WHERE inv."cantidad_faltante" > 0
    AND NOT EXISTS (
      SELECT 1
      FROM "movimientos_inventario" m
      WHERE m."idempotency_key" = 'cierre-arrastre:' || inv."semana_id" || ':' || inv."ubicacion_id" || ':' || inv."product_id"
    )
),
"insertados" AS (
  INSERT INTO "movimientos_inventario" (
    "negocio_id", "product_id", "ubicacion_destino_id", "tipo", "cantidad",
    "documento_tipo", "documento_id", "usuario_id", "fecha", "comentario", "idempotency_key"
  )
  SELECT
    r."negocio_id", r."product_id", r."ubicacion_id", 'ajuste_positivo'::"TipoMovInventario", r."cantidad",
    'cierre_arrastre', r."semana_id", r."cerrado_por", (r."termina_at" + INTERVAL '1 day'),
    'Inicio sin faltantes heredados después del cierre de semana ' || r."semana",
    'cierre-arrastre:' || r."semana_id" || ':' || r."ubicacion_id" || ':' || r."product_id"
  FROM "por_reparar" r
  RETURNING "ubicacion_destino_id", "product_id", "cantidad"
)
UPDATE "existencias" e
SET "cantidad_disponible" = e."cantidad_disponible" + i."cantidad",
    "actualizado_at" = NOW()
FROM "insertados" i
WHERE e."ubicacion_id" = i."ubicacion_destino_id"
  AND e."product_id" = i."product_id";
