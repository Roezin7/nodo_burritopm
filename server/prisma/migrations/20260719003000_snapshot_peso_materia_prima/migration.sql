ALTER TABLE "inventario_semanal"
ADD COLUMN "peso_total_lb" DECIMAL(14,3),
ADD COLUMN "costo_total" DECIMAL(14,2);

-- Semanas históricas que ya estaban congeladas antes de existir estas columnas.
UPDATE "inventario_semanal" inventario
SET "peso_total_lb" = datos."peso", "costo_total" = datos."costo"
FROM "semanas_operativas" semana, "products" producto,
(VALUES
  (27, 'RAW-INSIDE-SKIRT', 7117.756::DECIMAL, 57511.47::DECIMAL),
  (27, 'RAW-CHICKEN', 1880.000::DECIMAL, 2608.50::DECIMAL),
  (27, 'RAW-PORK-BUTT', 5003.620::DECIMAL, 7455.40::DECIMAL),
  (27, 'RAW-OUTSIDE-SKIRT', 1062.840::DECIMAL, 10862.15::DECIMAL),
  (27, 'RAW-INSIDE-ROUND', 0.000::DECIMAL, 0.00::DECIMAL),
  (27, 'RAW-TAPATIOS-TACO', 887.500::DECIMAL, 4863.50::DECIMAL),
  (28, 'RAW-INSIDE-SKIRT', 1873.000::DECIMAL, 15134.50::DECIMAL),
  (28, 'RAW-CHICKEN', 0.000::DECIMAL, 0.00::DECIMAL),
  (28, 'RAW-PORK-BUTT', 0.000::DECIMAL, 0.00::DECIMAL),
  (28, 'RAW-OUTSIDE-SKIRT', 1691.430::DECIMAL, 16423.78::DECIMAL),
  (28, 'RAW-INSIDE-ROUND', 1451.000::DECIMAL, 6993.82::DECIMAL),
  (28, 'RAW-TAPATIOS-TACO', 531.000::DECIMAL, 2918.07::DECIMAL)
) AS datos("numero", "sku", "peso", "costo")
WHERE inventario."semana_id" = semana."id"
  AND inventario."product_id" = producto."id"
  AND semana."anio" = 2026 AND semana."semana" = datos."numero"
  AND producto."sku" = datos."sku";
