-- Normaliza el costo operativo de BOTTLED WATER en producto, existencias,
-- lotes FIFO y movimientos. Conservamos la precisión de la factura ($20.4841,
-- que se muestra como $20.48) para no cambiar el total real de la compra.
DO $$
DECLARE
  v_negocio_id BIGINT;
  v_product_id BIGINT;
  v_costo NUMERIC(12, 4) := 20.4841;
BEGIN
  SELECT id INTO v_negocio_id
  FROM "negocios"
  WHERE nombre = 'Burrito Parrilla Mexicana'
  LIMIT 1;

  IF v_negocio_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_product_id
  FROM "products"
  WHERE negocio_id = v_negocio_id AND sku = 'BPM-0055' AND nombre = 'BOTTLED WATER'
  LIMIT 1;

  IF v_product_id IS NULL THEN
    RETURN;
  END IF;

  -- La configuración debe representar el costo unitario vigente.
  UPDATE "products"
  SET costo_promedio = v_costo,
      ultimo_costo = v_costo
  WHERE id = v_product_id;

  -- Todas las ubicaciones con agua disponible deben mostrar la misma base
  -- unitaria, no el cero heredado de la captura inicial.
  UPDATE "existencias"
  SET costo_promedio = v_costo,
      costo_transito_promedio = CASE
        WHEN cantidad_transito > 0 THEN v_costo
        ELSE costo_transito_promedio
      END
  WHERE negocio_id = v_negocio_id AND product_id = v_product_id
    AND (cantidad_disponible > 0 OR cantidad_transito > 0);

  -- Revaloriza el lote físico inicial que fue creado sin costo y conserva el
  -- costo de los lotes posteriores de la misma presentación.
  UPDATE "lotes_materia_prima"
  SET costo_inicial = ROUND(cajas_iniciales * v_costo, 2),
      costo_disponible = ROUND(cajas_disponibles * v_costo, 2)
  WHERE negocio_id = v_negocio_id AND product_id = v_product_id;

  -- Los consumos y transferencias ya ocurridos deben conservar el costo FIFO
  -- que les correspondía; de otro modo el inventario de las sucursales seguiría
  -- apareciendo en cero aunque el lote de Bodega tenga costo.
  UPDATE "movimientos_inventario"
  SET costo_unitario = v_costo,
      costo_total = ROUND(cantidad * v_costo, 2)
  WHERE negocio_id = v_negocio_id AND product_id = v_product_id;

  UPDATE "consumos_lote_inventario" c
  SET costo = ROUND(c.cajas * v_costo, 2)
  FROM "movimientos_inventario" m
  WHERE c.movimiento_id = m.id
    AND m.negocio_id = v_negocio_id
    AND m.product_id = v_product_id;

  -- La línea de compra ya contiene el mismo costo con cuatro decimales; esta
  -- asignación hace la migración idempotente y repara cualquier captura parcial.
  UPDATE "compra_lineas" cl
  SET costo_total = ROUND(cl.cajas * v_costo, 2)
  FROM "compras" c
  WHERE cl.compra_id = c.id
    AND c.negocio_id = v_negocio_id
    AND cl.product_id = v_product_id;
END $$;
