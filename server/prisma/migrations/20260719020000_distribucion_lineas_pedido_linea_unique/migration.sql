-- Evita líneas de distribución duplicadas para el mismo renglón de pedido bajo escritura
-- concurrente (dos solicitudes agregando la misma sucursal al mismo consolidado a la vez).
-- Postgres no considera NULL como valor repetido en un índice único, así que las líneas sin
-- pedido_linea_id (flujo legado de crearDistribucion) no quedan restringidas por esto.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "distribucion_lineas"
    WHERE "pedido_linea_id" IS NOT NULL
    GROUP BY "pedido_linea_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay renglones de pedido asignados a más de una distribución. Corrige esos duplicados antes de desplegar esta migración.';
  END IF;
END $$;

CREATE UNIQUE INDEX "distribucion_lineas_pedido_linea_id_key" ON "distribucion_lineas"("pedido_linea_id");
