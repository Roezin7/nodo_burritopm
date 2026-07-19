# NODO · Burrito Parrilla Mexicana

PWA operativa y contable para **Burrito Parrilla Mexicana**. El sistema reemplaza los libros
semanales de Excel sin cambiar la forma real de trabajar: integra compras, producción de
carnicería, ventas por restaurante, rutas, despacho, inventario, facturación y cierre semanal.

- Interfaz en español.
- Moneda USD.
- Zona horaria operativa `America/Chicago`.
- Semana operativa de **domingo a sábado**. El domingo ya pertenece a la semana siguiente.
- Dos centros de inventario: **Carnicería** para carne y **Bodega Addison** para desechables.
- Tres empresas de facturación: **Burrito Parrilla Mexicana (BPM)**, **Taquería Aurora (AUR)** y
  **Los Burritos Tapatíos (LBT)**.

## Qué resuelve

La operación normal requiere que el admin capture principalmente tres cosas:

1. **Compras**.
2. **Producción**.
3. **Ventas/pedidos**.

El sistema deriva el resto: consolidación, documentos de despacho, movimientos de inventario,
costos, facturas, cuentas por cobrar, conciliación y fotografías de cierre. El admin conserva
control para corregir capturas mientras la semana sea editable.

## Flujo semanal vigente

```text
CAPTURA
Compras → Producción → Ventas

PROCESO
Despacho → Reparto opcional → Inventario → Cierre
                         ↘ Recepción / auditoría de faltantes
```

### Selector general de semana

Compras, producción, ventas, despacho, inventario, cierre y dashboard comparten un selector
global. Se puede avanzar o retroceder explícitamente entre Semana 27, Semana 28, Semana 29,
etc. La URL conserva la semana seleccionada para evitar mezclar periodos.

### Preparación

Preparación ya no es una captura independiente. Las ventas confirmadas se consolidan y se
sincronizan automáticamente con Despacho. Esto evita obligar al admin a confirmar una segunda
vez información que ya existe en los pedidos.

### Reparto y recepción

El seguimiento de reparto se activa o desactiva en **Configuración → Flujo semanal**:

- **Desactivado:** Despacho completa el flujo sin bloquear el cierre. Recepción queda como
  auditoría excepcional para registrar faltantes.
- **Activado:** el usuario de bodega/reparto trabaja la ruta parada por parada y el restaurante
  confirma su recepción. Puede configurarse un auto-cierre de tránsito.
- Para el admin, Recepción siempre funciona como auditoría de diferencias; no es un paso
  obligatorio cuando todo llegó correctamente.

## Empresas, ubicaciones y acceso

### Empresas

- **BPM:** empresa interna del holding. Sus facturas se generan por ubicación.
- **Aurora:** comprador externo con facturación separada.
- **LBT:** comprador externo con facturación separada para sus ubicaciones.
- Burlington se factura por separado, pero puede entregarse físicamente en Aurora.

Los días de crédito iniciales del bootstrap son 14 días para BPM, 7 para Aurora y pago al día
para LBT. Las facturas se generan por restaurante/ubicación y por línea operativa.

### Roles

| Rol | Capacidades principales |
| --- | --- |
| `admin` | Control total de compras, producción, ventas, rutas, inventario, cierre, facturación, incidencias y configuración. |
| `encargado_bodega` | Inventario de bodega, despacho y reparto cuando está habilitado. |
| `encargado_sucursal` | Captura de pedidos de sus ubicaciones y confirmación de recepción cuando aplica. |

El acceso usa selección de usuario + PIN de 4 a 6 dígitos y JWT. Cada usuario se limita en el
backend a sus ubicaciones asignadas. Cambiar PIN, rol o estado incrementa la versión de acceso y
revoca sesiones anteriores.

## Compras

- Captura de varios productos en una sola factura.
- Selector de proveedor administrable desde Configuración.
- Fecha, referencia, ubicación y total de factura; el vencimiento se calcula automáticamente.
- Edición y eliminación mientras la operación posterior permita revertirla con seguridad.
- Total semanal visible.
- Pago a proveedor individual o masivo y reversión del pago.
- Cuentas por pagar son la **única cartera que el admin modifica manualmente**.
- Renglón **Grocery and Disposables** para sal, pimienta y otros cargos comprados en la misma
  factura que la carne. Suma al total y a cuentas por pagar, pero no crea inventario.

### Cajas variables de materia prima

Una caja comprada de carne no tiene un peso fijo. Cada renglón conserva:

