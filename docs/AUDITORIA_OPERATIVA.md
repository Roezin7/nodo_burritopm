# Auditoría operativa y prevención de errores

## Riesgos que se corrigieron

### 1. Orden duplicado de desechables

El cliente tenía una lista fija de SKU (`BPM-0001` a `BPM-0054`). Eso obligaba a editar código cada vez que el Excel agregaba, quitaba o reordenaba un producto y podía desalinear Pedidos, Entregas, impresión y copiado desde Excel.

Ahora el orden viene de `products.orden_operativo`, que es el orden maestro importado del catálogo. La lista fija permanece únicamente como respaldo para catálogos antiguos sin productos.

Regla: cualquier producto nuevo debe recibir `orden_operativo` antes de usarse en pedidos.

### 2. Fecha de cierre dependiente del servidor

Las validaciones financieras usaban una zona horaria fija. Ahora toman `negocios.zona_horaria`, evitando que el cierre o un pago se habilite un día antes/después si cambia la zona del negocio o el servidor.

### 3. Falta de revisión preventiva

Se agregó una auditoría de solo lectura que revisa semanas, cierres, fotografías de inventario, facturas, compras, catálogo, conteos, pedidos, entregas y existencias.

## Auditoría antes de cada cierre

Ejecutar desde el repositorio con la conexión de la base correspondiente:

```bash
DATABASE_URL='...' npm run audit:operacion -w server
```

Para usarla como bloqueo en un proceso de despliegue o cierre:

```bash
BPM_AUDIT_STRICT=1 DATABASE_URL='...' npm run audit:operacion -w server
```

`BPM_AUDIT_STRICT=1` termina con código 2 cuando hay hallazgos de severidad alta. La auditoría nunca modifica la base.

También puede producir JSON para guardar evidencia:

```bash
BPM_AUDIT_JSON=1 DATABASE_URL='...' npm run audit:operacion -w server > auditoria.json
```

## Qué significa cada alerta

- `alta`: detener el cierre y corregir antes de continuar. Ejemplos: facturas duplicadas vigentes, totales que no coinciden, sobrepagos, recepción mayor que carga o una semana cerrada sin fotografía.
- `media`: revisar el catálogo o la captura antes de exportar. Ejemplos: orden duplicado, compra cuyo total no coincide con sus renglones o compra con estado incorrecto.
- `baja`: observación operativa. Un negativo de existencias puede ser provisional de lunes a viernes, pero debe desaparecer o quedar explicado al cierre.

## Regla semanal protegida

Las cuentas por cobrar del balance semanal son siempre la semana actual más las dos anteriores. Las facturas más viejas permanecen visibles en Facturación, pero salen del balance móvil. No se deben “corregir” sumando una cuarta semana manualmente.

## Secuencia recomendada

1. Capturar pedidos, incluyendo desechables, sin cambiar el orden del catálogo.
2. Revisar Entregas y resolver faltantes.
3. Registrar compras y producción del sábado.
4. Ejecutar la auditoría operativa.
5. Corregir alertas altas y revisar las medias.
6. Comparar Billing/Inventory con el Excel fuente.
7. Generar vista previa y cerrar.
8. Guardar el JSON de auditoría junto con el Excel del cierre.

No se deben ejecutar scripts `reset-*`, reconciliaciones históricas o SQL directo sobre existencias/facturas sin respaldo, simulación y revisión del alcance.
