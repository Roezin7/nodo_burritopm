# Auditoría de herencia y conciliación de inventarios

Fecha: 2026-09-15. Alcance: Carnicería (CARN/29), Bodega (BOD/1), semana 37 (6–12 de septiembre), arrastre posterior y rutas de captura/cierre. Negocio 1; fechas operativas America/Chicago.

## Resultado comprobado en producción

| Producto | Apertura | Compras | Producción recibida | Uso en producción | Despachos | Teórico final | Físico final | Diferencia física | Saldo vigente |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Taco Meat terminado (75) | 10 | 0 | 31 | 0 | 39 | 2 | 5 | +3 | 5 |
| Taco Meat Raw (70) | 2 | 10 | 0 | 10 | 0 | 2 | 2 | 0 | 2 |

No existen líneas de pedidos con materias primas/RAW en la base auditada. El terminado y la materia prima conservan IDs, compras, recetas y producción independientes.

La revisión posterior a las correcciones encontró **0 diferencias de cantidad entre ecuación operativa y existencias**, y **0 diferencias entre existencias y FIFO**, en ambos almacenes.

La referencia automática del 20 de septiembre guardaba Taco Meat en 0. El nuevo motor hereda 5 desde el físico anterior; Raw hereda 2. Bodega conserva cuatro referencias automáticas guardadas distintas de la herencia vigente: se identifican como referencias obsoletas, no se usan para sobrescribir la operación.

Esto no implica que todas las diferencias físicas estén explicadas. Además de Taco Meat +3, **Adobo Picadillo tiene teórico −16, físico 0 y diferencia +16**. No se creó producción ficticia para hacer desaparecer esa diferencia.

## Causas encontradas y cambios implementados

1. **La apertura manual solo guardaba un conteo.** No aplicaba consistentemente su efecto a existencias/FIFO. Apertura, final y conteos diarios operativos ahora usan la misma captura transaccional y ecuación. Una corrección conserva el documento y solo aplica el cambio necesario al saldo vigente.
2. **Varias fuentes calculaban la semana de forma distinta.** Inventario, conciliación y snapshot de cierre ahora comparten `inventario/conciliacion-semanal.ts`. Se usan fechas de compra, producción y despacho, no la fecha tardía de digitación. Los movimientos directos usan la zona del negocio.
3. **Las aperturas automáticas podían congelar referencias viejas.** Ahora son referencias de arranque; una vez que existe evidencia anterior, el saldo se recalcula. Aperturas manuales y físicos explícitos siguen siendo evidencia. Una apertura automática futura no regulariza por sí sola un saldo negativo.
4. **Un físico podía ocultar operaciones posteriores.** El motor reproduce apertura, operaciones y físicos en orden. Diferencia el saldo de la semana, el saldo vigente y lo ocurrido posteriormente. Cero contado no significa “sin contar”.
5. **El respaldo de FIFO durante el cierre comparaba un físico histórico contra lotes vivos.** Reponía mercancía ya despachada. Se eliminó esa creación automática; los lotes se generan al registrar la entrada/conteo real. Las diferencias FIFO bloquean el cierre y muestran producto/cantidades.
6. **La UI excluía Raw, pero la API aceptaba materias primas en pedidos.** La API rechaza materias primas y SKUs RAW tanto para admin como para restaurante; el catálogo de compras/producción conserva Raw. Conciliación lo identifica como materia prima no vendible.
7. **Respuestas GET anteriores a una captura podían volver a mostrar valores viejos.** Las mutaciones invalidan caché y solicitudes en curso; una lectura anterior a la mutación se repite. Inventario/conciliación permiten actualización fresca y protegen contra respuestas fuera de orden.
8. **Eliminar/reabrir un conteo podía retirar el ancla sin conservar su cadena.** Se impide eliminar referencias con conteos/cierres posteriores. Los conteos operativos se corrigen desde la captura semanal sin reabrir su estado por la vía antigua. Los diarios operativos usan el mismo escritor transaccional y exigen productos contados.
9. **Correcciones de capas positivas podían consumir una compra anterior.** Al corregir el mismo conteo se retiran primero sus capas de ajuste aún disponibles, conservando la compra real.
10. **Los reintentos de transacciones concurrentes eran inmediatos.** Se agregó espera exponencial breve con variación aleatoria antes de repetir la transacción completa.
11. **Una operación tardía podía cambiar el saldo pese a existir un físico posterior.** Se agregó `inventario/saldo-fisico.ts`: al crear/editar/eliminar compras o producción, corregir pedidos procesados y confirmar/eliminar despachos, se recalcula el efecto de los físicos posteriores dentro de la misma transacción. Se conserva la cantidad contada y se actualiza su diferencia, ledger y FIFO. No exige borrar el físico para editar producción. Los cierres posteriores siguen bloqueando cambios históricos.
12. **Cantidad preparada no equivale a salida física.** La conciliación solo considera distribuciones cargadas/en tránsito/entregadas/cerradas; no resta una cantidad digitada en una carga todavía sin confirmar. Raw también se rechaza al confirmar un despacho.
13. **Un saldo provisional negativo no equivale a FIFO negativo.** Contar 3 unidades desde un ledger de −2 aplica +5 al ledger, pero crea solo 3 unidades en lotes. El ajuste de cantidades físicas y el ajuste FIFO se calculan por separado y terminan en el mismo saldo disponible.

