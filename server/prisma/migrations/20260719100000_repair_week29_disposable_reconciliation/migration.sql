-- Reconciliación exacta de Desechables, semana 29:
--   Excel: 359 unidades / $11,450.11
--
-- La migración 050000 no insertó 18 cajas de FRIED ICE CREAM porque los pedidos
-- ya estaban entregados. La 060000 agregó después dos renglones que ya existían
-- dentro de las órdenes de carne de Tapatíos (5 cajas / $185.04). Esta reparación:
--   1. revierte físicamente esos dos duplicados, incluido su consumo FIFO;
--   2. conserva el movimiento original y registra su contrapartida para auditoría;
--   3. agrega las 18 cajas faltantes a los pedidos originales, sin duplicarlas.
--
-- Las líneas nuevas quedan sin vínculo de despacho. El cierre automático las toma
-- en un complemento al desplegarse junto con la lógica actualizada del servidor.

BEGIN;

CREATE TEMP TABLE "_w29_duplicate_disposable_lines" ON COMMIT DROP AS
SELECT
  linea_distribucion."id" AS "distribucion_linea_id",
  linea_distribucion."distribucion_id",
  linea_pedido."id" AS "pedido_linea_id",
  pedido."id" AS "pedido_id",
  pedido."negocio_id",
  linea_pedido."product_id",
  ubicacion."id" AS "ubicacion_destino_id",
  movimiento."ubicacion_origen_id" AS "ubicacion_bodega_id",
  linea_distribucion."cantidad_recibida" AS "cantidad",
  linea_distribucion."costo_unitario",
  movimiento."id" AS "movimiento_carga_id"
FROM "pedido_operativo_lineas" linea_pedido
JOIN "pedidos_operativos" pedido
  ON pedido."id" = linea_pedido."pedido_id"
JOIN "ubicaciones" ubicacion
  ON ubicacion."id" = pedido."ubicacion_id"
JOIN "products" producto
  ON producto."id" = linea_pedido."product_id"
JOIN "distribucion_lineas" linea_distribucion
  ON linea_distribucion."pedido_linea_id" = linea_pedido."id"
JOIN "distribuciones" distribucion
  ON distribucion."id" = linea_distribucion."distribucion_id"
JOIN "movimientos_inventario" movimiento
  ON movimiento."idempotency_key" = 'carga:' || linea_distribucion."id"::text
WHERE pedido."linea_operacion" = 'desechables'
  AND pedido."fecha_entrega" = DATE '2026-07-15'
  AND distribucion."linea_operacion" = 'desechables'
  AND distribucion."fecha_entrega" = DATE '2026-07-15'
  AND distribucion."nombre" LIKE '%Complemento%'
  AND linea_distribucion."cantidad_recibida" = linea_pedido."cantidad"
  AND (
    (ubicacion."codigo" = 'TGE' AND producto."sku" = 'BPM-0020' AND linea_pedido."cantidad" = 2)
    OR
    (ubicacion."codigo" = 'TST' AND producto."sku" = 'BPM-0047' AND linea_pedido."cantidad" = 3)
  )
  -- Solo se revierte cuando la misma venta ya está en una orden de carne de la
  -- semana. Así una captura legítima posterior nunca se confunde con el duplicado.
  AND EXISTS (
    SELECT 1
    FROM "pedido_operativo_lineas" linea_original
    JOIN "pedidos_operativos" pedido_original
      ON pedido_original."id" = linea_original."pedido_id"
    WHERE pedido_original."negocio_id" = pedido."negocio_id"
      AND pedido_original."ubicacion_id" = pedido."ubicacion_id"
      AND pedido_original."linea_operacion" = 'carne'
      AND pedido_original."fecha_entrega" BETWEEN DATE '2026-07-13' AND DATE '2026-07-18'
      AND pedido_original."estado" NOT IN ('borrador', 'cancelado')
      AND linea_original."product_id" = linea_pedido."product_id"
      AND linea_original."cantidad" = linea_pedido."cantidad"
  );

DO $$
DECLARE
  encontrados integer;
  insuficientes integer;
