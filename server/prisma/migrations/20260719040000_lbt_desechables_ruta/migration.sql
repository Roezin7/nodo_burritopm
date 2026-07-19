-- Los pedidos históricos de desechables ya incluyen las ubicaciones LBTP, pero la
-- plantilla vigente de la ruta Sur no las contemplaba. Se agregan al final para no
-- alterar el orden que el administrador haya configurado ni tocar pedidos existentes.
WITH "paradas_faltantes" AS (
  SELECT
    plantilla."id" AS "plantilla_id",
    ubicacion."id" AS "ubicacion_id",
    ROW_NUMBER() OVER (
      PARTITION BY plantilla."id"
      ORDER BY CASE ubicacion."codigo"
        WHEN 'TGE' THEN 1
        WHEN 'TST' THEN 2
        WHEN 'TLO' THEN 3
      END
    ) AS "posicion"
  FROM "plantillas_ruta" plantilla
  JOIN "ubicaciones" ubicacion
    ON ubicacion."negocio_id" = plantilla."negocio_id"
   AND ubicacion."codigo" IN ('TGE', 'TST', 'TLO')
  WHERE plantilla."codigo" = 'DES-SUR-MIE'
    AND plantilla."linea_operacion" = 'desechables'
    AND NOT EXISTS (
      SELECT 1
      FROM "plantilla_ruta_paradas" existente
      WHERE existente."plantilla_id" = plantilla."id"
        AND existente."ubicacion_id" = ubicacion."id"
    )
),
"orden_actual" AS (
  SELECT
    plantilla."id" AS "plantilla_id",
    COALESCE(MAX(parada."orden"), 0) AS "ultimo_orden"
  FROM "plantillas_ruta" plantilla
  LEFT JOIN "plantilla_ruta_paradas" parada
    ON parada."plantilla_id" = plantilla."id"
  WHERE plantilla."codigo" = 'DES-SUR-MIE'
    AND plantilla."linea_operacion" = 'desechables'
  GROUP BY plantilla."id"
)
INSERT INTO "plantilla_ruta_paradas" (
  "plantilla_id",
  "ubicacion_id",
  "orden",
  "opcional"
)
SELECT
  faltante."plantilla_id",
  faltante."ubicacion_id",
  actual."ultimo_orden" + faltante."posicion",
  false
FROM "paradas_faltantes" faltante
JOIN "orden_actual" actual
  ON actual."plantilla_id" = faltante."plantilla_id"
ON CONFLICT ("plantilla_id", "ubicacion_id") DO NOTHING;