## Correcciones de datos aplicadas

### Auditoría 408: Taco Meat / Raw

Script: `server/scripts/repair-week37-taco-counts.ts`.

- Conteo 46: Raw 10 → 2; terminado 0 → 10.
- Conteo 52: Raw 5 → 2; terminado 0 → 5.
- Existencia Raw 5 → 2; terminado 0 → 5, con movimientos de corrección vinculados al conteo.
- Se neutralizó la capa de ajuste Raw 503 (3 cajas). Se conservan el lote y su historial; su disponibilidad es cero.
- El lote de compra Raw 500 quedó idéntico a su estado previo: 2 cajas y costo disponible 685.63.
- Datos anteriores y verificación posterior guardados en `auditoria_operativa` 408.

### Auditoría 409: exceso FIFO de Bodega

Script: `server/scripts/repair-week37-duplicate-fifo.ts`.

- Se regularizaron 37 productos cuyo exceso coincidía exactamente con los lotes 455–491 creados por el antiguo respaldo del conteo 45.
- No se eliminaron compras, lotes, facturas ni pagos. Las compras técnicas 69–105 no tenían pagos registrados.
- Las cantidades físicas permanecieron idénticas. La regularización se documentó como `regularizacion_fifo`, sin origen/destino ni delta físico.
- Trapos tenía 6 unidades duplicadas: 1 aún en lote 480 y 5 ya consumidas. Se retiró la restante y se neutralizaron 5 de la capa 494, ambas a costo 1 por unidad, sin modificar consumos/billing anteriores. Existencia y FIFO quedan en 27.
- Respaldo completo de las capas afectadas y filas anteriores/posteriores en auditoría 409.

Ambos scripts son de simulación por defecto, requieren `--apply`, validan el estado exacto y usan una sola transacción Serializable. Su marcador de auditoría impide aplicarlos dos veces. Reciben `DATABASE_URL` por entorno; no contienen credenciales.

## Verificación

- 114 pruebas de servidor aprobadas en PostgreSQL temporal aislado, no en producción.
- 2 pruebas de caché/lecturas asíncronas del cliente aprobadas; añadidas a CI.
- Typecheck de cliente y compilación completa cliente/servidor aprobados.
- Casos de apertura, físico final, cero, herencia automática obsoleta, compras posteriores, correcciones repetidas, Raw/terminado, diarios, restricciones de eliminación, pedidos RAW, edición de pedido con físico posterior, compra/producción tardías y ajuste FIFO desde negativo cubiertos.
- La revisión en producción se hizo por consultas de solo lectura, salvo los dos scripts explícitos de corrección. No se cerró/reabrió ninguna semana ni se registraron compras/pagos nuevos.
- QA visual pendiente: la habilidad Browser no encontró un navegador disponible. No se ejecutó una comprobación visual de la nueva tabla.

## Límites y puesta en servicio

- **Los datos fueron corregidos en producción; el nuevo código todavía requiere publicación/despliegue.** No confundir el resultado del motor local contra producción con la versión de interfaz que está desplegada.
- Los cierres ya congelados se conservan. No se recalcularon facturas históricas ni se sustituyeron saldos financieros del Excel.
- El aislamiento de cantidades históricas está implementado. La valoración de una semana abierta antigua sigue usando los costos disponibles/promedio del sistema, proyectados a su cantidad aislada: no constituye una reconstrucción histórica completa de cada capa FIFO y su estado fresco/congelado.
- No se certifica ausencia absoluta de fallos. El control de cierre detecta diferencias entre documentos, existencias y lotes en ambos almacenes y evita congelarlas silenciosamente.
- Capturas físicas posteriores son evidencia independiente: las operaciones tardías recalculan sus diferencias y conservan lo contado. Esto no autoriza eliminar una compra cuyo lote ya fue usado ni fabricar materia prima para una producción sin respaldo; esas restricciones FIFO se conservan.
- La política previa de faltantes negativos al cierre (incidencia y arrastre cero) se conserva; una diferencia física o una incidencia no debe confundirse con un error entre tablas.
