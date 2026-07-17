-- CreateEnum
CREATE TYPE "LineaOperacion" AS ENUM ('carne', 'desechables');

-- CreateEnum
CREATE TYPE "TipoEmpresaCliente" AS ENUM ('interna', 'externa');

-- CreateEnum
CREATE TYPE "TipoProductoOperacion" AS ENUM ('desechable', 'materia_prima', 'proteina', 'precio_fijo', 'servicio');

-- CreateEnum
CREATE TYPE "EstadoPedidoOperativo" AS ENUM ('borrador', 'confirmado', 'en_preparacion', 'despachado', 'entregado', 'cerrado', 'cancelado');

-- CreateEnum
CREATE TYPE "EstadoCompra" AS ENUM ('pendiente', 'pagada', 'cancelada');

-- CreateEnum
CREATE TYPE "EstadoSemana" AS ENUM ('abierta', 'cerrada', 'reabierta');

-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('borrador', 'emitida', 'pagada', 'anulada');

-- AlterTable
ALTER TABLE "distribucion_lineas" ADD COLUMN     "pedido_linea_id" BIGINT;

-- AlterTable
ALTER TABLE "distribuciones" ADD COLUMN     "fecha_entrega" DATE,
ADD COLUMN     "linea_operacion" "LineaOperacion",
ADD COLUMN     "semana_id" BIGINT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "linea_operacion" "LineaOperacion",
ADD COLUMN     "markup_caja" DECIMAL(12,4) NOT NULL DEFAULT 0,
ADD COLUMN     "peso_caja_lb" DECIMAL(12,3),
ADD COLUMN     "precio_venta_fijo" DECIMAL(12,4),
ADD COLUMN     "produccion_dias" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "tipo_operativo" "TipoProductoOperacion";

-- AlterTable
ALTER TABLE "rutas" ADD COLUMN     "fecha_entrega" DATE,
ADD COLUMN     "plantilla_id" BIGINT;

-- AlterTable
ALTER TABLE "ubicaciones" ADD COLUMN     "empresa_cliente_id" BIGINT,
ADD COLUMN     "entrega_en_ubicacion_id" BIGINT;

