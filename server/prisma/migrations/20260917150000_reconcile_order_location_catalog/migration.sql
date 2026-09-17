-- Auditoría de pedidos históricos: había renglones positivos en sucursales
-- donde producto_ubicacion no estaba habilitado. Eso hacía que la captura de
-- otro día mostrara un formato distinto y ocultara productos ya utilizados.
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

  -- El catálogo BPM completo se maneja en las sucursales no opcionales de la
  -- ruta de desechables (incluye Crystal Lake). LAKEZ y FRANK siguen siendo
  -- opcionales y no se habilitan por esta reparación.
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
   AND u."codigo" IN ('ALGON', 'BATAV', 'CAROL', 'CRYST', 'GLEND', 'LISLE',
                       'LOMBA', 'NAPER', 'NAPER2', 'ROLLI', 'SCHAU', 'WESTC')
  JOIN "empresas_clientes" e
    ON e."id" = u."empresa_cliente_id"
   AND e."negocio_id" = v_negocio_id
   AND e."codigo" = 'BPM'
  WHERE p."negocio_id" = v_negocio_id
    AND p."activo" = TRUE
    AND p."es_cargo_compra" = FALSE
    AND p."linea_operacion" = 'desechables'::"LineaOperacion"
  ON CONFLICT ("ubicacion_id", "product_id") DO UPDATE
    SET "habilitado" = TRUE;

  -- Estos consumibles forman parte del formato operativo de carne Tapatíos y
  -- ya aparecen en pedidos de lunes, jueves y sábado de las seis sucursales.
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
  JOIN "empresas_clientes" e
    ON e."id" = u."empresa_cliente_id"
   AND e."negocio_id" = v_negocio_id
   AND e."codigo" = 'LBT'
  WHERE p."negocio_id" = v_negocio_id
    AND p."activo" = TRUE
    AND p."es_cargo_compra" = FALSE
    AND p."sku" IN ('BPM-0008', 'BPM-0017', 'BPM-0019', 'BPM-0020',
                     'BPM-0029', 'BPM-0047', 'BPM-0048', 'BPM-0049')
  ON CONFLICT ("ubicacion_id", "product_id") DO UPDATE
    SET "habilitado" = TRUE;
END $$;
