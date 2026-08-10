# Auditoría de exportaciones Excel · Semana 32

Fecha: 2026-08-10  
Fuente contable: semana operativa 32 persistida en el sistema de Burrito Parrilla Mexicana.

## Hallazgo

El libro `4. Billing 2026 3Q.xlsx` descargado antes del ajuste recalculaba una
semana abierta con existencias y cartera vivas. Eso mezclaba el alcance del
preview operativo con la fotografía contable corregida de la semana 32.

El archivo mostraba:

| Concepto | Exportación anterior | Sistema |
| --- | ---: | ---: |
| Inventario carne | $103,911.93 | $59,783.06 |
| Inventario desechables | $239,078.93 | $251,270.58 |
| Por cobrar | $429,934.90 | $258,175.36 |
| Por pagar | $153,390.59 | $73,468.41 |
| Balance | $619,535.17 | $495,760.59 |

La discrepancia no era de FIFO en precios de venta. Era de alcance de la
fotografía financiera.

## Corrección aplicada

- Cuando una semana abierta ya tiene un saldo operativo persistido, Billing y
  Production usan los mismos valores de inventario que el sistema.
- Billing conserva el saldo de cartera persistido. Si no existe un desglose de
  facturas con el mismo alcance, lo presenta en una sola línea identificada como
  `CARTERA · SALDO REGISTRADO`.
- Billing conserva el saldo de cuentas por pagar persistido. Si el detalle vivo
  de proveedores no reconcilia con ese saldo, presenta una línea consolidada
  identificada como `CUENTAS POR PAGAR · SALDO REGISTRADO`.
- Las órdenes mixtas de carne que llevan consumibles (por ejemplo, guantes XL)
  ya no bloquean `Weekly Order`; los consumibles permanecen en `Disposables`.

## Verificación de los seis libros

La semana 32 se generó correctamente para:

1. Weekly Order
2. Disposables
3. Production
4. Billing
5. LBT
6. Taquería Aurora

La validación de cantidades pasó para todos los libros. Billing quedó con
`BW18 = $495,760.59` y Production con `AO25 = $59,783.06`, ambos iguales al
saldo persistido de la semana 32.

## Alcance

La corrección no cambia pedidos, FIFO, facturación, inventario ni reglas de
operación. Sólo hace que los libros descargables respeten la misma fuente
contable que ya muestra el sistema y evita que un consumible mezclado se
interprete como producto de carne.
