# Auditoría Semana 32 — Producción vs. Billing externo

Fecha de revisión: 2026-08-10  
Fuente operativa: PostgreSQL de producción, base `postgres`, semana operativa 32 (`id=35`)  
Fuente externa: `4. Billing 2026 3Q-10.xlsx`, hoja `Billing (32)`

La consulta a producción fue de solo lectura. No se modificaron pedidos, costos,
inventarios, despachos ni facturas.

## 1. Estado de la semana

La semana 32 corresponde al periodo **2026-08-02 a 2026-08-08** y permanece
abierta.

| Día | Línea | Pedidos | Sucursales | Unidades | Estado observado |
|---|---|---:|---:|---:|---|
| Lunes 03 | Carne | 3 | 3 | 50.000 | Entregado |
| Miércoles 05 | Carne | 13 | 13 | 289.000 | Entregado |
| Miércoles 05 | Desechables | 12 | 12 | 393.000 | Entregado |
| Jueves 06 | Carne | 3 | 3 | 50.000 | Entregado |
| Sábado 08 | Carne | 14 | 14 | 301.500 | Entregado |
| **Total** | **Carne** | **33** | — | **690.500** | — |
| **Total** | **Desechables** | **12** | — | **393.000** | — |

Se encontraron ocho preparaciones de despacho para esos días: lunes carne,
miércoles carne en dos preparaciones, miércoles desechables, jueves carne y
sábado carne en tres preparaciones. Todas aparecen cerradas.

Observación de integridad: las ocho filas de `distribuciones` tienen
`semana_id` en `NULL`, aunque sus fechas pertenecen a la semana 32. No impide
que los despachos existan, pero debilita consultas y auditorías que filtren por
`semana_id`.

No existen facturas persistidas todavía para la semana 32; esto es consistente
con que la semana sigue abierta.

## 2. Producción y costos

La semana tiene cinco registros de producción y salidas para siete proteínas:

| Producto | Cajas producidas |
|---|---:|
| Steak Taco | 253.000 |
| Chicken | 121.000 |
| Al Pastor BPM | 131.000 |
| Al Pastor Tapatíos | 29.000 |
| Carne Asada | 33.000 |
| Fajitas | 20.500 |
| Tapatíos Taco Meat | 38.000 |

**Milanesa no tiene producción en la semana 32**, pero sí tiene inventario vivo
en Carnicería:

- cantidad disponible: `27.000` cajas;
- costo promedio: `$142.1300`;
- pedidos de la semana: `11.000` cajas;
- producción de la semana: `0` cajas.

Por lo tanto, el precio esperado por la regla actual de NOD3 es:

```text
$142.13 de inventario + $15.00 de markup = $157.13 por caja
```

Las líneas de pedido existentes para Milanesa todavía tienen
`precio_unitario = NULL`. Eso no debe corregirse inventando una producción:
al cerrar la semana, el cálculo debe tomar el costo de inventario vivo mientras
la semana siga abierta. La aplicación desplegada debe incluir el fallback de
inventario para que el cierre no vuelva a exigir producción de Milanesa.

No se detectó otra proteína pedida sin producción semanal.

## 3. Comparación de cantidades contra `Billing (32)`

Se compararon los productos facturables del Excel con los pedidos de producción,
normalizando nombres de sucursal y agrupando Al Pastor BPM/Tapatíos según la
sucursal correspondiente.

La suma de productos mapeables es:

| Fuente | Unidades |
|---|---:|
| PostgreSQL producción | 661.500 |
| `Billing (32)` | 660.500 |
| Diferencia neta | **+1.000 en producción** |

Diferencias puntuales:

| Sucursal | Producto | Producción | Excel | Diferencia |
|---|---|---:|---:|---:|
| Glendale Heights | Chicken | 9 | 8 | **+1** |
| LBT Streamwood | Tapatíos Taco Meat | 25 | 26 | **-1** |
| West Chicago | Fajitas | 1 | 0 | **+1** |

Además, producción contiene renglones que no son filas de producto del bloque
principal del Excel: Catering (1), COCO Lopez, foil y empaques Tapatíos,
incluyendo guantes XL. Deben mantenerse como consumibles/cargos de la línea
correspondiente, no desaparecer silenciosamente del cierre.

## 4. Comparación de precios

El Excel utiliza una columna `COST PER CASE` y agrega un markup global de `$10`
por unidad en su fila `MARKUP`, incluso para productos de precio fijo. La
aplicación utiliza FIFO/costo semanal para proteínas y `$15` de markup, mientras
que los productos de precio fijo conservan su precio fijo.

Por ello, una diferencia de precio no es automáticamente un error. Ejemplos de
precios finales registrados en pedidos de producción:

