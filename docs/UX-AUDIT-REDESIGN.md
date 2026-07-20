# Auditoría UX/UI y plan de rediseño de NODO

Fecha: 20 de julio de 2026
Alcance: aplicación completa, roles `admin`, `encargado_bodega` y `encargado_sucursal`
Objetivo: convertir una aplicación funcional y visualmente competente en una herramienta interna clara, rápida y confiable, con calidad de producto de una startup madura.

## 1. Resumen ejecutivo

NODO ya tiene una base mejor que la de muchas herramientas internas: el flujo del negocio está bien representado, hay separación por roles, navegación semanal, borradores locales, soporte offline, estados de negocio y una paleta reconocible. El rediseño no necesita reemplazar la lógica; necesita reorganizar la experiencia alrededor de la tarea que cada persona está tratando de completar.

Los cuatro problemas que más reducen la percepción de calidad son:

1. **La interfaz conserva demasiadas capas de navegación y contexto.** En móvil, una persona puede ver barra superior, selector de semana, stepper del flujo, título de paso, tabs de vista, selector de línea y navegación inferior antes de empezar la tarea.
2. **El responsive reduce pantallas de escritorio en vez de recomponerlas.** Hay un cambio abrupto a 821 px que rompe vistas intermedias como iPad vertical; controles importantes quedan recortados.
3. **La captura individual del restaurante es larga y poco guiada.** Abrir Productos muestra 19 artículos y extiende la página a 3,974 px, equivalentes a 4.7 pantallas de un iPhone de 844 px, antes de llegar a la confirmación.
4. **El sistema visual usa demasiado texto pequeño, bajo contraste y controles compactos.** Esto produce densidad, fragilidad y una apariencia de “panel web” más que de producto operativo profesional.

La dirección recomendada es una experiencia denominada internamente **“confianza operativa silenciosa”**: cada rol entra directo a su tarea, siempre sabe qué está guardado, qué falta y qué ocurrirá al confirmar. La sofisticación debe aparecer en el comportamiento, no en la cantidad de tarjetas, sombras o controles visibles.

## 2. Metodología de auditoría

Se revisaron:

- Login, inicio y navegación global.
- Flujo semanal: Compras, Producción, Ventas, Despacho, Inventario y Cierre.
- Facturación, Incidencias, Auditoría y Configuración.
- Experiencias de administrador, restaurante y bodega.
- Escritorio a 1440 px.
- Móvil a 390 × 844 px.
- Transición responsive a 820, 821, 834 y 1024 px.
- Build de producción, peso de recursos y carga con red/CPU móvil simuladas.
- Accesibilidad automatizada WCAG 2 AA con axe-core.
- Comportamiento de controles táctiles contra el mínimo recomendado de 44 × 44 puntos.

La auditoría se realizó sobre la aplicación ejecutada con sus datos actuales, no solamente leyendo componentes.

## 3. Qué hace que Apple, Clover y productos maduros se sientan profesionales

La limpieza no viene de usar mucho blanco o redondear tarjetas. Viene de cinco decisiones consistentes:

### 3.1 Una jerarquía obvia

Apple recomienda colocar la información esencial primero, agrupar elementos relacionados y usar divulgación progresiva para lo secundario. En NODO, la acción del día debe dominar la pantalla; la semana, el rol y las opciones avanzadas deben acompañarla sin competir con ella.

