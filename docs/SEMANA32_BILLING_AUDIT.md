# Auditoría de Billing — Semana 32

Fuente revisada: `4. Billing 2026 3Q-10.xlsx`, hoja `Billing (32)`.

## Reconciliación interna de la hoja

La hoja tiene 23 bloques visibles de restaurantes y un bloque separado de
inventario. Los totales de los restaurantes visibles son:

| Concepto | Total |
| --- | ---: |
| Unidades facturadas | 660.5 |
| Carne | 76,099.985 |
| Markup Excel | 6,605.00 |
| Paperware | 13,821.27 |
| Total restaurantes | 96,526.255 |

Cada bloque visible cumple `EXTENDED AMOUNT = MEAT + MARKUP + PAPERWARE`.
No hay errores de fórmula almacenados en el archivo.

## Milanesa

- Precio en Billing 32: **$142.13**.
- Inventario inicial versionado para semana 32: 39 cajas a $142.13.
- No debe exigirse producción semanal si la venta sale de ese inventario.
- Con el markup de la aplicación, el precio operativo sería $157.13 si la regla
  vigente es costo + $15.

El sistema ya fue corregido para usar el costo de inventario vivo únicamente en
semanas abiertas sin producción y conservar el snapshot histórico en semanas
cerradas.

## Costos que pueden diferir por FIFO

Los valores de la columna `COST PER CASE` no deben compararse como igualdad exacta
contra el costo manual del catálogo. En semana 32 aparecen, entre otros:

| Producto | Billing 32 |
| --- | ---: |
| Steak Taco | 186.84 |
| Chicken | 36.03 |
| Al Pastor | 51.27 |
| Carne Asada | 235.41 |
| Fajitas | 235.41 |
| Milanesa | 142.13 |
| Tapatíos Taco Meat | 113.92 |

Las diferencias frente a costos anteriores pueden ser correctas si corresponden a
consumo FIFO y al costo ponderado de la producción de la semana.

## Diferencia importante de reglas de precio

El Excel aplica la fórmula `SUM(cantidades de filas 3:13) * 10` en la fila
`MARKUP`. Eso significa $10 por unidad de las filas principales, incluyendo
productos de precio fijo.

La aplicación actual aplica la regla documentada de **$15 sólo a productos
`proteina`** y no añade markup a productos de precio fijo. Por ello, el total de la
app no necesariamente coincidirá con el total Excel aunque las cantidades sean
correctas. Esta diferencia debe confirmarse como regla comercial antes de
modificarla.

## Sucursales y duplicidad

- Los bloques duplicados de Crystal Lake, Lake Zurich, Frankfort y Plainfield en
  columnas posteriores están ocultos; no forman parte del total visible.
- En los bloques visibles sólo Crystal Lake tiene paperware en esta hoja; los
  demás bloques nuevos aparecen sin cantidad.
- No se detectó duplicación aritmética dentro de los bloques visibles.

## Validación contra producción

La conexión PostgreSQL proporcionada vuelve a responder `password authentication
failed`. El servicio remoto está vivo, pero no es posible consultar pedidos,
producción, inventario, FIFO o facturas sin una credencial vigente.

La validación final contra producción debe comparar por producto y sucursal:

1. cantidad de pedidos confirmados;
2. cantidad facturable después de despachos parciales;
3. precio persistido en factura;
4. costo FIFO/producción o costo de inventario inicial;
5. total por restaurante y línea.
