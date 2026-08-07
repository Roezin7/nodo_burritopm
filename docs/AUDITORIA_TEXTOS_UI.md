# Auditoría de textos de la interfaz

Fecha: 7 de agosto de 2026

## Criterio

La interfaz debe ayudar a decidir y ejecutar. El texto visible debe:

- nombrar la acción o el estado;
- explicar solo lo necesario para evitar un error;
- dejar el detalle operativo en la pantalla donde se usa;
- evitar repetir lo que ya muestran la sección, la tabla o el estado.

## Cambios aplicados

| Zona | Antes | Ahora | Motivo |
| --- | --- | --- | --- |
| Inicio | “Primero atiende lo pendiente. La semana conserva el contexto completo de la operación.” | “Atiende lo pendiente.” | El botón y el panorama ya indican dónde continuar. |
| Inicio | Descripciones largas de módulos | Descripciones de 2–4 palabras | El título identifica la función; el texto solo la diferencia. |
| Semana | Explicación extensa del comportamiento de inventario y despacho | “Captura pedidos; el despacho se vincula automáticamente.” | Se conserva la regla útil y se elimina la explicación interna. |
| Semana histórica | Explicación de conservación de registros | “Semana anterior. Solo consulta.” | Estado corto y accionable. |
| Entregas | “Salidas de la semana por día y línea.” | “Salidas de la semana.” | El tablero ya muestra día y línea. |
| Pedidos | Explicación del guardado automático | “Captura cantidades.” | El estado de guardado permanece visible. |
| Revisión | Explicación del despacho automático | “Al confirmar, el pedido queda registrado.” | Evita prometer un flujo que el usuario no necesita entender aquí. |
| Inventario | Instrucciones de varias frases | Instrucciones de una línea | Reduce ruido sin cambiar las acciones. |

## Texto que se conserva deliberadamente

No se eliminaron estados, advertencias ni etiquetas que evitan errores:

- semana cerrada;
- pedido ya procesado;
- corrección vinculada;
- ruta excepcional;
- faltantes;
- inventario en tránsito;
- confirmación de cierre.

Estos textos son operativos, no decorativos: describen una condición que cambia la decisión del usuario.

## Fuera de alcance

- No se cambió lógica de pedidos, despachos, rutas, inventario o cierre.
- No se eliminaron rutas antiguas de backend ni compatibilidad de navegación.
- No se modificaron mensajes técnicos de API ni documentación histórica.
- No se sustituyeron los términos Carne, Desechables, Pedidos, Entregas, Compras, Producción o Cierre: son nombres del proceso real.

## Siguiente revisión

Después de una semana de uso, revisar únicamente textos que:

1. se repitan en dos lugares sin aportar contexto distinto;
2. obliguen a leer antes de encontrar la acción;
3. usen un término distinto al que usa la operación;
4. describan una función que ya no existe.

