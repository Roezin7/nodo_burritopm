-- Lake Zurich y Frankfurt siguen disponibles para pedir cuando haga falta,
-- pero su ausencia no debe bloquear avisos, cobertura ni el cierre semanal.
-- La bandera vive en la parada de ruta, no en la sucursal: permite que una
-- ubicación opcional vuelva a participar simplemente capturando un pedido.
UPDATE "plantilla_ruta_paradas" rp
SET opcional = TRUE
FROM "plantillas_ruta" r, "ubicaciones" u
WHERE rp.plantilla_id = r.id
  AND rp.ubicacion_id = u.id
  AND r.negocio_id = u.negocio_id
  AND r.negocio_id = (SELECT id FROM "negocios" WHERE nombre = 'Burrito Parrilla Mexicana' LIMIT 1)
  AND u.codigo IN ('LAKEZ', 'FRANK')
  AND r.linea_operacion IN ('carne'::"LineaOperacion", 'desechables'::"LineaOperacion");
