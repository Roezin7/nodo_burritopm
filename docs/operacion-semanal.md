# Cadencia semanal de producción y operación

Este documento describe la operación vigente que la interfaz debe comunicar. No define reglas nuevas.

## Lunes a sábado: operación diaria

1. Las sucursales ingresan ventas/pedidos.
2. Producción consulta la demanda acumulada.
3. Se preparan e imprimen los documentos de entrega.
4. La entrega sale directamente de producción al restaurante.
5. No se registra producción durante estos días. Por ello, el inventario puede mostrarse negativo de forma provisional y no representa por sí solo una excepción.

## Sábado: regularización y cierre

1. Se registran las compras de la semana.
2. Se registra la producción.
3. Se concilian ventas, compras, producción e inventario.
4. Las diferencias se observan y auditan antes del cierre.
5. Un faltante de inventario se conserva como observación de la semana, pero la siguiente semana inicia ese faltante en cero. No se modifica retroactivamente la operación.

## Principios de interfaz

- La navegación separa **Operación diaria** de **Regularización del sábado**; no las presenta como una secuencia lineal.
- El inventario negativo de lunes a viernes se explica como provisional, no como error.
- Cada pantalla mantiene una acción principal y conserva las rutas, permisos, estados y cálculos existentes.
- Las excepciones se muestran en el momento en que requieren una decisión, con acceso al registro que las originó.
- Toda vista interna conserva una salida visible hacia la semana o el nivel anterior.
