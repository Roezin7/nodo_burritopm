-- La semana operativa abre el domingo y cierra el sábado. Los registros históricos
-- estaban guardados como lunes-sábado; solo se mueve el límite y la fotografía de
-- apertura, nunca las compras, producciones, pedidos, despachos ni cierres.
UPDATE "conteos" AS c
SET "fecha" = s."inicia_at" - 1,
    "notas" = REGEXP_REPLACE(
      c."notas",
      '^inventario_inicial_operativo:[0-9]{4}-[0-9]{2}-[0-9]{2}',
      'inventario_inicial_operativo:' || TO_CHAR(s."inicia_at" - 1, 'YYYY-MM-DD')
    )
FROM "semanas_operativas" AS s
WHERE c."negocio_id" = s."negocio_id"
  AND c."fecha" = s."inicia_at"
  AND c."notas" LIKE 'inventario_inicial_operativo:%'
  AND EXTRACT(ISODOW FROM s."inicia_at") = 1
  AND s."termina_at" - s."inicia_at" = 5;

UPDATE "semanas_operativas"
SET "inicia_at" = "inicia_at" - 1
WHERE EXTRACT(ISODOW FROM "inicia_at") = 1
  AND "termina_at" - "inicia_at" = 5;
