-- Corrige únicamente la carga histórica 3Q v4. Las columnas AQ y AS del libro
-- representan Streamwood y Lombard, respectivamente; el importador anterior las
-- asignó al revés. No toca semana 29 ni compras/producción capturadas por el admin.
CREATE TEMP TABLE "_lbt_disposable_swap" AS
SELECT p."id", p."fecha_entrega"
FROM "pedidos_operativos" p
JOIN "ubicaciones" u ON u."id" = p."ubicacion_id"
WHERE u."codigo" = 'TST'
  AND p."linea_operacion" = 'desechables'
  AND p."fecha_entrega" BETWEEN DATE '2026-06-29' AND DATE '2026-07-11'
  AND EXISTS (
    SELECT 1 FROM "importaciones_sistema" i
    WHERE i."negocio_id" = p."negocio_id" AND i."clave" = 'excel-3q-2026-pedidos-completos-v4'
  );

UPDATE "pedidos_operativos" p
SET "fecha_entrega" = p."fecha_entrega" + 20000
WHERE p."id" IN (SELECT "id" FROM "_lbt_disposable_swap");

UPDATE "pedidos_operativos" p
SET "ubicacion_id" = destino."id"
FROM "ubicaciones" actual, "ubicaciones" destino
WHERE p."ubicacion_id" = actual."id"
  AND actual."negocio_id" = destino."negocio_id"
  AND actual."codigo" = 'TLO' AND destino."codigo" = 'TST'
  AND p."linea_operacion" = 'desechables'
  AND p."fecha_entrega" BETWEEN DATE '2026-06-29' AND DATE '2026-07-11'
  AND EXISTS (
    SELECT 1 FROM "importaciones_sistema" i
    WHERE i."negocio_id" = p."negocio_id" AND i."clave" = 'excel-3q-2026-pedidos-completos-v4'
  );

UPDATE "pedidos_operativos" p
SET "ubicacion_id" = destino."id", "fecha_entrega" = temporal."fecha_entrega"
FROM "_lbt_disposable_swap" temporal, "ubicaciones" destino
WHERE p."id" = temporal."id"
  AND destino."negocio_id" = p."negocio_id"
  AND destino."codigo" = 'TLO';

-- Weekly Order concentra Pulpa y Tapatíos Taco Meat en un solo renglón. Billing y
-- las facturas LBT muestran que estas tres entregas de semana 28 fueron Pulpa a $90.
UPDATE "pedido_operativo_lineas" linea
SET "product_id" = pulpa."id", "precio_unitario" = COALESCE(pulpa."precio_venta_fijo", 90)
FROM "pedidos_operativos" pedido, "ubicaciones" ubicacion, "products" actual, "products" pulpa
WHERE linea."pedido_id" = pedido."id"
  AND pedido."ubicacion_id" = ubicacion."id"
  AND linea."product_id" = actual."id"
  AND actual."negocio_id" = pulpa."negocio_id"
  AND actual."sku" = 'MEAT-TAPATIOS-TACO' AND pulpa."sku" = 'MEAT-PULPA'
  AND NOT EXISTS (
    SELECT 1 FROM "pedido_operativo_lineas" existente
    WHERE existente."pedido_id" = pedido."id" AND existente."product_id" = pulpa."id"
  )
  AND pedido."linea_operacion" = 'carne'
  AND (
    (ubicacion."codigo" = 'TGE' AND pedido."fecha_entrega" = DATE '2026-07-09') OR
    (ubicacion."codigo" = 'TST' AND pedido."fecha_entrega" IN (DATE '2026-07-09', DATE '2026-07-11'))
  )
  AND EXISTS (
    SELECT 1 FROM "importaciones_sistema" i
    WHERE i."negocio_id" = pedido."negocio_id" AND i."clave" = 'excel-3q-2026-pedidos-completos-v4'
  );

DROP TABLE "_lbt_disposable_swap";