| Producto | Precio pedido en producción | Base Excel | Regla Excel visible |
|---|---:|---:|---:|
| Steak Taco | 178.4294 | 186.84 | base + 10 |
| Chicken | 47.1653 | 36.03 | base + 10 |
| Al Pastor | 61.272x | 51.27 | base + 10 |
| Carne Asada | 250.2036 | 235.41 | base + 10 |
| Fajitas | 250.2039 | 235.41 | base + 10 |
| Tapatíos Taco Meat | 123.9208 | 113.92 | base + 10 |
| Milanesa | `NULL` | 142.13 | base + 10 |

Los precios de proteínas del sistema reflejan el costo FIFO/producción real,
por lo que deben prevalecer para el cierre operativo. El Excel no debe usarse
como fuente de costo FIFO.

## 5. Desechables

El total de desechables del Excel es `$13,821.27`.

El total de precios persistidos en los pedidos de producción es `$14,431.88`,
una diferencia de `$610.61`.

La diferencia no está concentrada en una sola sucursal. Hay señales de que el
Excel y producción no representan exactamente el mismo conjunto o versión de
pedidos:

- el Excel tiene `LBT NAPERVILLE` con `$467.26`, pero producción no tiene pedido
  de esa sucursal en la semana 32;
- producción tiene Crystal Lake y las sucursales nuevas dentro del flujo real;
- varios precios de desechables son los precios configurados actualmente en
  `products.precio_venta_fijo`, no los valores históricos del libro.

Antes de emitir billing, debe definirse cuál fuente representa la semana real:
los pedidos confirmados de producción o el Excel histórico. No se deben sumar
ambas.

## 6. Conclusiones y acciones

1. Los pedidos y despachos de producción de la semana 32 están presentes y
   coinciden en unidades agregadas: carne `690.500` y desechables `393.000`.
2. Hay tres diferencias de cantidad contra el Excel que deben confirmarse con
   Martín antes de cerrar.
3. Milanesa debe facturarse con `$157.13` por caja bajo la regla actual, usando
   el inventario vivo de Carnicería; no debe exigirse una producción ficticia.
4. El código de fallback de inventario debe estar desplegado antes de cerrar la
   semana 32. Si no lo está, el cierre seguirá mostrando el error de producción
   faltante.
5. El Excel tiene una versión de precios y/o pedidos distinta para
   desechables; no debe corregirse la base FIFO para hacerla coincidir.
6. Debe revisarse posteriormente por qué `distribuciones.semana_id` queda nulo
   en todas las preparaciones, ya que afecta la trazabilidad semanal.

## Criterio para cerrar la semana 32

Antes de emitir facturas:

- confirmar las tres diferencias de cantidades;
- confirmar que Milanesa se calcula a `$157.13`;
- verificar que el preview de cierre genera facturas separadas por sucursal y
  línea;
- revisar el total de desechables contra los pedidos confirmados de producción;
- no emitir facturas mientras existan productos con precio `NULL`.

## 7. Diferencia entre el snapshot y la vista previa del balance

La revisión de producción del 10 de agosto encontró dos resultados distintos
para la misma semana:

| Componente | Snapshot guardado en semana 32 | Vista previa observada |
|---|---:|---:|
| Inventario final | $311,053.64 | $139,622.60 |
| Por cobrar del ciclo | $258,175.36 | $250,684.14 |
| Por pagar | $73,468.41 | $191,773.68 |
| **Balance** | **$495,760.59** | **$198,533.06** |

La vista previa mostrada todavía incluía el crédito de Lisle de `$8,960.17`.
Después de eliminarlo, el por cobrar proyectado aumenta a aproximadamente
`$259,644.31`; el crédito ya no debe aparecer en la semana 32 después de que se
despliegue el commit `eb9a288`.

### Causas identificadas

1. **Inventario de desechables subvaluado en vivo.** En Bodega Adison hay 50
   renglones con `existencias.costo_promedio = NULL`. La vista previa interpreta
   esos renglones como valor cero, aunque `products.costo_promedio` sí contiene
   el costo. El valor actual de desechables es `$2,436.42`; usando el costo del
   producto como fallback sería aproximadamente `$206,593.73`.
2. **Cuentas por pagar con alcance distinto.** La vista previa suma 23 compras
   pendientes hasta el 8 de agosto (`$191,773.68`). El snapshot del reinicio
   sólo contemplaba las tres cuentas de apertura `APERTURA-W32-*` (`$73,468.41`).
   No es correcto elegir una cifra sin definir si el balance debe incluir todas
   las compras pendientes de la semana o sólo la deuda de apertura.
