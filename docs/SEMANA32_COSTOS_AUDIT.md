# Auditoría de costos — Semana 32

Fecha de revisión: 2026-08-10

## Resultado

El aviso de Milanesa es consistente con la implementación actual, pero no con la
regla operativa esperada cuando existe inventario inicial sin producción semanal.

`preciosVentaSemana` (`server/src/operacion/service.ts`) calcula el precio de una
proteína así:

1. Si tiene salidas de producción en la semana: costo ponderado por caja + $15.
2. Si no tiene producción: busca únicamente el último `inventario_semanal` de una
   semana cerrada anterior, en una ubicación tipo bodega y con cantidad positiva.
3. Si no encuentra ese snapshot: devuelve `null`.

El cierre interpreta ese `null` como falta de producción y muestra:

> Falta registrar producción semanal para calcular costo + $15.

Por tanto, el cálculo no consulta el inventario inicial de la semana objetivo ni el
costo asociado en `existencias`/movimientos de apertura. Esto explica el caso de
Milanesa si la semana 32 empezó con inventario importado pero aún no tenía un
snapshot semanal cerrado anterior que la incluyera.

## Evidencia disponible en el repositorio

El reinicio operativo de semana 32 (`server/prisma/reset-week32-from-client.ts`)
define:

- Milanesa: 39 cajas.
- Costo asociado: $142.13 por caja.
- Precio esperado de venta: $157.13 por caja (`142.13 + $15`).
- No requiere producción semanal para conservar ese costo mientras exista el
  inventario inicial.

Esta es evidencia del insumo de apertura versionado en el repositorio; no sustituye
una consulta directa a producción.

## Productos que comparten la regla

La regla se aplica a **todo producto con `tipo_operativo = 'proteina'`**, no sólo a
Milanesa. El catálogo base contiene:

- Steak Taco
- Chicken
- Al Pastor BPM
- Al Pastor Tapatíos
- Tapatíos Taco Meat
- Carne Asada
- Fajitas
- Milanesa

Los productos de precio fijo (Tamal Rojo, Chile Relleno, Taco Dorado, Adobo
Picadillo, Carnitas y Pulpa) no pasan por esta validación de producción + $15.

## Validación pendiente en producción

La conexión PostgreSQL entregada anteriormente devuelve `password authentication
failed`. El servicio de producción está vivo (`/api/health` responde `db: true`),
pero las rutas de datos requieren JWT y no existe una sesión de navegador disponible
en este entorno.

Para cerrar la auditoría se necesita una conexión de solo lectura vigente o una
sesión administrativa temporal. La consulta debe verificar, para semana 32:

- producción por producto;
- pedidos/facturas que vendieron cada proteína;
- inventario de apertura y costo asociado;
- snapshot de la semana 31;
- qué otros productos vendidos quedaron sin precio.

## Corrección aplicada en código

La implementación ahora mantiene la prioridad de costos históricos y amplía el
fallback:

1. producción semanal ponderada + $15;
2. snapshot cerrado anterior con inventario positivo;
3. costo del inventario vivo en bodega cuando la semana objetivo sigue abierta;
4. sólo si no existe evidencia de inventario, mantener `null` y bloquear la
   facturación.

Las semanas cerradas no leen costos vivos, por lo que no se reescribe una factura
histórica con un costo posterior.

Se agregó una prueba de regresión para el caso Milanesa y el conjunto de pruebas
actual pasa: 76 pruebas.
