CREATE TABLE "ajustes_facturacion" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "empresa_cliente_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "linea_operacion" "LineaOperacion" NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'credito',
    "descripcion" TEXT NOT NULL,
    "monto" DECIMAL(12,4) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'abierto',
    "factura_id" BIGINT,
    "creado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aplicado_at" TIMESTAMPTZ(6),

    CONSTRAINT "ajustes_facturacion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ajustes_facturacion_negocio_id_estado_idx"
    ON "ajustes_facturacion"("negocio_id", "estado");
CREATE INDEX "ajustes_facturacion_semana_id_ubicacion_id_linea_operacion_idx"
    ON "ajustes_facturacion"("semana_id", "ubicacion_id", "linea_operacion");
CREATE INDEX "ajustes_facturacion_factura_id_idx"
    ON "ajustes_facturacion"("factura_id");

ALTER TABLE "ajustes_facturacion"
    ADD CONSTRAINT "ajustes_facturacion_negocio_id_fkey"
    FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ajustes_facturacion"
    ADD CONSTRAINT "ajustes_facturacion_semana_id_fkey"
    FOREIGN KEY ("semana_id") REFERENCES "semanas_operativas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ajustes_facturacion"
    ADD CONSTRAINT "ajustes_facturacion_empresa_cliente_id_fkey"
    FOREIGN KEY ("empresa_cliente_id") REFERENCES "empresas_clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ajustes_facturacion"
    ADD CONSTRAINT "ajustes_facturacion_ubicacion_id_fkey"
    FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ajustes_facturacion"
    ADD CONSTRAINT "ajustes_facturacion_factura_id_fkey"
    FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Crédito abierto que aparece en el Billing real de la semana 29: BPM debe a Lisle
-- la mitad del costo de producción listado en CF6:CF13 ($17,920.33 / 2).
INSERT INTO "ajustes_facturacion" (
    "negocio_id", "semana_id", "empresa_cliente_id", "ubicacion_id",
    "linea_operacion", "tipo", "descripcion", "monto", "estado", "creado_por"
)
SELECT n."id", s."id", e."id", u."id", 'carne', 'credito',
       'Crédito BPM Lisle por producción', 8960.1650, 'abierto', admin."id"
FROM "negocios" n
JOIN "semanas_operativas" s ON s."negocio_id" = n."id" AND s."anio" = 2026 AND s."semana" = 29
JOIN "ubicaciones" u ON u."negocio_id" = n."id" AND u."codigo" = 'LISLE'
JOIN "empresas_clientes" e ON e."id" = u."empresa_cliente_id"
JOIN LATERAL (
    SELECT us."id" FROM "usuarios" us
    WHERE us."negocio_id" = n."id" AND us."rol" = 'admin'
    ORDER BY us."id" ASC LIMIT 1
) admin ON TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM "ajustes_facturacion" a
    WHERE a."semana_id" = s."id" AND a."ubicacion_id" = u."id"
      AND a."linea_operacion" = 'carne'
      AND a."descripcion" = 'Crédito BPM Lisle por producción'
);
