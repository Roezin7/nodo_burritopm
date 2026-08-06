-- Cambios logísticos BPM: nuevas sucursales, separación de Tapatíos y una sola
-- ruta independiente de desechables para el miércoles.
-- No se modifican pedidos, distribuciones ni rutas históricas ya generadas.

UPDATE "ubicaciones"
SET "nombre" = 'Crystal Lake', "activo" = true
WHERE "codigo" = 'CRYST';

UPDATE "ubicaciones"
SET "nombre" = 'Lake Zurich', "activo" = true
WHERE "codigo" = 'LAKEZ';

UPDATE "ubicaciones"
SET "nombre" = 'Frankfurt', "activo" = true
WHERE "codigo" = 'FRANK';

CREATE TEMP TABLE "_nod3_bpm_ruta_config" (
  "codigo" TEXT PRIMARY KEY,
  "nombre" TEXT NOT NULL,
  "linea_operacion" TEXT NOT NULL,
  "dia_semana" INTEGER NOT NULL,
  "conductor" TEXT NOT NULL,
  "paradas" TEXT[] NOT NULL
) ON COMMIT DROP;

INSERT INTO "_nod3_bpm_ruta_config" ("codigo", "nombre", "linea_operacion", "dia_semana", "conductor", "paradas") VALUES
  ('CAR-SUR-MIE', 'Carne Sur · miércoles', 'carne', 3, 'Pablo', ARRAY['LOMBA','LISLE','NAPER2','NAPER','AUROR','BATAV','WESTC','CAROL']),
  ('CAR-NOR-MIE', 'Carne Norte · miércoles', 'carne', 3, 'MH', ARRAY['GLEND','SCHAU','ROLLI','ALGON','CRYST','LAKEZ']),
  ('CAR-SUR-SAB', 'Carne Sur · sábado', 'carne', 6, 'Pablo', ARRAY['LOMBA','LISLE','NAPER2','NAPER','AUROR','BATAV','WESTC','CAROL']),
  ('CAR-NOR-SAB', 'Carne Norte · sábado', 'carne', 6, 'MH', ARRAY['GLEND','SCHAU','ROLLI','ALGON','CRYST','LAKEZ']),
  ('CAR-FRA-MIE', 'Carne Frankfurt · miércoles', 'carne', 3, 'POR ASIGNAR', ARRAY['FRANK']),
  ('CAR-FRA-SAB', 'Carne Frankfurt · sábado', 'carne', 6, 'POR ASIGNAR', ARRAY['FRANK']),
  ('TAP-LUN', 'Tapatíos · lunes', 'carne', 1, 'Pablo', ARRAY['TGE','TLO','TST','TNA','TBO']),
  ('TAP-JUE', 'Tapatíos · jueves', 'carne', 4, 'Pablo', ARRAY['TGE','TLO','TST','TNA','TBO']),
  ('TAP-SAB', 'Tapatíos · sábado', 'carne', 6, 'POR ASIGNAR', ARRAY['TGE','TLO','TST','TNA','TBO']),
  ('DES-BPM-MIE', 'Desechables BPM · miércoles', 'desechables', 3, 'POR ASIGNAR', ARRAY['LOMBA','LISLE','NAPER2','NAPER','BATAV','WESTC','CAROL','GLEND','SCHAU','ROLLI','ALGON','CRYST','LAKEZ','FRANK']);

-- Las plantillas antiguas dejan de participar en rutas futuras. Se conservan para
-- no romper referencias históricas y sus rutas ya creadas.
UPDATE "plantillas_ruta"
SET "activo" = false
WHERE "codigo" IN ('DES-NOR-MIE', 'DES-SUR-MIE')
  AND "linea_operacion" = 'desechables';

-- Crea o actualiza únicamente la configuración oficial. En una instalación limpia
-- sin ubicaciones todavía, el seed será quien cree estas plantillas después.
INSERT INTO "plantillas_ruta" (
  "negocio_id", "nombre", "codigo", "linea_operacion", "dia_semana", "conductor", "activo"
)
SELECT
  n."id",
  cfg."nombre",
  cfg."codigo",
  cfg."linea_operacion"::"LineaOperacion",
  cfg."dia_semana",
  cfg."conductor",
  true
FROM "negocios" n
CROSS JOIN "_nod3_bpm_ruta_config" cfg
WHERE NOT EXISTS (
  SELECT 1
  FROM unnest(cfg."paradas") AS faltante("codigo")
  WHERE NOT EXISTS (
    SELECT 1 FROM "ubicaciones" u
    WHERE u."negocio_id" = n."id" AND u."codigo" = faltante."codigo"
  )
)
ON CONFLICT ("negocio_id", "codigo") DO UPDATE SET
  "nombre" = EXCLUDED."nombre",
  "linea_operacion" = EXCLUDED."linea_operacion",
  "dia_semana" = EXCLUDED."dia_semana",
  "conductor" = EXCLUDED."conductor",
  "activo" = EXCLUDED."activo";

-- La lista de paradas de cada plantilla oficial se vuelve determinística. Esto no
-- toca ruta_paradas de distribuciones existentes.
DELETE FROM "plantilla_ruta_paradas" prp
USING "plantillas_ruta" pr, "_nod3_bpm_ruta_config" cfg
WHERE prp."plantilla_id" = pr."id"
  AND cfg."codigo" = pr."codigo"
  AND pr."linea_operacion" = cfg."linea_operacion"::"LineaOperacion";

INSERT INTO "plantilla_ruta_paradas" ("plantilla_id", "ubicacion_id", "orden", "opcional")
SELECT
  pr."id",
  u."id",
  parada."orden"::INTEGER,
  false
FROM "plantillas_ruta" pr
JOIN "_nod3_bpm_ruta_config" cfg
  ON cfg."codigo" = pr."codigo"
 AND pr."linea_operacion" = cfg."linea_operacion"::"LineaOperacion"
CROSS JOIN LATERAL unnest(cfg."paradas") WITH ORDINALITY AS parada("codigo", "orden")
JOIN "ubicaciones" u
  ON u."negocio_id" = pr."negocio_id"
 AND u."codigo" = parada."codigo"
ON CONFLICT ("plantilla_id", "ubicacion_id") DO UPDATE SET
  "orden" = EXCLUDED."orden",
  "opcional" = EXCLUDED."opcional";
