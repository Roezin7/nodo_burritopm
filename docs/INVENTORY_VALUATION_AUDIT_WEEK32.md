# Auditoría de valuación de inventario · Semana 32

Fecha de revisión: 2026-08-11

## Hallazgo principal

La semana 32 tenía filas históricas de `inventario_semanal` sin `costo_promedio`, especialmente en Bodega Adison (`BOD`). Algunas pantallas calculaban el valor exclusivamente como `cantidad × costo_promedio` de la fila. Por eso el inventario de desechables aparecía subvaluado en `$34,921.62` aunque el valor reconstruible era `$239,078.93`.

La regla oficial queda centralizada en `server/src/inventario/valuacion.ts`:

1. costo guardado en la fila de existencia o fotografía;
2. costo promedio del producto;
3. último costo del producto;
4. cero sólo cuando no existe ninguna fuente de costo.

El costo del hold/tránsito conserva su propio costo cuando existe; si no, usa el mismo respaldo.

## Resultado verificado en producción

Para la semana 32, después de completar las filas históricas faltantes:

| Concepto | Valor |
| --- | ---: |
| Carnicería (`CARN`) | `$104,700.98` |
| Bodega Adison (`BOD`) | `$239,078.93` |
| Inventario operativo de ambas bodegas | `$343,779.91` |
| Cuentas por cobrar | `$259,644.31` |
| Cuentas por pagar | `$153,390.59` |
| Balance neto persistido | `$450,033.63` |

La suma de todas las ubicaciones de la fotografía es mayor porque incluye existencias de sucursales. La pantalla de inventario operativo debe mostrar sólo las dos bodegas.

## Superficies revisadas

- `/existencias` y `/existencias/valuacion` ahora aplican la misma regla de respaldo.
- Inventario operativo elimina el filtro ambiguo `Todo / Carne / Desechables`: la bodega seleccionada define la línea.
- Inventario operativo muestra Carnicería, Bodega Adison y el total de ambas bodegas.
- Cierre contable y creación de `inventario_semanal` guardan un costo utilizable para futuras fotografías.
- Dashboard general y detalle de ubicaciones incluyen disponible y tránsito con el mismo costo.
- Exportación Excel de Production y Billing ya no convierte filas sin costo propio en valor cero.
- Cálculo de precios semanales para proteínas conserva costos de inventario anterior aun cuando no hubo producción.

## Verificación técnica

- `npm test`: 12 archivos, 83 pruebas aprobadas.
- `npm run build`: typecheck del cliente, build del cliente y TypeScript del servidor aprobados.
- El paquete raíz no define un script `lint`; no se ejecutó un lint raíz inexistente.

## Regla de mantenimiento

No agregar otra fórmula local de valuación. Toda nueva vista, exportación o cierre debe utilizar `costoParaValuacionInventario` o `valorExistencia` y debe tener una prueba que cubra una fila con costo nulo.
