# Activación de operación 3Q 2026

La migración y el importador están separados para evitar modificar la base conectada durante desarrollo.

1. Respaldar la base de datos.
2. Aplicar la migración: `npx prisma migrate deploy`.
3. Cargar datos maestros: `npm run seed:operacion`.
4. Revisar el Excel sin escribir: `npm run import:excel:3q`.
5. Si el resumen es correcto, importar: `APPLY_EXCEL_IMPORT=1 npm run import:excel:3q`.

El directorio predeterminado de los seis libros es `/Users/arturohernandez/Downloads/burritopmgroup`. En otro entorno se define con `BPM_EXCEL_DIR`.

El proceso es idempotente: actualiza empresas, ubicaciones, catálogos, pedidos y saldos identificables sin duplicarlos. Importa semanas 27 y 28 como históricas cerradas, semana 29 como abierta, inventario final de semana 28 y únicamente los saldos pendientes (no el historial completo de pagos).

Los valores iniciales inferidos que deben confirmarse antes del primer batch real son Chicken `40 lb/caja`, ambos Al Pastor `20 lb/caja` y Milanesa `20 lb/caja`. El admin puede cambiarlos en Configuración → Productos → Operación semanal y facturación.
