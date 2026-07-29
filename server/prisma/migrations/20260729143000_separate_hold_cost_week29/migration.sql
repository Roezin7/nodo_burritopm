-- El inventario en advance/hold todavía no está disponible y puede tener un
-- costo distinto. Conservarlo separado evita contaminar el costo FIFO existente.
ALTER TABLE "existencias"
  ADD COLUMN "costo_transito_promedio" DECIMAL(12,4);

ALTER TABLE "inventario_semanal"
  ADD COLUMN "costo_transito_promedio" DECIMAL(12,4);

UPDATE "existencias"
SET "costo_transito_promedio" = "costo_promedio"
WHERE "cantidad_transito" > 0;

UPDATE "inventario_semanal"
SET "costo_transito_promedio" = "costo_promedio"
WHERE "cantidad_transito" > 0;

-- Fuente: Semana 29.xlsx, Week (29), columnas DK:DY.
-- Las cantidades ya conciliaban; únicamente se restauran las dos capas de costo.
WITH costos(sku, costo_disponible, costo_hold, valor_disponible) AS (
  VALUES
    ('BPM-0004', 23.0000::DECIMAL, 28.7500::DECIMAL, 15939.00::DECIMAL),
    ('BPM-0019', 21.9500::DECIMAL, 23.9500::DECIMAL, 38083.25::DECIMAL),
    ('BPM-0020', 33.5000::DECIMAL, 39.9500::DECIMAL,  1943.00::DECIMAL)
)
UPDATE "inventario_semanal" i
SET
  "costo_promedio" = c.costo_disponible,
  "costo_transito_promedio" = c.costo_hold,
  "costo_total" = c.valor_disponible
FROM costos c, "products" p, "ubicaciones" u, "semanas_operativas" s
WHERE i."product_id" = p.id
  AND i."ubicacion_id" = u.id
  AND i."semana_id" = s.id
  AND p.sku = c.sku
  AND u.codigo = 'BOD'
  AND s.anio = 2026
  AND s.semana = 29;

WITH costos(sku, costo_disponible, costo_hold) AS (
  VALUES
    ('BPM-0004', 23.0000::DECIMAL, 28.7500::DECIMAL),
    ('BPM-0019', 21.9500::DECIMAL, 23.9500::DECIMAL),
    ('BPM-0020', 33.5000::DECIMAL, 39.9500::DECIMAL)
)
UPDATE "existencias" e
SET
  "costo_promedio" = c.costo_disponible,
  "costo_transito_promedio" = c.costo_hold
FROM costos c, "products" p, "ubicaciones" u
WHERE e."product_id" = p.id
  AND e."ubicacion_id" = u.id
  AND p.sku = c.sku
  AND u.codigo = 'BOD';

-- Los lotes FIFO representan únicamente lo físicamente disponible.
WITH costos(sku, costo_disponible) AS (
  VALUES
    ('BPM-0004', 23.0000::DECIMAL),
    ('BPM-0019', 21.9500::DECIMAL),
    ('BPM-0020', 33.5000::DECIMAL)
)
UPDATE "lotes_materia_prima" l
SET
  "costo_inicial" = ROUND(l."cajas_iniciales" * c.costo_disponible, 2),
  "costo_disponible" = ROUND(l."cajas_disponibles" * c.costo_disponible, 2)
FROM costos c, "products" p, "ubicaciones" u
WHERE l."product_id" = p.id
  AND l."ubicacion_id" = u.id
  AND p.sku = c.sku
  AND u.codigo = 'BOD';

-- La fotografía histórica queda conciliada al total del libro:
-- 222,597.18 disponible + 32,485.20 hold = 255,082.38.
UPDATE "semanas_operativas" s
SET
  "valor_desechables" = 255082.38,
  "balance_neto" = ROUND(
    s."valor_carne" + s."valor_congelado" + 255082.38
    + s."cuentas_por_cobrar" - s."cuentas_por_pagar",
    2
  )
WHERE s."anio" = 2026
  AND s."semana" = 29
  AND EXISTS (
    SELECT 1
    FROM "inventario_semanal" i
    JOIN "products" p ON p.id = i."product_id"
    JOIN "ubicaciones" u ON u.id = i."ubicacion_id"
    WHERE i."semana_id" = s.id
      AND p.sku = 'BPM-0004'
      AND u.codigo = 'BOD'
  );
