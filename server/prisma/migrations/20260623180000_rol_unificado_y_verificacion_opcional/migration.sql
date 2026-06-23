-- Rol unificado "Bodega y reparto": se elimina 'repartidor' del enum (sus filas pasan a
-- encargado_bodega). Setting de operación: verificación de carga opcional.

-- 1) Reasigna cualquier usuario con el rol que va a desaparecer.
UPDATE "usuarios" SET "rol" = 'encargado_bodega' WHERE "rol" = 'repartidor';

-- 2) Recrea el enum sin 'repartidor'.
ALTER TABLE "usuarios" ALTER COLUMN "rol" DROP DEFAULT;
CREATE TYPE "RolUsuario_new" AS ENUM ('admin', 'encargado_bodega', 'encargado_sucursal');
ALTER TABLE "usuarios" ALTER COLUMN "rol" TYPE "RolUsuario_new" USING ("rol"::text::"RolUsuario_new");
ALTER TYPE "RolUsuario" RENAME TO "RolUsuario_old";
ALTER TYPE "RolUsuario_new" RENAME TO "RolUsuario";
DROP TYPE "RolUsuario_old";
ALTER TABLE "usuarios" ALTER COLUMN "rol" SET DEFAULT 'encargado_sucursal';

-- 3) Setting de organización para la verificación opcional de carga.
ALTER TABLE "negocios" ADD COLUMN "verificacion_carga" BOOLEAN NOT NULL DEFAULT false;