BEGIN
  SELECT COUNT(*) INTO encontrados FROM "_w29_duplicate_disposable_lines";
  IF encontrados NOT IN (0, 2) THEN
    RAISE EXCEPTION 'Reconciliación W29 detenida: se esperaban 0 o 2 duplicados y se encontraron %', encontrados;
  END IF;

  SELECT COUNT(*) INTO insuficientes
  FROM "_w29_duplicate_disposable_lines" objetivo
  LEFT JOIN "existencias" existencia
    ON existencia."ubicacion_id" = objetivo."ubicacion_destino_id"
   AND existencia."product_id" = objetivo."product_id"
  WHERE COALESCE(existencia."cantidad_disponible", 0) < objetivo."cantidad";

  IF insuficientes > 0 THEN
    RAISE EXCEPTION 'Reconciliación W29 detenida: el inventario de destino ya consumió uno de los duplicados';
  END IF;
END $$;

-- Contrapartida auditable de la salida duplicada.
INSERT INTO "movimientos_inventario" (
  "negocio_id", "product_id", "ubicacion_origen_id", "ubicacion_destino_id",
  "tipo", "cantidad", "costo_unitario", "costo_total", "documento_tipo",
  "documento_id", "usuario_id", "comentario", "idempotency_key"
)
SELECT
  objetivo."negocio_id",
  objetivo."product_id",
  objetivo."ubicacion_destino_id",
  objetivo."ubicacion_bodega_id",
  'cancelacion',
  objetivo."cantidad",
  objetivo."costo_unitario",
  ROUND(objetivo."cantidad" * COALESCE(objetivo."costo_unitario", 0), 2),
  'reconciliacion_semana_29',
  objetivo."distribucion_linea_id",
  administrador."id",
  'Reversa de renglón duplicado de desechables importado en semana 29',
  'repair:w29:duplicate-disposable:' || objetivo."distribucion_linea_id"::text
FROM "_w29_duplicate_disposable_lines" objetivo
JOIN LATERAL (
  SELECT usuario."id"
  FROM "usuarios" usuario
  WHERE usuario."negocio_id" = objetivo."negocio_id"
    AND usuario."rol" = 'admin'
    AND usuario."activo" = true
  ORDER BY usuario."id"
  LIMIT 1
) administrador ON true
ON CONFLICT ("idempotency_key") DO NOTHING;

-- Devuelve a la bodega lo que el complemento había entregado a TGE/TST.
UPDATE "existencias" existencia
SET "cantidad_disponible" = existencia."cantidad_disponible" - objetivo."cantidad",
    "actualizado_at" = CURRENT_TIMESTAMP
FROM "_w29_duplicate_disposable_lines" objetivo
WHERE existencia."ubicacion_id" = objetivo."ubicacion_destino_id"
  AND existencia."product_id" = objetivo."product_id";

UPDATE "existencias" existencia
SET "cantidad_disponible" = existencia."cantidad_disponible" + agrupado."cantidad",
    "actualizado_at" = CURRENT_TIMESTAMP
FROM (
  SELECT "ubicacion_bodega_id", "product_id", SUM("cantidad") AS "cantidad"
  FROM "_w29_duplicate_disposable_lines"
  GROUP BY "ubicacion_bodega_id", "product_id"
) agrupado
WHERE existencia."ubicacion_id" = agrupado."ubicacion_bodega_id"
  AND existencia."product_id" = agrupado."product_id";

-- Restaura las capas FIFO consumidas por las dos salidas.
UPDATE "lotes_materia_prima" lote
SET "cajas_disponibles" = lote."cajas_disponibles" + consumo."cajas",
    "peso_disponible_lb" = lote."peso_disponible_lb" + consumo."peso_lb",
    "costo_disponible" = lote."costo_disponible" + consumo."costo"
FROM (
  SELECT asignacion."lote_id",
         SUM(asignacion."cajas") AS "cajas",
         SUM(asignacion."peso_lb") AS "peso_lb",
         SUM(asignacion."costo") AS "costo"
  FROM "consumos_lote_inventario" asignacion
  JOIN "_w29_duplicate_disposable_lines" objetivo
    ON objetivo."movimiento_carga_id" = asignacion."movimiento_id"
  GROUP BY asignacion."lote_id"
) consumo
WHERE lote."id" = consumo."lote_id";

DELETE FROM "consumos_lote_inventario" asignacion
USING "_w29_duplicate_disposable_lines" objetivo
WHERE asignacion."movimiento_id" = objetivo."movimiento_carga_id";

