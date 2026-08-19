-- El inventario maestro coloca CUP HOLDER en el renglón 8 de Desechables.
-- BPM-0008 también se usa como consumible exclusivo de Tapatíos en la hoja de
-- carne; corregir su línea de catálogo no elimina esa captura especial.
DO $$
DECLARE
  v_negocio_id BIGINT;
  por_sku BIGINT;
  por_nombre BIGINT;
  producto_id BIGINT;
BEGIN
  SELECT id INTO v_negocio_id
  FROM "negocios"
  WHERE nombre = 'Burrito Parrilla Mexicana'
  LIMIT 1;

  IF v_negocio_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO por_sku
  FROM "products"
  WHERE products.negocio_id = v_negocio_id AND sku = 'BPM-0008'
  LIMIT 1;

  SELECT id INTO por_nombre
  FROM "products"
  WHERE products.negocio_id = v_negocio_id
    AND UPPER(TRIM(nombre)) = 'CUP HOLDER'
  LIMIT 1;

  IF por_sku IS NOT NULL AND por_nombre IS NOT NULL AND por_sku <> por_nombre THEN
    RAISE EXCEPTION 'CUP HOLDER tiene SKU BPM-0008 y nombre en productos distintos';
  END IF;

  producto_id := COALESCE(por_sku, por_nombre);
  IF producto_id IS NULL THEN
    RAISE NOTICE 'No existe CUP HOLDER/BPM-0008; la sincronización del catálogo lo creará desde Inventarios .xlsx';
    RETURN;
  END IF;

  UPDATE "products"
  SET nombre = 'CUP HOLDER',
      sku = 'BPM-0008',
      linea_operacion = 'desechables'::"LineaOperacion",
      tipo_operativo = 'desechable'::"TipoProductoOperacion",
      orden_operativo = 8
  WHERE id = producto_id;
END $$;