3. **El snapshot está obsoleto para una semana abierta.** Sus valores no se
   recalculan automáticamente al cambiar inventario, compras o créditos. Por
   eso no debe usarse como validación del preview actual sin indicar su fecha y
   alcance.

### Escenarios de referencia

Con los datos actuales, sin el crédito de Lisle:

- mantener la valoración en vivo actual: aproximadamente `$207,493`;
- usar costo de producto como fallback para los desechables y mantener todas
  las compras pendientes: aproximadamente `$380,000`;
- usar ese fallback pero conservar sólo las cuentas de apertura como CxP:
  aproximadamente `$498,000`.

La cifra esperada de `$450,000` queda entre estos escenarios. Antes de cambiar
la lógica contable se debe confirmar si el cierre debe reconocer todas las
compras pendientes o sólo las cuentas de apertura, y si la valoración de
desechables debe usar `existencias.costo_promedio` o el costo vigente del
producto como respaldo.

## 8. Cierre objetivo compartido y pagos aplicados

La imagen de cierre entregada como fuente de verdad fija estos importes de
referencia para la semana 32:

| Concepto | Importe |
|---|---:|
| Fresh meat inventory | `$100,234.15` |
| Paperware | `$239,762.41` |
| Billing 30 | `$76,885.52` |
| Billing 31 | `$89,879.84` |
| Billing 32 | `$96,526.26` |
| Inventario + facturación | `$603,288.17` |
| Cuentas abiertas | `-$153,390.61` |
| Balance objetivo | **`$449,897.56`** |

Se registraron mediante el flujo normal de pagos, sin borrar compras ni
facturas:

- Christ Panos Food: pago completo de la compra de apertura, `$3,976.00`.
- South Star Foods: pago completo de la compra de apertura, `$27,328.80`.
- Gordon Food: pago parcial de `$7,078.29`; queda saldo de `$506.57` en esa
  factura.

Después de los pagos, la cartera abierta persistida queda en `$153,390.59`:
Christ Panos `$59,275.34`, Gordon `$54,143.36`, Amigos `$39,971.89` y South
Star `$0`. La diferencia de `$0.02` contra la imagen se origina en el importe
persistido de las líneas de Amigos y debe resolverse como redondeo/fuente, no
mediante un ajuste silencioso.

## 9. Corrección desplegable de valuación

La valuación ya no convierte en cero una existencia con cantidad cuando falta
`existencias.costo_promedio`. El orden de respaldo ahora es:

1. costo específico de la existencia;
2. `products.costo_promedio`;
3. `products.ultimo_costo`;
4. cero únicamente si no existe ningún costo.

Además, las exportaciones de una semana abierta recalculan la valuación con la
información actual en lugar de reutilizar un snapshot positivo antiguo. La
corrección está en el commit `c8289a0`, con 78 pruebas y build de producción
aprobados.

La corrección no inventa cantidades ni reemplaza el inventario físico. Para
llegar exactamente al balance objetivo todavía hay que reconciliar la fuente
de cantidades de Paperware, la diferencia de `$3,647.31` entre Billing 32 FIFO
y el libro Excel, y el desfase de `$0.02` de Amigos.

## 10. Verificación posterior al despliegue

El servicio de producción respondió correctamente (`/api/health`, base de datos
conectada) y la vista previa de la semana 32 se regeneró después del commit
`c8289a0`.

| Concepto | Vista previa actual | Imagen objetivo | Diferencia |
|---|---:|---:|---:|
| Carne fresca | `$104,700.98` | `$100,234.15` | `+$4,466.83` |
| Desechables | `$239,078.93` | `$239,762.41` | `-$683.48` |
| Inventario total | `$343,779.91` | `$339,996.56` | `+$3,783.35` |
| CxC ciclo de 3 semanas | `$259,644.31` | `$263,291.62`* | `-$3,647.31` |
| CxP | `$153,390.59` | `$153,390.61` | `-$0.02` |
| **Balance estimado** | **`$450,033.63`** | **`$449,897.56`** | **`+$136.07`** |

\* La cifra de CxC objetivo se obtiene sumando Billing 30, 31 y 32 del libro
entregado. La aplicación calcula Billing 32 con FIFO y producción vigente, por
eso la diferencia de `$3,647.31` es de método/precio, no de pagos o inventario.

La corrección de costos eliminó la subvaluación severa de los desechables: la
vista previa ahora reconoce `$239,078.93` en lugar de tratar decenas de renglones
con costo nulo como valor cero. El saldo restante de `$136.07` no justifica una
alteración automática; corresponde a diferencias de fuente entre el inventario
físico/libro y el método FIFO. Debe resolverse conciliando renglón por renglón.
