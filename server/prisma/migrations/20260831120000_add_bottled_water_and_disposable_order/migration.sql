-- Agrega Bottled Water sin existencia inicial y ajusta el orden visible del
-- catálogo conservando los SKU históricos.
DO $$
DECLARE
  v_negocio_id BIGINT;
  v_categoria_id BIGINT;
  v_caja_id BIGINT;
BEGIN
  SELECT id INTO v_negocio_id
  FROM "negocios"
  WHERE nombre = 'Burrito Parrilla Mexicana'
  LIMIT 1;

  IF v_negocio_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_categoria_id
  FROM "categorias"
  WHERE negocio_id = v_negocio_id AND nombre = 'Desechables'
  LIMIT 1;

  SELECT id INTO v_caja_id
  FROM "unidades"
  WHERE negocio_id = v_negocio_id AND nombre = 'Caja'
  LIMIT 1;

  IF v_categoria_id IS NULL OR v_caja_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró la categoría Desechables o la unidad Caja';
  END IF;

  INSERT INTO "products" (
    negocio_id, nombre, sku, categoria_id, unidad_distribucion_id,
    unidad_compra_id, unidad_almacen_id, costo_promedio, ultimo_costo,
    precio_venta_fijo, linea_operacion, tipo_operativo, orden_operativo
  ) VALUES (
    v_negocio_id, 'BOTTLED WATER', 'BPM-0055', v_categoria_id, v_caja_id,
    v_caja_id, v_caja_id, 0, 0, 0,
    'desechables'::"LineaOperacion", 'desechable'::"TipoProductoOperacion", 47
  )
  ON CONFLICT (negocio_id, sku) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    categoria_id = EXCLUDED.categoria_id,
    unidad_distribucion_id = EXCLUDED.unidad_distribucion_id,
    unidad_compra_id = EXCLUDED.unidad_compra_id,
    unidad_almacen_id = EXCLUDED.unidad_almacen_id,
    costo_promedio = EXCLUDED.costo_promedio,
    ultimo_costo = EXCLUDED.ultimo_costo,
    precio_venta_fijo = EXCLUDED.precio_venta_fijo,
    linea_operacion = EXCLUDED.linea_operacion,
    tipo_operativo = EXCLUDED.tipo_operativo,
    orden_operativo = EXCLUDED.orden_operativo,
    activo = TRUE;

  UPDATE "products"
  SET orden_operativo = CASE sku
    WHEN 'BPM-0053' THEN 48 -- CLASIC COKE
    WHEN 'BPM-0054' THEN 49 -- CO2 CYLINDER 20 LBS
    WHEN 'BPM-0052' THEN 50 -- RICE FLOUR
    WHEN 'BPM-0051' THEN 51 -- CUPS 12 BLACK
    WHEN 'BPM-0047' THEN 52 -- TAPATIOS THREE COMPARTMENT
    WHEN 'BPM-0048' THEN 53 -- TAPATIOS ONE COMPARTMENT
    WHEN 'BPM-0049' THEN 54 -- TAPATIOS SUIZO
    WHEN 'BPM-0050' THEN 55 -- FRIED ICE CREAM
    ELSE orden_operativo
  END
  WHERE negocio_id = v_negocio_id
    AND sku IN ('BPM-0053', 'BPM-0054', 'BPM-0052', 'BPM-0051', 'BPM-0047', 'BPM-0048', 'BPM-0049', 'BPM-0050');
END $$;