-- CreateTable
CREATE TABLE "empresas_clientes" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoEmpresaCliente" NOT NULL,
    "dias_credito_carne" INTEGER NOT NULL DEFAULT 0,
    "dias_credito_desechables" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresas_clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_operativos" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "empresa_cliente_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "linea_operacion" "LineaOperacion" NOT NULL,
    "fecha_entrega" DATE NOT NULL,
    "estado" "EstadoPedidoOperativo" NOT NULL DEFAULT 'borrador',
    "capturado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmado_at" TIMESTAMPTZ(6),
    "notas" TEXT,

    CONSTRAINT "pedidos_operativos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_operativo_lineas" (
    "id" BIGSERIAL NOT NULL,
    "pedido_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precio_unitario" DECIMAL(12,4),
    "notas" TEXT,

    CONSTRAINT "pedido_operativo_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantillas_ruta" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "linea_operacion" "LineaOperacion" NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "conductor" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plantillas_ruta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plantilla_ruta_paradas" (
    "plantilla_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "orden" INTEGER NOT NULL,
    "opcional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plantilla_ruta_paradas_pkey" PRIMARY KEY ("plantilla_id","ubicacion_id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compras" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "proveedor_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "vence_at" DATE NOT NULL,
    "referencia" TEXT,
    "total" DECIMAL(12,2) NOT NULL,
    "estado" "EstadoCompra" NOT NULL DEFAULT 'pendiente',
    "registrado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagado_at" TIMESTAMPTZ(6),

    CONSTRAINT "compras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compra_lineas" (
    "id" BIGSERIAL NOT NULL,
    "compra_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "cajas" DECIMAL(12,3) NOT NULL,
    "peso_total_lb" DECIMAL(12,3) NOT NULL,
    "costo_total" DECIMAL(12,2) NOT NULL,
    "congelado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "compra_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lotes_materia_prima" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "compra_linea_id" BIGINT,
    "fecha" DATE NOT NULL,
    "congelado" BOOLEAN NOT NULL DEFAULT false,
    "cajas_iniciales" DECIMAL(12,3) NOT NULL,
    "cajas_disponibles" DECIMAL(12,3) NOT NULL,
    "peso_inicial_lb" DECIMAL(12,3) NOT NULL,
    "peso_disponible_lb" DECIMAL(12,3) NOT NULL,
    "costo_inicial" DECIMAL(12,2) NOT NULL,
    "costo_disponible" DECIMAL(12,2) NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lotes_materia_prima_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "producciones" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "materia_prima_id" BIGINT NOT NULL,
    "fecha" DATE NOT NULL,
    "cajas_materia_prima" DECIMAL(12,3) NOT NULL,
    "peso_entrada_lb" DECIMAL(12,3) NOT NULL,
    "costo_entrada" DECIMAL(12,2) NOT NULL,
    "peso_salida_lb" DECIMAL(12,3) NOT NULL,
    "desperdicio_lb" DECIMAL(12,3) NOT NULL,
    "yield_porcentaje" DECIMAL(8,4) NOT NULL,
    "registrado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notas" TEXT,

    CONSTRAINT "producciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produccion_consumos_lote" (
    "produccion_id" BIGINT NOT NULL,
    "lote_id" BIGINT NOT NULL,
    "cajas" DECIMAL(12,3) NOT NULL,
    "peso_lb" DECIMAL(12,3) NOT NULL,
    "costo" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "produccion_consumos_lote_pkey" PRIMARY KEY ("produccion_id","lote_id")
);

-- CreateTable
CREATE TABLE "produccion_salidas" (
    "id" BIGSERIAL NOT NULL,
    "produccion_id" BIGINT NOT NULL,
    "product_id" BIGINT NOT NULL,
    "cajas" DECIMAL(12,3) NOT NULL,
    "peso_caja_lb" DECIMAL(12,3) NOT NULL,
    "peso_total_lb" DECIMAL(12,3) NOT NULL,
    "costo_total" DECIMAL(12,2) NOT NULL,
    "costo_caja" DECIMAL(12,4) NOT NULL,
    "precio_venta_caja" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "produccion_salidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semanas_operativas" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "anio" INTEGER NOT NULL,
    "semana" INTEGER NOT NULL,
    "inicia_at" DATE NOT NULL,
    "termina_at" DATE NOT NULL,
    "estado" "EstadoSemana" NOT NULL DEFAULT 'abierta',
    "cerrado_por" BIGINT,
    "cerrado_at" TIMESTAMPTZ(6),
    "valor_carne" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valor_congelado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valor_desechables" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cuentas_por_cobrar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cuentas_por_pagar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balance_neto" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "semanas_operativas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facturas" (
    "id" BIGSERIAL NOT NULL,
    "negocio_id" BIGINT NOT NULL,
    "semana_id" BIGINT NOT NULL,
    "empresa_cliente_id" BIGINT NOT NULL,
    "ubicacion_id" BIGINT NOT NULL,
    "linea_operacion" "LineaOperacion" NOT NULL,
    "numero" TEXT NOT NULL,
    "emitida_at" DATE NOT NULL,
    "vence_at" DATE NOT NULL,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'borrador',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reemplaza_factura_id" BIGINT,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factura_lineas" (
    "id" BIGSERIAL NOT NULL,
    "factura_id" BIGINT NOT NULL,
    "product_id" BIGINT,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precio_unitario" DECIMAL(12,4) NOT NULL,
    "importe" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "factura_lineas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos_cliente" (
    "id" BIGSERIAL NOT NULL,
    "factura_id" BIGINT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "pagado_at" DATE NOT NULL,
    "registrado_por" BIGINT NOT NULL,
    "creado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "empresas_clientes_negocio_id_idx" ON "empresas_clientes"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_clientes_negocio_id_codigo_key" ON "empresas_clientes"("negocio_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_clientes_negocio_id_nombre_key" ON "empresas_clientes"("negocio_id", "nombre");

-- CreateIndex
CREATE INDEX "pedidos_operativos_negocio_id_fecha_entrega_idx" ON "pedidos_operativos"("negocio_id", "fecha_entrega");

-- CreateIndex
CREATE INDEX "pedidos_operativos_empresa_cliente_id_idx" ON "pedidos_operativos"("empresa_cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_operativos_ubicacion_id_linea_operacion_fecha_entre_key" ON "pedidos_operativos"("ubicacion_id", "linea_operacion", "fecha_entrega");

-- CreateIndex
CREATE INDEX "pedido_operativo_lineas_product_id_idx" ON "pedido_operativo_lineas"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_operativo_lineas_pedido_id_product_id_key" ON "pedido_operativo_lineas"("pedido_id", "product_id");

-- CreateIndex
CREATE INDEX "plantillas_ruta_negocio_id_linea_operacion_dia_semana_idx" ON "plantillas_ruta"("negocio_id", "linea_operacion", "dia_semana");

-- CreateIndex
CREATE UNIQUE INDEX "plantillas_ruta_negocio_id_codigo_key" ON "plantillas_ruta"("negocio_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "plantilla_ruta_paradas_plantilla_id_orden_key" ON "plantilla_ruta_paradas"("plantilla_id", "orden");

-- CreateIndex
CREATE INDEX "proveedores_negocio_id_idx" ON "proveedores"("negocio_id");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_negocio_id_nombre_key" ON "proveedores"("negocio_id", "nombre");

-- CreateIndex
CREATE INDEX "compras_negocio_id_fecha_idx" ON "compras"("negocio_id", "fecha");

-- CreateIndex
CREATE INDEX "compras_proveedor_id_estado_idx" ON "compras"("proveedor_id", "estado");

-- CreateIndex
CREATE INDEX "compra_lineas_product_id_idx" ON "compra_lineas"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_materia_prima_compra_linea_id_key" ON "lotes_materia_prima"("compra_linea_id");

-- CreateIndex
CREATE INDEX "lotes_materia_prima_negocio_id_product_id_congelado_idx" ON "lotes_materia_prima"("negocio_id", "product_id", "congelado");

-- CreateIndex
CREATE INDEX "lotes_materia_prima_ubicacion_id_fecha_idx" ON "lotes_materia_prima"("ubicacion_id", "fecha");

-- CreateIndex
CREATE INDEX "producciones_negocio_id_fecha_idx" ON "producciones"("negocio_id", "fecha");

-- CreateIndex
CREATE INDEX "producciones_materia_prima_id_idx" ON "producciones"("materia_prima_id");

-- CreateIndex
CREATE INDEX "produccion_consumos_lote_lote_id_idx" ON "produccion_consumos_lote"("lote_id");

-- CreateIndex
CREATE INDEX "produccion_salidas_product_id_idx" ON "produccion_salidas"("product_id");

-- CreateIndex
CREATE INDEX "semanas_operativas_negocio_id_termina_at_idx" ON "semanas_operativas"("negocio_id", "termina_at");

-- CreateIndex
CREATE UNIQUE INDEX "semanas_operativas_negocio_id_anio_semana_key" ON "semanas_operativas"("negocio_id", "anio", "semana");

-- CreateIndex
CREATE INDEX "facturas_empresa_cliente_id_estado_idx" ON "facturas"("empresa_cliente_id", "estado");

-- CreateIndex
CREATE INDEX "facturas_semana_id_idx" ON "facturas"("semana_id");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_negocio_id_numero_version_key" ON "facturas"("negocio_id", "numero", "version");

-- CreateIndex
CREATE INDEX "factura_lineas_factura_id_idx" ON "factura_lineas"("factura_id");

-- CreateIndex
CREATE INDEX "pagos_cliente_factura_id_idx" ON "pagos_cliente"("factura_id");

-- CreateIndex
CREATE INDEX "ubicaciones_empresa_cliente_id_idx" ON "ubicaciones"("empresa_cliente_id");

-- AddForeignKey
ALTER TABLE "ubicaciones" ADD CONSTRAINT "ubicaciones_empresa_cliente_id_fkey" FOREIGN KEY ("empresa_cliente_id") REFERENCES "empresas_clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ubicaciones" ADD CONSTRAINT "ubicaciones_entrega_en_ubicacion_id_fkey" FOREIGN KEY ("entrega_en_ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresas_clientes" ADD CONSTRAINT "empresas_clientes_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribuciones" ADD CONSTRAINT "distribuciones_semana_id_fkey" FOREIGN KEY ("semana_id") REFERENCES "semanas_operativas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribucion_lineas" ADD CONSTRAINT "distribucion_lineas_pedido_linea_id_fkey" FOREIGN KEY ("pedido_linea_id") REFERENCES "pedido_operativo_lineas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rutas" ADD CONSTRAINT "rutas_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_ruta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_operativos" ADD CONSTRAINT "pedidos_operativos_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_operativos" ADD CONSTRAINT "pedidos_operativos_empresa_cliente_id_fkey" FOREIGN KEY ("empresa_cliente_id") REFERENCES "empresas_clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_operativos" ADD CONSTRAINT "pedidos_operativos_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_operativo_lineas" ADD CONSTRAINT "pedido_operativo_lineas_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos_operativos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_operativo_lineas" ADD CONSTRAINT "pedido_operativo_lineas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantillas_ruta" ADD CONSTRAINT "plantillas_ruta_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_ruta_paradas" ADD CONSTRAINT "plantilla_ruta_paradas_plantilla_id_fkey" FOREIGN KEY ("plantilla_id") REFERENCES "plantillas_ruta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plantilla_ruta_paradas" ADD CONSTRAINT "plantilla_ruta_paradas_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_proveedor_id_fkey" FOREIGN KEY ("proveedor_id") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compras" ADD CONSTRAINT "compras_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra_lineas" ADD CONSTRAINT "compra_lineas_compra_id_fkey" FOREIGN KEY ("compra_id") REFERENCES "compras"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compra_lineas" ADD CONSTRAINT "compra_lineas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes_materia_prima" ADD CONSTRAINT "lotes_materia_prima_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes_materia_prima" ADD CONSTRAINT "lotes_materia_prima_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lotes_materia_prima" ADD CONSTRAINT "lotes_materia_prima_compra_linea_id_fkey" FOREIGN KEY ("compra_linea_id") REFERENCES "compra_lineas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "producciones" ADD CONSTRAINT "producciones_materia_prima_id_fkey" FOREIGN KEY ("materia_prima_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produccion_consumos_lote" ADD CONSTRAINT "produccion_consumos_lote_produccion_id_fkey" FOREIGN KEY ("produccion_id") REFERENCES "producciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produccion_consumos_lote" ADD CONSTRAINT "produccion_consumos_lote_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_materia_prima"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produccion_salidas" ADD CONSTRAINT "produccion_salidas_produccion_id_fkey" FOREIGN KEY ("produccion_id") REFERENCES "producciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produccion_salidas" ADD CONSTRAINT "produccion_salidas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semanas_operativas" ADD CONSTRAINT "semanas_operativas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_semana_id_fkey" FOREIGN KEY ("semana_id") REFERENCES "semanas_operativas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_empresa_cliente_id_fkey" FOREIGN KEY ("empresa_cliente_id") REFERENCES "empresas_clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_ubicacion_id_fkey" FOREIGN KEY ("ubicacion_id") REFERENCES "ubicaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_reemplaza_factura_id_fkey" FOREIGN KEY ("reemplaza_factura_id") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_lineas" ADD CONSTRAINT "factura_lineas_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_lineas" ADD CONSTRAINT "factura_lineas_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_cliente" ADD CONSTRAINT "pagos_cliente_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "facturas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