- número de cajas;
- peso total real;
- costo total real;
- costo y peso promedio calculados;
- condición fresca o congelada.

La compra crea lotes trazables. Para materia prima y desechables, el consumo utiliza FIFO; no se
reemplaza el peso real de una compra por un peso estándar del catálogo.

El total contable de la factura puede diferir del costo que entra al inventario. **Grocery and
Disposables** se registra como un renglón contable con su importe; flete u otros ajustes todavía
pueden reflejarse en el total opcional de factura. Ninguno crea cajas ficticias, lotes, movimientos,
costo promedio ni costo FIFO, incluso si comparte factura con Skirt Steak o Pork Butt.

## Producción de carnicería

- Captura de varios batches y productos en un mismo día.
- Selección directa por día de la semana.
- Historial agrupado por día y colapsado por defecto.
- Eliminación de un batch o de todos los batches de un día con reversión trazable.
- Consumo obligatorio de materia prima respaldada por compras FIFO.
- Cálculo con cajas de entrada, peso total de entrada, costo total, cajas terminadas y peso de
  salida.
- Yield, remanente/desperdicio, costo total, costo por caja y precio de venta por caja.

### Normalización de producto terminado

- Proteínas terminadas: **20 lb por caja**.
- Carne Asada y Fajitas: **10 lb por caja**.
- Tamales, chile relleno, taco dorado, adobo, carnitas y otros productos de precio fijo se
  manejan por pieza o por su unidad configurada.

### Calendario base de producción

- Lunes y jueves: Al Pastor BPM, Al Pastor Tapatíos y Tapatíos Taco Meat.
- Martes y viernes: Steak Taco, Carne Asada y Fajitas.
- Miércoles y sábado: Chicken.
- Milanesa, puerco y otros productos pueden capturarse de forma esporádica.

El calendario es una guía de captura, no una restricción rígida.

### Costeo y precios

- El costo de entrada sale de los lotes FIFO realmente consumidos.
- El costo semanal de cada proteína es el costo total producido dividido entre las cajas
  producidas de esa semana.
- El precio de venta de proteína es **costo por caja + $15 por caja**.
- El precio queda fijo para las ventas y facturas de esa semana; una producción posterior no
  reescribe semanas cerradas.
- Los productos `precio_fijo` y `servicio` no reciben el markup de $15.
- Carnitas puede registrarse como subproducto del remanente: tiene valor de venta, pero no
  absorbe costo del batch principal cuando su receta está marcada `sin_costo`.
- Al Pastor BPM y Al Pastor Tapatíos son productos diferentes.

## Ventas y pedidos

### Captura individual

Cada restaurante puede capturar su propio pedido de carne o desechables. El sistema propone la
fecha de entrega programada más cercana y conserva borrador local para proteger cambios sin
guardar.

Al seleccionar una ubicación de LBT, el renglón de pastor se convierte automáticamente en
**Al Pastor Tapatíos**; BPM conserva **Al Pastor BPM**.

### Cuadrícula semanal del admin

- Vista tipo Excel con productos en filas y restaurantes en columnas.
- Captura completa de la semana por restaurante y fecha.
- Navegación con Enter.
- Pegado directo de bloques copiados desde Excel.
- Totales por producto, restaurante y semana.
- Restaurar lo guardado o limpiar un alcance completo sin borrar celda por celda.
- Guardado masivo con control de versión para no sobrescribir una corrección más reciente.
- Confirmación masiva; los borradores no entran al despacho.
- Orden del catálogo y ubicaciones compatible con los libros históricos.

Las ventas pueden capturarse antes de registrar la producción. El inventario terminado puede
quedar provisionalmente negativo durante la semana para permitir que el admin capture compras y
producción al final del sábado. La conciliación resuelve el saldo al cierre.

### Historial e impresión

- Consulta por semana, restaurante, línea y fecha.
- Impresión de órdenes consolidadas por ruta.
- Carne y desechables conservan formatos separados.
- Consumibles que viajan en una hoja de carne siguen perteneciendo a inventario y facturación de
  desechables; no se duplican como carne.

## Rutas programadas

Las plantillas son editables: día, conductor, línea, orden de paradas y paradas opcionales. El
admin puede agregar ubicaciones y reordenarlas sin límite.

### Carne BPM

- Miércoles Sur — Pablo: Lombard, Lisle, Naperville II/Ogden, Naperville, Aurora, Batavia,
  West Chicago y Carol Stream.
