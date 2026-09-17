-- El formato de pedidos de carne de Tapatíos contempla estos consumibles.
-- Antes sólo tenían configuración explícita en algunas sucursales LBT, por lo
-- que el filtro por ubicación los ocultaba en las demás aunque el formato y
-- los pedidos históricos sí los utilizaban.
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
    AND p."sku" IN ('BPM-0008', 'BPM-0017', 'BPM-0047', 'BPM-0048', 'BPM-0049')
  ON CONFLICT ("ubicacion_id", "product_id") DO UPDATE
    SET "habilitado" = TRUE;
END $$;
