-- FIFO de desechables: cada salida conserva exactamente qué compras consumió.
CREATE TABLE "consumos_lote_inventario" (
    "movimiento_id" BIGINT NOT NULL,
    "lote_id" BIGINT NOT NULL,
    "cajas" DECIMAL(12,3) NOT NULL,
    "peso_lb" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "costo" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "consumos_lote_inventario_pkey" PRIMARY KEY ("movimiento_id", "lote_id")
);

CREATE INDEX "consumos_lote_inventario_lote_id_idx" ON "consumos_lote_inventario"("lote_id");

ALTER TABLE "consumos_lote_inventario" ADD CONSTRAINT "consumos_lote_inventario_movimiento_id_fkey"
  FOREIGN KEY ("movimiento_id") REFERENCES "movimientos_inventario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consumos_lote_inventario" ADD CONSTRAINT "consumos_lote_inventario_lote_id_fkey"
  FOREIGN KEY ("lote_id") REFERENCES "lotes_materia_prima"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reconstruye las capas FIFO históricas. El saldo actual se asigna primero a las compras
-- más nuevas, que es equivalente a considerar consumidas las compras más antiguas.
WITH compras_ordenadas AS (
  SELECT
    cl.id AS compra_linea_id,
    c.negocio_id,
    c.ubicacion_id,
    cl.product_id,
    c.fecha,
    cl.cajas,
    cl.costo_total,
    GREATEST(0::numeric, COALESCE(e.cantidad_disponible, 0)) AS existencia_actual,
    COALESCE(SUM(cl.cajas) OVER (
      PARTITION BY c.negocio_id, c.ubicacion_id, cl.product_id
      ORDER BY c.fecha DESC, cl.id DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ), 0) AS compras_mas_nuevas
  FROM compra_lineas cl
  JOIN compras c ON c.id = cl.compra_id AND c.estado <> 'cancelada'
  JOIN products p ON p.id = cl.product_id AND p.linea_operacion = 'desechables'
  LEFT JOIN existencias e ON e.ubicacion_id = c.ubicacion_id AND e.product_id = cl.product_id
), capas AS (
  SELECT *,
    GREATEST(0::numeric, LEAST(cajas, existencia_actual - compras_mas_nuevas)) AS cajas_restantes
  FROM compras_ordenadas
)
INSERT INTO lotes_materia_prima (
  negocio_id, ubicacion_id, product_id, compra_linea_id, fecha, congelado,
  cajas_iniciales, cajas_disponibles, peso_inicial_lb, peso_disponible_lb,
  costo_inicial, costo_disponible
)
SELECT
  negocio_id, ubicacion_id, product_id, compra_linea_id, fecha, false,
  cajas, cajas_restantes, 0, 0,
  costo_total,
  ROUND(CASE WHEN cajas > 0 THEN costo_total * cajas_restantes / cajas ELSE 0 END, 2)
FROM capas
ON CONFLICT (compra_linea_id) DO NOTHING;

-- Inventario importado o anterior a las compras capturadas queda en una capa inicial.
WITH saldos AS (
  SELECT
    e.negocio_id,
    e.ubicacion_id,
    e.product_id,
    GREATEST(0::numeric, e.cantidad_disponible) AS existencia_actual,
    COALESCE(SUM(CASE WHEN c.estado <> 'cancelada' THEN cl.cajas ELSE 0 END), 0) AS compras,
    COALESCE(MIN(CASE WHEN c.estado <> 'cancelada' THEN c.fecha END), DATE '2026-01-01') AS primera_compra,
    COALESCE(e.costo_promedio, p.ultimo_costo, p.costo_promedio, 0) AS costo_unitario
  FROM existencias e
  JOIN products p ON p.id = e.product_id AND p.linea_operacion = 'desechables'
  LEFT JOIN compra_lineas cl ON cl.product_id = e.product_id
  LEFT JOIN compras c ON c.id = cl.compra_id AND c.ubicacion_id = e.ubicacion_id
  GROUP BY e.negocio_id, e.ubicacion_id, e.product_id, e.cantidad_disponible,
           e.costo_promedio, p.ultimo_costo, p.costo_promedio
), iniciales AS (
  SELECT *, GREATEST(0::numeric, existencia_actual - compras) AS cajas_iniciales
  FROM saldos
)
INSERT INTO lotes_materia_prima (
  negocio_id, ubicacion_id, product_id, compra_linea_id, fecha, congelado,
  cajas_iniciales, cajas_disponibles, peso_inicial_lb, peso_disponible_lb,
  costo_inicial, costo_disponible
)
SELECT
  negocio_id, ubicacion_id, product_id, NULL, primera_compra - 1, false,
  cajas_iniciales, cajas_iniciales, 0, 0,
  ROUND(cajas_iniciales * costo_unitario, 2), ROUND(cajas_iniciales * costo_unitario, 2)
FROM iniciales
WHERE cajas_iniciales > 0;

-- La existencia visible parte desde el costo exacto de las capas que siguen disponibles.
WITH costos AS (
  SELECT ubicacion_id, product_id,
         SUM(cajas_disponibles) AS cajas,
         SUM(costo_disponible) AS costo
  FROM lotes_materia_prima l
  JOIN products p ON p.id = l.product_id AND p.linea_operacion = 'desechables'
  GROUP BY ubicacion_id, product_id
)
UPDATE existencias e
SET costo_promedio = CASE WHEN costos.cajas > 0 THEN ROUND(costos.costo / costos.cajas, 4) ELSE NULL END
FROM costos
WHERE e.ubicacion_id = costos.ubicacion_id AND e.product_id = costos.product_id;