- Miércoles Norte — MH: Glendale Heights, Schaumburg, Rolling Meadows y Algonquin.
- Sábado Sur — Pablo: misma base del Sur.
- Sábado Norte — MH: Norte más Tapatíos Streamwood.

### LBT

- Lunes y jueves — Pablo: Tapatíos Glen Ellyn, Lombard y Streamwood.
- La hoja de Tapatíos se consolida como una sola ruta.

### Desechables

- Miércoles Norte — MH: Schaumburg y Rolling Meadows.
- Miércoles Sur — Pablo: ruta Sur, Glendale Heights, Algonquin y ubicaciones LBT configuradas,
  incluyendo Glen Ellyn, Streamwood y Lombard.

Estas listas son valores iniciales del bootstrap; Configuración/Rutas es la fuente editable.

## Despacho y documentos para chofer

Despacho se genera desde ventas confirmadas y se organiza por fecha, línea y ruta. No necesita
un paso manual de Preparación.

Formatos disponibles para imprimir o guardar como PDF:

- Hoja general de carga con matriz producto × restaurante.
- Paquete completo del día.
- Paquete por ruta.
- Hoja total de carne por ruta y una hoja individual por restaurante.
- En desechables, hoja general de carga y hojas individuales para el chofer.
- Tapatíos usa una hoja consolidada horizontal/landscape por ruta.

La verificación de carga puede habilitarse en Configuración. Los documentos respetan el orden de
productos y ubicaciones de los Excel operativos.

## Inventario y conciliación

### Centros y tipos

- **Carnicería:** materia prima fresca/congelada y carne terminada.
- **Bodega Addison:** desechables y consumibles.
- Existencias separadas por ubicación y producto.
- Libro de movimientos con disponible, reservado y en tránsito.

### Fórmula semanal de carne

```text
Inventario inicial del sábado
+ producción de lunes, martes y miércoles
- pedidos del miércoles
= saldo del miércoles
+ producción de jueves, viernes y sábado
- pedidos del sábado
= inventario final del sábado
```

Compras, producción y ventas pueden ingresarse el mismo día en que ocurren o capturarse
retroactivamente el sábado. Las tres fuentes se concilian por fecha y producto.

### Conteo físico final

El conteo físico es **opcional** y sirve como doble validación. El cierre puede deducir el saldo
final con inventario inicial + compras + producción − ventas.

- Un saldo negativo no bloquea el cierre.
- Las cajas faltantes se valúan en $0.
- Se genera una incidencia de `cajas_perdidas_inventario` para auditoría.
- Los conteos y ajustes pueden eliminarse mientras no existan operaciones posteriores que
  dependan de ellos.

## Cierre semanal

Antes de cerrar se muestra una vista previa con:

- venta que se facturará;
- ajustes y créditos;
- inventario calculado;
- cuentas por cobrar del ciclo;
- cuentas por pagar;
- balance estimado;
- cajas perdidas e incidencias que se crearán;
- facturas por empresa, ubicación y línea.

El cierre es transaccional: genera facturas, congela inventario/costos, guarda la fotografía
semanal y cierra los pedidos como una sola unidad. Una semana cerrada no cambia por movimientos
del inventario vivo.

La última semana puede reabrirse para corregir compras, producción o ventas. Al reabrir se
anulan las facturas vigentes, se restauran los ajustes aplicados y el siguiente cierre crea una
nueva versión del folio. No se permite reabrir detrás de operación posterior incompatible.

## Facturación

### Facturas emitidas

- Una factura por ubicación y por línea operativa.
- Folios versionados por año, semana, empresa, ubicación y carne/desechables.
- Precios semanales congelados en la factura.
- Impresión o guardado en PDF desde la app.
- Historial de documentos dentro y fuera del ciclo.

### Cuentas por cobrar automáticas

Las cuentas por cobrar no requieren que el admin marque facturas como pagadas. Funcionan como
una ventana móvil de tres semanas:

```text
Cierre semana 29 = semanas 27 + 28 + 29
Cierre semana 30 = semanas 28 + 29 + 30
Cierre semana 31 = semanas 29 + 30 + 31
```

Cada factura participa durante su semana y las dos siguientes. Al comenzar la cuarta sale del
ciclo automáticamente y pasa al historial. Los endpoints de cobro manual a restaurantes están
bloqueados. Pagos históricos de clientes se conservan para auditoría, pero no alteran el ciclo.

### Créditos de producción de Lisle

Lisle produce tacos dorados, tamales y otros productos. El admin puede registrar en Facturación
un crédito con semana, monto y concepto:

- sólo puede pertenecer a Lisle;
- no crea una venta ni mueve inventario;
- se aplica al cerrar la semana;
- compensa únicamente facturas de Lisle, nunca otra ubicación;
- puede eliminarse mientras siga abierto;
- una vez aplicado requiere reabrir la semana para corregirlo.

### Cuentas por pagar

Las compras pendientes forman la cartera de proveedores. Ésta sí es manual:

- registrar pago individual;
- registrar varios pagos a la vez;
- revertir un pago;
- revisar vencidos, proveedor, referencia y detalle de compra.

## Dashboard

El panorama seleccionable por semana resume:

- ventas de carne y desechables por empresa;
- markup semanal de proteínas;
- valor de materia prima fresca y congelada;
- carne terminada y desechables;
- costo, cajas y yield de producción;
- compras semanales;
- cuentas por cobrar del ciclo de tres semanas;
- cuentas por pagar y vencimientos;
- balance operativo;
- borradores, despachos, faltantes e inventario bajo mínimo.

Para semanas cerradas usa la fotografía histórica; para una semana abierta usa la operación
vigente/proyectada.

## Excel e importación histórica

Cada cierre puede generar los seis libros compatibles con la operación 3Q 2026:

1. `Weekly Order.xlsx`
2. `Disposables.xlsx`
3. `Production.xlsx`
4. `Billing.xlsx`
5. `LBT.xlsx`
6. `Taqueria Aurora.xlsx`

Los archivos fuente auditados viven en `server/prisma/data/3q`. La carga histórica incluye
pedidos por sucursal, producción, inventarios, precios y balances; no se limita a totales.

La importación histórica **no se ejecuta en cada deploy**. Para una base nueva o una importación
controlada:

```bash
npm run import:excel:3q -w server
```

Para analizar otra carpeta de libros:

```bash
BPM_EXCEL_DIR="/ruta/a/los/excel" npm run import:excel:3q -w server
```

Las importaciones y backfills usan marcas en `importaciones_sistema` para no duplicarse. Los
scripts de reset histórico son herramientas manuales y no deben ejecutarse contra producción
sin respaldo y autorización explícita.

## Configuración administrable

- Ubicaciones y empresas asociadas.
- Usuarios, roles, PIN, estado y ubicaciones permitidas.
- Proveedores: alta, edición, activación y desactivación.
- Productos de carne y desechables.
- Tipo operativo, precio fijo, markup, peso estándar y días de producción.
- Categorías y orden operativo.
- Unidades y conversiones.
- Productos habilitados por ubicación y stock mínimo.
- Rutas, conductores, días, paradas, orden y opcionalidad.
- Seguimiento de reparto.
- Verificación de carga.
- Días programados para conteo físico.
- Auto-cierre de recepción/tránsito.

## PWA, conectividad y avisos

- Instalable en escritorio, Android, iPhone y iPad.
- Splash inicial “Toca para entrar”.
- Caché del shell para abrir la interfaz con conectividad intermitente.
- Borradores locales y protección de cambios sin guardar en capturas críticas.
- Cola offline limitada a operaciones idempotentes de campo; compras, producción, cierres,
  pagos y eliminaciones exigen conexión y confirmación del servidor.
- Banner de actualización después de un deploy; el usuario decide cuándo recargar.
- Web Push opcional para recordatorios de inventario y sucursales rezagadas.

En iPhone/iPad, los avisos requieren HTTPS y la PWA instalada desde **Compartir → Agregar a
inicio**.

## Arquitectura

Monorepo npm con un solo servicio desplegable. Express sirve la API REST bajo `/api` y también
la PWA compilada.

```text
/
├── client/                         React + TypeScript + Vite + PWA
│   └── src/screens/                operación, facturación y configuración
├── server/                         Express + TypeScript + Prisma + Zod
│   ├── prisma/
│   │   ├── schema.prisma           modelo PostgreSQL
│   │   ├── migrations/             cambios aplicados por Coolify
│   │   ├── data/3q/                seis libros históricos auditados
│   │   └── seed-operacion.ts       catálogo, empresas y rutas idempotentes
│   └── src/
│       ├── auth/                   PIN, JWT, roles y scoping
│       ├── catalogo/               productos, unidades y proveedores
│       ├── operacion/              compras, producción, ventas y conciliación
│       ├── distribuciones/         despacho, recepción y rutas
│       ├── inventario/ + ledger/   FIFO y movimientos
│       ├── cierre/                 facturas, balance y Excel
│       ├── dashboard/              panorama semanal
│       ├── incidencias/            excepciones operativas
│       └── push/                   avisos PWA y auto-cierre
├── reference/                      esqueleto de referencia conservado
├── Dockerfile                      imagen Node 22 single-service
└── package.json                    workspaces y comandos raíz
```