Fuente: [Apple Human Interface Guidelines — Layout](https://developer.apple.com/design/human-interface-guidelines/layout)

### 3.2 Flujos cortos y orientados a la acción

Clover diseña para comercios con ritmo rápido: pocos pasos, mensajes claros, controles grandes y solamente funciones relevantes para el contexto del comerciante. Esto aplica directamente a restaurantes y bodega.

Fuentes: [Clover — App design requirements](https://docs.clover.com/dev/docs/app-design-requirements) y [Clover — Design resources](https://docs.clover.com/dev/docs/design-resources)

### 3.3 Consistencia que reduce aprendizaje

Un control debe verse y funcionar igual en toda la aplicación. Una acción primaria por vista; secundarios visibles solamente cuando ayudan. La coherencia de estructura es más importante que decorar cada módulo de manera distinta.

Fuente: [Apple Human Interface Guidelines — Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)

### 3.4 Respuesta inmediata y contexto preservado

Apple recomienda mostrar contenido o placeholders cuanto antes, mantener los indicadores en ubicaciones consistentes y explicar los procesos largos. Un producto profesional no sustituye toda la pantalla por un spinner si puede conservar el contenido anterior o mostrar el esqueleto de la nueva vista.

Fuentes: [Apple — Loading](https://developer.apple.com/design/human-interface-guidelines/loading) y [Apple — Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)

### 3.5 Accesibilidad como parte del acabado

Apple recomienda un área táctil mínima de 44 × 44 puntos; Clover exige contraste WCAG, tipografía legible y controles generosos. El cumplimiento mejora la app para todos, especialmente para personal que trabaja de pie, con prisa, con guantes, brillo exterior o poca experiencia tecnológica.

Fuentes: [Apple — Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) y [Apple — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)

## 4. Fortalezas que deben conservarse

- La semana operativa es una unidad mental clara y coincide con el negocio.
- La navegación y permisos ya cambian por rol.
- La app protege borradores de pedidos y cambios sin guardar.
- Las mutaciones de campo críticas tienen soporte offline/idempotente.
- Los colores cálidos y el verde conectan con Burrito Parrilla.
- Las cifras usan tabulares y la información financiera tiene buena estructura de datos.
- Los estados, errores y acciones destructivas ya existen en el producto.
- La lógica compleja de compras, producción, despacho, inventario y cierre no necesita reescribirse para lograr el rediseño.

## 5. Hallazgos prioritarios

### P0 — El breakpoint de tablet oculta acciones

El cambio de layout ocurre en `820px`:

| Ancho | Navegación | Ancho real del contenido | Ancho interno de toolbar de Ventas |
| --- | --- | ---: | ---: |
| 820 px | inferior | 820 px | 769 px |
| 821 px | riel de 240 px | 581 px | 738 px |
| 834 px | riel de 240 px | 594 px | 738 px |
| 1024 px | riel de 240 px | 784 px | 738 px |

En 834 px, `Herramientas` queda parcialmente visible y `Confirmar semana` desaparece del área útil. El documento no reporta overflow porque `overflow-x: clip` lo oculta globalmente.

**Corrección de diseño:** el shell debe decidir su modo según el espacio útil del contenido, no por una suposición sobre el dispositivo. Mantener navegación compacta/drawer hasta que el contenido pueda conservar al menos 760–840 px, o usar un riel colapsado de 72 px. Las barras internas deben reordenarse antes de necesitar scroll.

### P0 — La captura individual exige demasiado recorrido

En restaurante, la pantalla actual presenta:

- Encabezado global.
- “Operación semanal / Trabajo del día”.
- Selector de semana.
- Tarjeta “1 Ventas”.
- “Paso 3 / Ventas”.
- Selector Carne/Desechables.
- Restaurante y entrega.
- Productos colapsados por defecto.
- 19 productos en una sola lista al abrirla.
- Notas.
- Resumen.
- Guardar y Confirmar al final.

La lista abierta ocupa 3,974 px, o 4.7 viewports. La navegación inferior queda flotando sobre el contenido. La acción principal solo aparece al final, y no existe una indicación fuerte de avance o de guardado automático.

**Corrección de diseño:** reemplazar la página por un flujo de captura de una sola tarea:

1. **Contexto:** restaurante, fecha y línea; precargados y editables solamente cuando corresponda.
2. **Captura:** grupos de productos, buscador persistente, “pedido habitual”, último pedido y cantidades rápidas.
3. **Revisión:** solamente productos con cantidad, notas y confirmación inequívoca.

El guardado debe ser automático como borrador; la acción persistente debe decir `Revisar pedido · N unidades` y vivir arriba de la navegación inferior. `Confirmar pedido` aparece una sola vez en la revisión.

### P0 — Accesibilidad bloqueada

La auditoría automatizada encontró dos patrones en todas las pantallas muestreadas:

- `user-scalable=no` y `maximum-scale=1.0` impiden zoom y producen una violación crítica.
- Contraste insuficiente en entre 11 y 60 nodos por pantalla, según la densidad.

Ejemplos medidos:

- Texto secundario `#8e877d` sobre `#faf8f4`: 3.34:1; necesita 4.5:1.
- Verde `#5ea531` sobre fondo claro: 2.86:1.
- Verde `#5ea531` sobre `#e9f4dc`: 2.67:1.
- Etiquetas de 9.9–12.8 px agravan el contraste y legibilidad.

En móvil, entre 17% y 50% de los controles visibles medidos quedan por debajo de 44 px en alguna dimensión. `btn-sm` mide 34 px, botones de icono 40 px y varios segmentos 34–38 px.

**Corrección de diseño:** permitir zoom, elevar el contraste de `ink-3`, reservar el verde claro para superficies y usar un verde de texto más oscuro, definir 44 px como mínimo táctil y hacer pruebas con texto al 200%.

### P0 — La carga inicial hace más trabajo del necesario

Build actual:

- JavaScript: 486.14 kB sin comprimir / 136.70 kB gzip.
- CSS: 161.90 kB sin comprimir / 28.16 kB gzip.
- Un solo chunk principal; no hay `React.lazy` ni separación por ruta.
- `styles.css` tiene 4,289 líneas.
- Cada carga solicita dos variantes del logo de aproximadamente 160 kB cada una.

En una simulación móvil moderada —150 ms de latencia, ~1.6 Mbps y CPU ×4— la captura individual obtuvo:

- First paint: ~700 ms.
- First contentful paint: ~1.52 s.
- LCP: ~2.05 s.
- Tarea de Productos visible: ~2.08 s.

No son cifras catastróficas, pero explican por qué el cambio de pantalla se siente lento: el bundle completo se evalúa al inicio, luego se valida la sesión, después se carga configuración, luego catálogo y finalmente pedido. Varias vistas reemplazan el contenido completo por un spinner.

**Corrección técnica:** dividir por ruta/rol, cargar una sola variante optimizada de marca, cachear catálogos y semana, conservar datos anteriores al cambiar filtros y usar skeletons con dimensiones estables.

### P1 — Demasiadas superficies compiten entre sí

La app utiliza muchas tarjetas con borde, sombra, radio y fondos alternos. Cuando cada bloque parece una tarjeta importante, ninguna sección domina. Apple no se siente limpio por “usar tarjetas”; se siente limpio porque controles, contenido y navegación tienen planos distintos y predecibles.

**Corrección de diseño:** tres niveles de superficie como máximo:

1. Lienzo.
2. Contenedor de sección.
3. Superficie elevada temporal —menú, sheet, modal o acción persistente—.

Las listas largas deben usar filas y separadores, no una tarjeta individual por registro.

### P1 — Tipografía pequeña y demasiadas familias

El CSS contiene numerosas reglas entre 0.52 y 0.78 rem, además de cinco familias web. La mezcla añade peso, hace que datos y ayudas pierdan legibilidad y reduce la coherencia.

**Corrección de diseño:** una familia UI principal y una monoespaciada solamente para cifras que realmente lo necesiten. Base móvil de 16 px, secundaria de 14 px y metadatos no menores de 12 px salvo documentos de impresión. Los estilos de impresión deben quedar separados del sistema de pantalla.

### P1 — La navegación repite el mismo contexto

Ejemplo en sucursal: `Trabajo del día` → `1 Ventas` → `Paso 3` → `Ventas`. En admin: riel lateral y stepper semanal repiten los mismos módulos.

**Corrección de diseño:**

- El riel del admin organiza áreas; una barra local muestra la semana y las acciones del módulo.
- El personal operativo ve tareas, no el proceso completo del administrador.
- El número de paso solo aparece cuando realmente hay varios pasos consecutivos que el mismo usuario debe completar.

### P1 — La app confunde captura, inventario y venta

La interfaz usa `Ventas`, `Pedido`, `Inventario` y `Conteo físico` para tareas relacionadas pero distintas. En el código aún existe un flujo anterior donde una sucursal “elige cuánto producto quiere que le envíen” dentro de Inventario, aunque la ruta actual lleva a Ventas.

**Corrección de contenido:** fijar un vocabulario operativo:

- **Pedido del restaurante:** lo que la sucursal solicita.
- **Venta:** vista contable/administrativa del pedido confirmado.
- **Inventario físico:** lo que existe en bodega o carnicería.
- **Recepción:** lo que llegó al restaurante.
- **Ajuste:** corrección de diferencia.

Para la persona del restaurante, la acción debe ser `Hacer pedido`, no `Ventas` ni `Inventario`.

## 6. Auditoría por pantalla

| Pantalla | Qué funciona | Problema principal | Dirección propuesta |
| --- | --- | --- | --- |
| Login | Identidad clara, selección visual, PIN simple | Lista larga y dos marcas con demasiado peso visual; carga dos logos grandes | Una marca de producto compacta, búsqueda prioritaria, usuario reciente primero y lista virtual/scroll evidente |
| Inicio sucursal | Muy pocas opciones y tarea del día destacada | Tarjeta de módulo repite la CTA principal | Una sola tarjeta “Hoy” con estado del pedido/recepción y accesos secundarios discretos |
| Inicio bodega | Módulos limitados por rol | No muestra cola de trabajo ni estado de sincronización | Lista de tareas del turno: despachos, ruta, conteos y excepciones |
| Inicio admin | Buena cobertura de indicadores | Mucha información con igual peso; tarjetas y cifras compiten | Resumen por excepción: qué requiere acción hoy, luego KPIs y tendencias |
| Selector de semana | Modelo mental correcto | Texto se recorta en móvil y ocupa demasiado espacio; selector nativo contiene decenas de semanas | Semana actual como título corto; sheet de selección con búsqueda/año; flechas con área táctil de 44 px |
| Compras | Formulario completo y responsive a 390 px | En móvil es muy largo y mezcla metadatos, renglones y totales; controles de 34–42 px | Flujo por factura con header persistente, renglones en cards de edición y resumen/guardar fijo |
| Producción | Días visibles y relación entrada/salida clara | Mucho vacío en desktop, formulario estrecho; en móvil el nav tapa campos | Composición 8/4 en desktop, batch stepper en móvil, acción persistente y resultados calculados junto al campo |
| Pedido de restaurante | Protege borrador y conoce ruta/fecha | 19 artículos, 4.7 pantallas, productos colapsados, sin categorías ni avance | Captura guiada, categorías, pedido habitual, último pedido, búsqueda fija, autosave y revisión |
| Ventas semanales admin | Matriz potente y familiar para usuarios de Excel | En tablet se cortan acciones; en móvil una matriz no es el patrón correcto | Matriz para escritorio ancho; lista por restaurante/día en tablet y móvil, con editor en sheet |
| Despacho | El tablero semanal comunica días y líneas | En móvil la segunda columna queda fuera de vista sin affordance | Alternar Carne/Desechables y mostrar días como lista; detalle por día/ruta |
| Inventario | KPIs y filtros de línea están bien | Doble check se presenta como módulo principal aunque es “opcional”; productos ocultos | Separar `Estado actual` de `Conteo físico`; CTA contextual solo cuando corresponde |
| Cierre | Riesgo y estado tienen presencia visual | Jerarquía duplicada entre conciliación, tarjeta oscura y estado; acciones ambiguas | Checklist de cierre con bloqueos, responsables y una única acción final |
| Facturación | Información completa y acciones de pago visibles | Demasiado texto pequeño; 60 fallas de contraste; cards densas y repetitivas | Lista maestra + detalle; filtros persistentes; cifras importantes grandes y metadatos legibles |
| Incidencias | Estado vacío simple | Se ve inacabada y el emoji rompe el tono profesional | Empty state con explicación, acción y criterio de creación; historial consistente |
| Auditoría | Filtros y KPIs comprensibles | Repite título y “Control excepcional”; exceso de espacio vacío | Un header, filtros compactos y empty state que explique cuándo aparecerán registros |
| Configuración | Taxonomía por grupos es buena en desktop | En móvil se convierte en una fila horizontal larga sin mapa de grupos | Índice de configuración móvil; cada sección como página con breadcrumb y guardado local |

## 7. Nueva arquitectura de experiencia por rol

### Sucursal

Navegación inferior recomendada:

1. **Hoy**
2. **Pedido**
3. **Recepción** —solo si el reparto está habilitado—
4. **Más**

La semana se elige dentro de Pedido/Recepción, no como una capa global permanente. El inicio muestra un estado operativo: `Pedido pendiente`, `Pedido confirmado`, `Entrega en camino` o `Todo listo`.

### Bodega y reparto

Navegación inferior recomendada:

1. **Hoy**
2. **Despacho**
3. **Ruta** —cuando esté habilitada—
4. **Inventario**
5. **Más**

`Hoy` debe funcionar como cola priorizada, no como catálogo de módulos.

### Administrador

- Escritorio ancho: riel de 240 px.
- Escritorio/tablet intermedio: riel colapsado de 72 px o drawer.
- Móvil: navegación inferior con `Resumen`, `Operación`, `Facturación` y `Más`.
- El flujo semanal vive dentro de `Operación`, no se duplica como navegación global y local.
- Matrices densas solamente en anchos que las soporten; en móvil se usa drill-down por restaurante, fecha o ruta.

## 8. Especificación del nuevo flujo de pedido individual

### Pantalla 1 — Contexto

- Título: `Pedido de carne` o `Pedido de desechables`.
- Restaurante ya seleccionado; ocultarlo si el usuario solo tiene uno.
- Fecha de entrega presentada como dato principal con ruta debajo.
- Acceso `Cambiar` abre un sheet; no mostrar selects permanentes si no son necesarios.
- Estado de guardado: `Guardado en este dispositivo`, `Sincronizando` o `Sin conexión`.

### Pantalla 2 — Captura

- Buscador sticky.
- Chips de categoría: `Habituales`, `Proteínas`, `Preparados`, `Desechables`, `Todos` según la línea.
- Bloque `Tu pedido habitual` basado en últimas 4–6 semanas.
- Cada producto muestra nombre legible, unidad, cantidad anterior y control `−  cantidad  +` de 44–48 px.
- Tocar el número abre teclado numérico; `+` y `−` resuelven cantidades comunes.
- Productos con cantidad permanecen visibles en `Seleccionados`.
- Barra persistente: `Revisar · 7 productos · 23 unidades`.
- Guardado automático con debounce y borrador offline; no pedir al usuario que comprenda la diferencia entre “guardar” y “confirmar” durante la captura.

### Pantalla 3 — Revisión

- Mostrar solamente productos con cantidad.
- Edición directa desde el resumen.
- Notas opcionales al final.
- Total de unidades y, si corresponde al rol, importe.
- Mensaje explícito: `Al confirmar, este pedido se enviará a administración para preparar el despacho`.
- Acción principal: `Confirmar pedido`.
- Acción secundaria: `Seguir editando`.
- Confirmación visual con folio, fecha de entrega y estado de sincronización.

### Casos de error

- Sin conexión: permitir continuar y mostrar `Se enviará automáticamente al recuperar conexión`.
- Conflicto de versión: conservar el borrador local y mostrar comparación; nunca borrar silenciosamente.
- Semana cerrada: vista de consulta con CTA para contactar al administrador.
- Sin ruta configurada: bloquear confirmación, explicar el motivo y ofrecer contacto/acción clara.

## 9. Sistema visual propuesto

### Principios

- Menos decoración, más jerarquía.
- Una acción primaria por estado de pantalla.
- El verde comunica acción/éxito, no texto secundario general.
- Rojo solamente para error, deuda vencida o acción destructiva.
- Los números importantes deben poder leerse a un vistazo.

### Tokens iniciales

Los valores finales deben validarse con contraste; esta es la estructura:

- `surface-canvas`, `surface-section`, `surface-elevated`.
- `text-primary`, `text-secondary`, `text-tertiary-accessible`.
- `action-primary`, `action-primary-pressed`, `action-primary-subtle`.
- `status-success`, `status-warning`, `status-danger`, `status-info` con par texto/fondo.
- Radios: 12 px en controles, 16 px en secciones, 20 px solo en sheets/modales.
- Sombras: una sombra de elevación, no una variante por tarjeta.
- Espaciado: escala 4/8/12/16/24/32.
- Control táctil: mínimo 44 px; 48 px para acciones de captura frecuente.

### Tipografía

- Una familia UI variable y, opcionalmente, una monoespaciada para tablas financieras.
- Móvil: cuerpo 16 px, secundario 14 px, metadato 12–13 px.
- Admin desktop: cuerpo 14–15 px; tablas pueden usar 13 px con contraste suficiente.
- No usar mayúsculas completas para nombres de producto; reservar uppercase para etiquetas cortas.

### Componentes base

- `AppShell`, `RoleNavigation`, `PageHeader`.
- `WeekControl` adaptable.
- `TaskCard`, `StatusBanner`, `EmptyState`, `Skeleton`.
- `Field`, `NumberStepper`, `SearchField`, `SegmentedControl`.
- `StickyActionBar`, `BottomSheet`, `ConfirmSheet`.
- `DataList`, `ResponsiveTable`, `Metric`, `FilterBar`.
- `SaveStatus` y `OfflineStatus` compartidos.

## 10. Plan de implementación

### Fase 0 — Baseline y decisiones de producto — 2 a 3 días

- Confirmar vocabulario con una persona de sucursal, una de bodega y el administrador.
- Observar al menos dos capturas reales de pedido desde teléfono.
- Definir métricas de éxito y registrar baseline.
- Congelar el mapa de rutas y roles para evitar que el rediseño cambie permisos o reglas de negocio.

**Salida:** mapa de tareas, vocabulario aprobado y baseline medible.

### Fase 1 — Fundamentos, shell y accesibilidad — 5 a 7 días

- Crear tokens y componentes base.
- Corregir contraste, zoom y áreas táctiles.
- Rehacer navegación adaptable sin el salto de 820/821 px.
- Simplificar encabezados y selector de semana.
- Separar estilos de impresión y dividir `styles.css` por dominio.
- Agregar skeletons y estados vacíos consistentes.

**Criterios de aceptación:** cero acciones recortadas entre 320 y 1440 px; axe sin violaciones críticas; controles táctiles de 44 px; zoom al 200% utilizable.

### Fase 2 — Pedido móvil de restaurante — 7 a 10 días

- Construir Contexto → Captura → Revisión.
- Agregar categorías, habituales/último pedido y productos seleccionados.
- Implementar `NumberStepper`, autosave, indicador offline y barra persistente.
- Reescribir mensajes en lenguaje de restaurante.
- Mantener contratos de API actuales salvo un endpoint opcional para sugerencias/histórico.

**Criterios de aceptación:** un usuario puede completar el pedido sin instrucciones; la acción siguiente siempre es visible; no se pierde el borrador; cantidad de scroll y toques se reduce al menos 40% en un pedido típico.

### Fase 3 — Bodega, despacho e inventario — 5 a 7 días

- Crear cola `Hoy` para bodega.
- Convertir despacho móvil en tabs Carne/Desechables y lista por día/ruta.
- Separar estado de inventario y conteo físico.
- Aplicar barras persistentes y feedback de sincronización.

**Criterios de aceptación:** ninguna tabla horizontal es necesaria para una tarea de campo; el siguiente despacho/conteo se identifica en menos de cinco segundos.

### Fase 4 — Consola administrativa responsive — 8 a 12 días

- Rediseñar Resumen por excepciones.
- Mantener matrices en escritorio y crear vistas drill-down para tablet/móvil.
- Rehacer Facturación como lista maestra + detalle.
- Convertir Configuración móvil en índice y subpáginas.
- Normalizar filtros, estados vacíos, encabezados y acciones masivas.

**Criterios de aceptación:** todas las funciones admin son accesibles a 390, 768, 834 y 1024 px; ninguna acción depende de scroll horizontal invisible.

### Fase 5 — Rendimiento, pulido y QA — 5 a 7 días

- Dividir bundle por ruta/rol con lazy loading.
- Optimizar marca e imágenes y cargar una sola variante.
- Cachear catálogos/configuración y evitar cascadas de requests.
- Probar offline, cambios de orientación, teclado móvil, safe areas y texto ampliado.
- Añadir pruebas visuales y de accesibilidad a CI.
- Hacer prueba de campo y ajustar microcopy/orden de controles.

**Criterios de aceptación:** LCP móvil objetivo menor de 1.8 s en red moderada; feedback visual en menos de 100 ms; vista útil inicial en menos de 1 s cuando existe caché; cero regresiones de permisos/lógica.

### Estimación global

Entre **5 y 7 semanas** para una persona enfocada en frontend/producto con revisiones frecuentes del negocio. Puede reducirse si se entrega por rol: Sucursal primero, Bodega después y Admin al final. No se recomienda intentar un “cambio de tema” global en una sola entrega; el mayor valor proviene de corregir primero arquitectura, captura y responsive.

## 11. Orden exacto del backlog

### P0 — Antes de cualquier pulido visual

1. Corregir breakpoint 820/821 y controles recortados en tablet.
2. Permitir zoom y corregir contraste/touch targets.
3. Rediseñar pedido individual móvil.
4. Añadir barra de acción persistente que respete navegación inferior y teclado.
5. Eliminar spinners de página completa donde se pueda mostrar skeleton o datos anteriores.

### P1 — Percepción de producto maduro

1. Unificar vocabulario Pedido/Venta/Inventario.
2. Simplificar navegación y encabezados redundantes.
3. Reducir tarjetas, sombras y tipografías.
4. Rehacer Facturación y Configuración responsive.
5. Diseñar empty states y confirmaciones consistentes.

### P2 — Escala y refinamiento

1. Dashboard con tendencias y excepciones.
2. Preferencias por usuario: habituales, orden y filtros recientes.
3. Animaciones breves de transición/confirmación respetando `prefers-reduced-motion`.
4. Telemetría de tareas y errores sin capturar datos sensibles.
5. Personalización de marca adicional después de estabilizar la experiencia.

## 12. Estrategia técnica

Estructura sugerida:

```text
client/src/
  design-system/
    tokens.css
    foundations.css
  components/ui/
    Button.tsx
    Field.tsx
    NumberStepper.tsx
    Skeleton.tsx
    StickyActionBar.tsx
    BottomSheet.tsx
    StatusBanner.tsx
  layouts/
    AppShell.tsx
    AdminShell.tsx
    FieldShell.tsx
  features/
    orders/
    warehouse/
    inventory/
    billing/
    settings/
  print/
    print.css
```

Decisiones técnicas recomendadas:

- `React.lazy` por sección pesada.
- Cache compartido para `/negocio`, `/operacion/catalogo` y semana seleccionada.
- Skeletons específicos por pantalla para evitar saltos.
- Container queries o breakpoints basados en espacio del contenido.
- Componentes de tabla con modo lista/detail, no solamente overflow horizontal.
- `aria-live` para guardado/sincronización y estados de error.
- Tokens de color verificados automáticamente con WCAG.
- Pruebas de screenshot en widths críticos, especialmente 820/821/834.

## 13. Matriz mínima de validación

### Viewports

- 320 × 568.
- 375 × 667.
- 390 × 844.
- 430 × 932.
- 768 × 1024.
- 820 y 821 px —regresión específica.
- 834 × 1112.
- 1024 × 768.
- 1440 × 900.

### Condiciones

- Retrato y paisaje.
- PWA instalada y navegador.
- Teclado numérico abierto.
- Safe areas de iPhone.
- Texto al 200%.
- Red lenta, pérdida de conexión y recuperación.
- Tema claro y oscuro.
- Semana abierta, cerrada y sin configuración completa.
- Catálogo corto y catálogo largo.

### Roles

- Admin con operación completa.
- Encargado de una sucursal.
- Encargado de varias sucursales.
- Bodega sin reparto.
- Bodega con reparto activo.

## 14. Métricas de éxito

- Pedido típico completado en menos de 90 segundos.
- Reducción mínima de 40% en scroll/toques para pedido habitual.
- Menos de 1% de pedidos abandonados después de modificar cantidades.
- Cero acciones cortadas u ocultas en viewports soportados.
- Cero violaciones críticas de accesibilidad; contraste AA en contenido operativo.
- 100% de tareas de campo con feedback de guardado/sincronización visible.
- LCP menor de 1.8 s en móvil moderado y menor de 1 s con caché caliente.
- Menos solicitudes duplicadas y una sola descarga de marca por tema.

## 15. Recomendación de entrega

La mejor primera entrega no es cambiar colores: es un **vertical slice del encargado de sucursal** con el nuevo shell móvil, pedido guiado, autosave, estados de carga y accesibilidad corregida. Ese slice define el estándar de interacción; después se aplica a bodega y, por último, a la consola admin.

El rediseño puede convivir temporalmente con las pantallas actuales detrás de rutas/componentes nuevos. Esto permite validar en uno o dos restaurantes antes de migrar a toda la operación y reduce el riesgo de afectar la lógica semanal existente.
