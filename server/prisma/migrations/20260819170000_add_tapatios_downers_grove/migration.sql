BEGIN;

INSERT INTO "ubicaciones" (
  "negocio_id", "nombre", "codigo", "tipo", "activo", "orden_operativo", "empresa_cliente_id"
)
SELECT n."id", 'Burritos Tapatíos Downers Grove', 'TDOW', 'sucursal', true, 23, e."id"
FROM "negocios" n
JOIN "empresas_clientes" e
  ON e."negocio_id" = n."id"
 AND e."codigo" = 'LBT'
WHERE n."nombre" = 'Burrito Parrilla Mexicana'
ON CONFLICT ("negocio_id", "codigo") DO UPDATE SET
  "nombre" = EXCLUDED."nombre",
  "tipo" = EXCLUDED."tipo",
  "activo" = true,
  "orden_operativo" = EXCLUDED."orden_operativo",
  "empresa_cliente_id" = EXCLUDED."empresa_cliente_id";

INSERT INTO "plantilla_ruta_paradas" ("plantilla_id", "ubicacion_id", "orden", "opcional")
SELECT pr."id", u."id", COALESCE(MAX(existing."orden"), 0) + 1, false
FROM "plantillas_ruta" pr
JOIN "ubicaciones" u
  ON u."negocio_id" = pr."negocio_id"
 AND u."codigo" = 'TDOW'
LEFT JOIN "plantilla_ruta_paradas" existing
  ON existing."plantilla_id" = pr."id"
WHERE pr."negocio_id" = (SELECT "id" FROM "negocios" WHERE "nombre" = 'Burrito Parrilla Mexicana')
  AND pr."codigo" IN ('TAP-LUN', 'TAP-JUE', 'TAP-SAB')
  AND pr."linea_operacion" = 'carne'
  AND pr."activo" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "plantilla_ruta_paradas" already
    WHERE already."plantilla_id" = pr."id"
      AND already."ubicacion_id" = u."id"
  )
GROUP BY pr."id", u."id"
ON CONFLICT ("plantilla_id", "ubicacion_id") DO NOTHING;

COMMIT;
