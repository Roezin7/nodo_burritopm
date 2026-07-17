# Activación de operación 3Q 2026

Coolify ejecuta automáticamente `prisma migrate deploy`, el seed base y el bootstrap operativo antes de iniciar la API. Los bootstraps solo crean o completan datos faltantes: no restablecen rutas, precios, pesos ni calendarios modificados por el admin.

1. Respaldar la base de datos.
2. Hacer deploy; el contenedor aplica la migración y carga datos maestros automáticamente.
3. Revisar el Excel sin escribir: `npm run import:excel:3q`.
4. Si el resumen es correcto, importar: `APPLY_EXCEL_IMPORT=1 npm run import:excel:3q`.

El directorio predeterminado de los seis libros es `/Users/arturohernandez/Downloads/burritopmgroup`. En otro entorno se define con `BPM_EXCEL_DIR`.

El importador histórico es idempotente, pero se ejecuta manualmente porque lee los seis Excel externos al contenedor. Importa semanas 27 y 28 como históricas cerradas, semana 29 como abierta, inventario final de semana 28 y únicamente los saldos pendientes (no el historial completo de pagos). La carga inicial fue aplicada el 17 de julio de 2026.

Los valores iniciales inferidos que deben confirmarse antes del primer batch real son Chicken `40 lb/caja`, ambos Al Pastor `20 lb/caja` y Milanesa `20 lb/caja`. El admin puede cambiarlos en Configuración → Productos → Operación semanal y facturación.
