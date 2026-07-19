-- DN55:DO55 de Semana 29.xlsx suma $11,450.11. Los consumibles LBTP incluidos
-- dentro de órdenes de carne conservan linea_operacion=desechables y ya aportan
-- $895.00 a ese total. Solo faltan estas diferencias ($625.96); crear el total
-- completo otra vez duplicaría ventas y salidas de inventario.
WITH "ubicaciones_con_venta" ("codigo") AS (
  VALUES ('TGE'), ('TST'), ('TNA')
)
INSERT INTO "pedidos_operativos" (
  "negocio_id",
  "empresa_cliente_id",
  "ubicacion_id",
  "linea_operacion",
  "fecha_entrega",
  "estado",
  "capturado_por",
  "confirmado_at"
)
SELECT
  ubicacion."negocio_id",
  ubicacion."empresa_cliente_id",
  ubicacion."id",
  'desechables',
  DATE '2026-07-15',
  'confirmado',
  administrador."id",
  CURRENT_TIMESTAMP
FROM "ubicaciones_con_venta" venta
JOIN "ubicaciones" ubicacion
  ON ubicacion."codigo" = venta."codigo"
 AND ubicacion."empresa_cliente_id" IS NOT NULL
JOIN LATERAL (
  SELECT usuario."id"
  FROM "usuarios" usuario
  WHERE usuario."negocio_id" = ubicacion."negocio_id"
    AND usuario."rol" = 'admin'
    AND usuario."activo" = true
  ORDER BY usuario."id"
  LIMIT 1
) administrador ON true
ON CONFLICT ("ubicacion_id", "linea_operacion", "fecha_entrega") DO NOTHING;

WITH "ventas_faltantes" ("codigo", "sku", "cantidad") AS (
  VALUES
    ('TGE', 'BPM-0020', 2),
    ('TST', 'BPM-0047', 3),
    ('TNA', 'BPM-0019', 4),
    ('TNA', 'BPM-0047', 6),
    ('TNA', 'BPM-0048', 2),
    ('TNA', 'BPM-0049', 2)
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
JOIN "products" producto
  ON producto."negocio_id" = pedido."negocio_id"
 AND producto."sku" = venta."sku"
ON CONFLICT ("pedido_id", "product_id") DO UPDATE
SET "cantidad" = EXCLUDED."cantidad",
    "precio_unitario" = EXCLUDED."precio_unitario";
