-- Todo producto operativo debe tener un renglón en la bodega que alimenta su
-- línea. Sin esta relación podía existir en Configuración y aun así quedar fuera
-- de la apertura/conteo de inventario.
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
 AND u."tipo" = 'bodega'::"TipoUbicacion"
 AND u."activo" = TRUE
 AND u."codigo" = CASE WHEN p."linea_operacion" = 'carne'::"LineaOperacion" THEN 'CARN' ELSE 'BOD' END
WHERE p."activo" = TRUE
  AND p."es_cargo_compra" = FALSE
  AND p."linea_operacion" IS NOT NULL
ON CONFLICT ("ubicacion_id", "product_id") DO NOTHING;
