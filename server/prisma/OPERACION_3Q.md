# Activación de operación 3Q 2026

Coolify ejecuta automáticamente `prisma migrate deploy`, el seed base, el bootstrap operativo y la carga histórica 3Q antes de iniciar la API. Los bootstraps solo crean o completan datos faltantes: no restablecen rutas, precios, pesos ni calendarios modificados por el admin.

1. Respaldar la base de datos.
2. Hacer deploy; el contenedor aplica la migración y carga datos maestros automáticamente.
3. Confirmar en los logs `Semanas 27 y 28, semana 29, inventarios, cuentas por cobrar y cuentas por pagar importados`.
4. En despliegues posteriores se mostrará `Importación ... ya aplicada`; eso confirma que no se restableció el histórico.

Los seis libros auditados están versionados en `server/prisma/data/3q`. Para revisar otra copia sin escribir se puede definir `BPM_EXCEL_DIR` y ejecutar `npm run import:excel:3q`.

El importador se ejecuta automáticamente una sola vez por base de datos y deja una marca en `importaciones_sistema`. Importa semanas 27 y 28 como históricas cerradas, semana 29 como abierta, inventario final y reservas de semana 28, saldos pendientes de Billing 26–28 y las cuentas abiertas de proveedores. Si un arranque falla antes de crear la marca, Coolify puede reintentarlo de forma segura.

El backfill `excel-3q-2026-meat-supplies-v5` recupera también los seis consumibles incluidos dentro de la hoja de carne de Tapatíos (foil, contenedores, papel térmico y Coco López). Viajan en la ruta de carne, pero conservan inventario de Bodega Adison y facturación de desechables.

Las cajas compradas de materia prima conservan su peso promedio real (por ejemplo Chicken Breast `40 lb/caja comprada`). Las cajas terminadas están normalizadas a `20 lb`, excepto Carne Asada y Fajitas de `10 lb`. El admin puede revisar ambos valores por separado en Configuración → Productos → Operación semanal y facturación.
