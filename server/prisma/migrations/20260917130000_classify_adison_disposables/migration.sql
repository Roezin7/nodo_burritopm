-- Los productos de desechables que ya existían en Configuración no tenían
-- línea operativa. Por eso no aparecían ni en Bodega Adison ni en Pedidos.
-- Se conservan sus SKU, costos y movimientos históricos; sólo se completa su
-- clasificación y el orden del catálogo.
DO $$
DECLARE
  v_negocio_id BIGINT;
BEGIN
  SELECT id INTO v_negocio_id
  FROM "negocios"
  WHERE nombre = 'Burrito Parrilla Mexicana'
  LIMIT 1;

  IF v_negocio_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE "products"
  SET "linea_operacion" = 'desechables'::"LineaOperacion",
      "tipo_operativo" = 'desechable'::"TipoProductoOperacion",
      "orden_operativo" = CASE "sku"
        WHEN 'F 30625' THEN 56
        WHEN 'ZZ 8520' THEN 57
        WHEN 'ZZ 8550' THEN 58
        WHEN 'ZZ 8440' THEN 59
        WHEN 'A6 1321' THEN 60
      END
  WHERE "negocio_id" = v_negocio_id
    AND "sku" IN ('F 30625', 'ZZ 8520', 'ZZ 8550', 'ZZ 8440', 'A6 1321');

  -- Toda entrada de desechables se controla en Bodega Adison.
  INSERT INTO "producto_ubicacion" (
    "negocio_id", "ubicacion_id", "product_id", "habilitado",
    "stock_min", "stock_seguridad", "stock_objetivo", "multiplo_distribucion",
    "minimo_envio", "origen_calculo"
  )
  SELECT
    p."negocio_id", u."id", p."id", TRUE,
    COALESCE(p."stock_min_bodega", 0), COALESCE(p."stock_seguridad_bodega", 0), 0, 1,
    0, 'manual'::"OrigenCalculo"
  FROM "products" p
  JOIN "ubicaciones" u
    ON u."negocio_id" = p."negocio_id"
   AND u."codigo" = 'BOD'
   AND u."tipo" = 'bodega'::"TipoUbicacion"
   AND u."activo" = TRUE
  WHERE p."negocio_id" = v_negocio_id
    AND p."activo" = TRUE
    AND p."es_cargo_compra" = FALSE
    AND p."sku" IN ('F 30625', 'ZZ 8520', 'ZZ 8550', 'ZZ 8440', 'A6 1321')
  ON CONFLICT ("ubicacion_id", "product_id") DO UPDATE
    SET "habilitado" = TRUE;

  -- Se habilitan en las mismas sucursales BPM que ya manejan los desechables
  -- operativos; así el producto aparece en cada pedido de desechables sin
  -- hacerlo disponible accidentalmente en las líneas de carne o LBT.
  INSERT INTO "producto_ubicacion" (
    "negocio_id", "ubicacion_id", "product_id", "habilitado",
    "stock_min", "stock_seguridad", "stock_objetivo", "multiplo_distribucion",
    "minimo_envio", "origen_calculo"
  )
  SELECT
    p."negocio_id", u."id", p."id", TRUE,
    0, 0, 0, 1, 0, 'manual'::"OrigenCalculo"
  FROM "products" p
  JOIN "ubicaciones" u
    ON u."negocio_id" = p."negocio_id"
   AND u."tipo" = 'sucursal'::"TipoUbicacion"
   AND u."activo" = TRUE
   AND u."codigo" IN ('ALGON', 'BATAV', 'CAROL', 'GLEND', 'LISLE', 'LOMBA',
                       'NAPER', 'NAPER2', 'ROLLI', 'SCHAU', 'WESTC')
  JOIN "empresas_clientes" e ON e."id" = u."empresa_cliente_id"
                              AND e."codigo" = 'BPM'
                              AND e."negocio_id" = v_negocio_id
  WHERE p."negocio_id" = v_negocio_id
    AND p."activo" = TRUE
    AND p."es_cargo_compra" = FALSE
    AND p."sku" IN ('F 30625', 'ZZ 8520', 'ZZ 8550', 'ZZ 8440', 'A6 1321')
  ON CONFLICT ("ubicacion_id", "product_id") DO UPDATE
    SET "habilitado" = TRUE;
END $$;
