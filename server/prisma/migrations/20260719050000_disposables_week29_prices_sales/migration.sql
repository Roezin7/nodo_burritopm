-- Semana 29.xlsx distingue COST de SELLING PRICE. Se fija el precio de venta del
-- catálogo sin alterar el costo FIFO real de las compras capturadas por el admin.
WITH "precios" ("sku", "precio_venta") AS (
  VALUES
    ('BPM-0001', 62.10), ('BPM-0002', 42.47), ('BPM-0003', 35.94),
    ('BPM-0004', 27.60), ('BPM-0005', 46.74), ('BPM-0006', 53.94),
    ('BPM-0007', 21.90), ('BPM-0008', 35.94), ('BPM-0009', 27.54),
    ('BPM-0010', 26.39), ('BPM-0011', 22.49), ('BPM-0012', 33.00),
    ('BPM-0013', 13.28), ('BPM-0014', 15.64), ('BPM-0015', 22.74),
    ('BPM-0016', 27.54), ('BPM-0017', 40.74), ('BPM-0018', 19.02),
    ('BPM-0019', 26.34), ('BPM-0020', 40.20), ('BPM-0021', 42.85),
    ('BPM-0022', 96.50), ('BPM-0023', 16.56), ('BPM-0024', 33.59),
    ('BPM-0025', 39.59), ('BPM-0026', 27.66), ('BPM-0027', 31.33),
    ('BPM-0028', 50.69), ('BPM-0029', 90.83), ('BPM-0030', 6.00),
    ('BPM-0031', 36.00), ('BPM-0032', 6.00), ('BPM-0033', 6.00),
    ('BPM-0034', 6.00), ('BPM-0035', 30.00), ('BPM-0036', 30.00),
    ('BPM-0037', 30.00), ('BPM-0038', 30.00), ('BPM-0039', 30.00),
    ('BPM-0040', 30.00), ('BPM-0041', 30.00), ('BPM-0042', 30.00),
    ('BPM-0043', 42.00), ('BPM-0044', 25.80), ('BPM-0045', 25.80),
    ('BPM-0046', 25.80), ('BPM-0047', 34.88), ('BPM-0048', 34.88),
    ('BPM-0049', 28.26), ('BPM-0050', 33.06), ('BPM-0051', 24.55),
    ('BPM-0052', 24.00)
)
UPDATE "products" producto
SET "precio_venta_fijo" = precio."precio_venta"
FROM "precios" precio
WHERE producto."sku" = precio."sku"
  AND producto."linea_operacion" = 'desechables';

-- Corrige las ventas abiertas de semana 29 para que dashboard, cierre y facturación
-- usen SELLING PRICE. No modifica facturas históricas ya emitidas.
UPDATE "pedido_operativo_lineas" linea
SET "precio_unitario" = producto."precio_venta_fijo"
FROM "pedidos_operativos" pedido, "products" producto
WHERE linea."pedido_id" = pedido."id"
  AND linea."product_id" = producto."id"
  AND pedido."linea_operacion" = 'desechables'
  AND pedido."fecha_entrega" BETWEEN DATE '2026-07-13' AND DATE '2026-07-18'
  AND pedido."estado" IN ('borrador', 'confirmado')
  AND producto."linea_operacion" = 'desechables'
  AND producto."precio_venta_fijo" IS NOT NULL;

-- La comparación celda por celda encontró un solo producto omitido por la vista
-- anterior (que terminaba en BPM-0046): 18 cajas de Fried Ice Cream. Solo se
-- insertan renglones inexistentes; cualquier corrección manual prevalece.
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
 AND pedido."estado" IN ('borrador', 'confirmado')
JOIN "products" producto
  ON producto."negocio_id" = pedido."negocio_id"
 AND producto."sku" = 'BPM-0050'
ON CONFLICT ("pedido_id", "product_id") DO NOTHING;