### Modelo principal

```text
negocio
├── empresas de facturación
├── ubicaciones (bodega | sucursal)
├── usuarios y asignaciones
├── productos, recetas y proveedores
├── compras → lotes FIFO
├── producciones → salidas terminadas
├── pedidos → distribuciones → rutas/recepciones
├── existencias + ledger + fotografías semanales
└── semanas → facturas, ajustes y balances
```

Las cantidades usan `Decimal(12,3)` y costos/factores usan precisión decimal en PostgreSQL.

## Integridad y trazabilidad

- Toda entidad operativa se limita por `negocio_id`; inventario y acceso también por ubicación.
- Compras, producción, inventario y créditos usan claves de idempotencia para resistir doble clic
  o reintentos.
- Operaciones que afectan inventario se ejecutan con transacciones serializables.
- Pedidos masivos validan versión por restaurante.
- FIFO conserva costo, peso y lote consumido.
- Cierres, reaperturas y eliminaciones relevantes dejan auditoría.
- Un pedido consolidado no cambia en silencio: una corrección revierte y reaplica sólo la
  diferencia de inventario necesaria.
- Body JSON limitado a 2 MB, CORS configurable, Helmet/CSP y rate limit general/login.
- El service worker no reemplaza silenciosamente una versión abierta de la app.

## Desarrollo local

Requisitos: Node.js 20 o superior y PostgreSQL.

1. Configura el entorno:

   ```bash
   cp server/.env.example server/.env
   # edita DATABASE_URL, JWT_SECRET y los PIN iniciales si aplica
   ```

2. Instala, genera Prisma y prepara la base:

   ```bash
   npm install
   npm run prisma:generate
   npx --workspace server prisma migrate deploy
   npm run seed
   npm run seed:operacion -w server
   ```

3. Inicia desarrollo:

   ```bash
   npm run dev
   ```

   - API: `http://localhost:3100`
   - Vite: `http://localhost:5173`

4. Build y ejecución de producción local:

   ```bash
   npm run build
   npm start
   ```

## Pruebas y validación

```bash
npm test
npm run build
npx --workspace server prisma validate
```

Las pruebas cubren FIFO, ledger, transacciones serializables, producción/costos, corrección de
ventas, conciliación, rutas, plantillas Excel, folios, créditos de Lisle y ciclo de cuentas por
cobrar.

## Despliegue en Coolify

El `Dockerfile` produce una imagen Node 22 que compila cliente y servidor. En cada arranque:

```text
prisma migrate deploy
→ seed base idempotente
→ bootstrap operativo idempotente
→ API + PWA
```

Esto aplica migraciones nuevas y completa datos maestros faltantes, pero no reinicia semanas ni
vuelve a importar los Excel. No borra compras, producción, ventas, inventario, facturas o cambios
de configuración realizados por el admin.

### Variables de entorno

- `DATABASE_URL`: conexión PostgreSQL propia de esta app.
- `JWT_SECRET`: secreto largo y exclusivo, mínimo 16 caracteres.
- `SEED_ADMIN_PIN`: obligatorio para crear el primer admin en producción.
- `SEED_REPARTO_PIN`: PIN inicial del usuario de bodega/reparto cuando el bootstrap lo necesite.
- `ALLOWED_ORIGINS`: dominios permitidos separados por coma; vacío significa mismo origen.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: Web Push opcional.
- `PORT`: normalmente inyectado por Coolify; valor por defecto `3100`.
- `NODE_ENV=production`: fijado por la imagen.
- `ANTHROPIC_API_KEY`: reservado para capacidades posteriores; no es necesario para la operación
  actual.

El healthcheck es `GET /api/health`. HTTPS es obligatorio para instalación PWA completa y push.

## Operación segura en producción

- Respaldar PostgreSQL antes de migraciones o correcciones históricas extraordinarias.
- No ejecutar scripts `reset-*` ni backfills manuales sin revisar primero su alcance.
- No editar directamente existencias, lotes o facturas en SQL; usar los flujos de reversión de la
  app para conservar el ledger.
- Cerrar semanas en orden.
- Reabrir únicamente la última semana compatible.
- Revisar Incidencias cuando el cierre reporte cajas perdidas.
- Cambiar inmediatamente los PIN temporales.