-- El costo promedio vuelve a derivarse exclusivamente de los lotes disponibles.
UPDATE "existencias" existencia
SET "costo_promedio" = CASE
      WHEN lotes."cajas" > 0 THEN ROUND(lotes."costo" / lotes."cajas", 4)
      ELSE NULL
    END,
    "actualizado_at" = CURRENT_TIMESTAMP
FROM (
  SELECT lote."ubicacion_id", lote."product_id",
         SUM(lote."cajas_disponibles") AS "cajas",
         SUM(lote."costo_disponible") AS "costo"
  FROM "lotes_materia_prima" lote
  WHERE (lote."ubicacion_id", lote."product_id") IN (
    SELECT "ubicacion_bodega_id", "product_id"
    FROM "_w29_duplicate_disposable_lines"
  )
  GROUP BY lote."ubicacion_id", lote."product_id"
) lotes
WHERE existencia."ubicacion_id" = lotes."ubicacion_id"
  AND existencia."product_id" = lotes."product_id";

DELETE FROM "distribucion_lineas" linea
USING "_w29_duplicate_disposable_lines" objetivo
WHERE linea."id" = objetivo."distribucion_linea_id";

DELETE FROM "pedido_operativo_lineas" linea
USING "_w29_duplicate_disposable_lines" objetivo
WHERE linea."id" = objetivo."pedido_linea_id";

DELETE FROM "pedidos_operativos" pedido
USING "_w29_duplicate_disposable_lines" objetivo
WHERE pedido."id" = objetivo."pedido_id"
  AND NOT EXISTS (
    SELECT 1 FROM "pedido_operativo_lineas" restante
    WHERE restante."pedido_id" = pedido."id"
  );

-- Añade las 18 cajas omitidas a los pedidos originales aunque ya estén entregados.
WITH "ventas_faltantes" ("codigo", "cantidad") AS (
  VALUES
    ('LOMBA', 2), ('NAPER', 3), ('CAROL', 3), ('LISLE', 1),
    ('WESTC', 2), ('BATAV', 2), ('ALGON', 2), ('NAPER2', 1), ('SCHAU', 2)
)
INSERT INTO "pedido_operativo_lineas" (
  "pedido_id", "product_id", "cantidad", "precio_unitario"
)
SELECT
  pedido."id",
  producto."id",
  venta."cantidad",
  producto."precio_venta_fijo"
FROM "ventas_faltantes" venta
JOIN "ubicaciones" ubicacion
  ON ubicacion."codigo" = venta."codigo"
JOIN "pedidos_operativos" pedido
  ON pedido."ubicacion_id" = ubicacion."id"
 AND pedido."linea_operacion" = 'desechables'
 AND pedido."fecha_entrega" = DATE '2026-07-15'
 AND pedido."estado" NOT IN ('borrador', 'cancelado')
JOIN "products" producto
  ON producto."negocio_id" = pedido."negocio_id"
 AND producto."sku" = 'BPM-0050'
WHERE EXISTS (SELECT 1 FROM "_w29_duplicate_disposable_lines")
ON CONFLICT ("pedido_id", "product_id") DO NOTHING;

DO $$
DECLARE
  unidades numeric;
  importe numeric;
BEGIN
  -- En instalaciones nuevas o bases que nunca tuvieron el incidente no hay nada
  -- que reconciliar; la migración debe ser inocua.
  IF NOT EXISTS (SELECT 1 FROM "_w29_duplicate_disposable_lines") THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(linea."cantidad"), 0),
    COALESCE(SUM(linea."cantidad" * COALESCE(linea."precio_unitario", 0)), 0)
  INTO unidades, importe
  FROM "pedido_operativo_lineas" linea
  JOIN "pedidos_operativos" pedido ON pedido."id" = linea."pedido_id"
  JOIN "products" producto ON producto."id" = linea."product_id"
  WHERE pedido."fecha_entrega" BETWEEN DATE '2026-07-13' AND DATE '2026-07-18'
    AND pedido."estado" NOT IN ('borrador', 'cancelado')
    AND producto."linea_operacion" = 'desechables';

  IF unidades <> 359 OR ROUND(importe, 2) <> 11450.11 THEN
    RAISE EXCEPTION 'Reconciliación W29 no cuadra: % unidades / $%', unidades, ROUND(importe, 2);
  END IF;
END $$;

COMMIT;
