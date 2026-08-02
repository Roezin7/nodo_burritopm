BEGIN READ ONLY;

SELECT anio, semana, inicia_at, termina_at, estado, valor_carne, valor_desechables,
       cuentas_por_cobrar, cuentas_por_pagar, balance_neto
FROM semanas_operativas WHERE anio=2026 AND semana BETWEEN 30 AND 32 ORDER BY semana;

SELECT 'pedidos_30_31' check_name, count(*) value FROM pedidos_operativos WHERE fecha_entrega BETWEEN DATE '2026-07-19' AND DATE '2026-08-01'
UNION ALL SELECT 'distribuciones_30_31', count(*) FROM distribuciones WHERE fecha_entrega BETWEEN DATE '2026-07-19' AND DATE '2026-08-01'
UNION ALL SELECT 'producciones_30_31', count(*) FROM producciones WHERE fecha BETWEEN DATE '2026-07-19' AND DATE '2026-08-01'
UNION ALL SELECT 'conteos_30_31', count(*) FROM conteos WHERE fecha BETWEEN DATE '2026-07-19' AND DATE '2026-08-01'
UNION ALL SELECT 'facturas_30_31', count(*) FROM facturas f JOIN semanas_operativas s ON s.id=f.semana_id WHERE s.anio=2026 AND s.semana IN (30,31)
UNION ALL SELECT 'cuentas_por_cobrar', count(*) FROM facturas WHERE estado IN ('emitida','pagada')
UNION ALL SELECT 'inventario_fuera_centrales', count(*) FROM existencias e JOIN ubicaciones u ON u.id=e.ubicacion_id WHERE e.cantidad_disponible<>0 AND u.codigo NOT IN ('BOD','CARN');

SELECT u.codigo, p.linea_operacion, p.tipo_operativo,
       round(sum(e.cantidad_disponible),3) unidades,
       round(sum(e.cantidad_disponible*coalesce(e.costo_promedio,0)),2) valor
FROM existencias e JOIN ubicaciones u ON u.id=e.ubicacion_id JOIN products p ON p.id=e.product_id
WHERE e.cantidad_disponible<>0
GROUP BY u.codigo,p.linea_operacion,p.tipo_operativo ORDER BY u.codigo,p.tipo_operativo;

SELECT p.nombre, e.cantidad_disponible, e.costo_promedio,
       round(e.cantidad_disponible*coalesce(e.costo_promedio,0),2) valor
FROM existencias e JOIN ubicaciones u ON u.id=e.ubicacion_id JOIN products p ON p.id=e.product_id
WHERE u.codigo IN ('BOD','CARN') AND e.cantidad_disponible<>0
ORDER BY u.codigo,p.linea_operacion,p.orden_operativo,p.nombre;

SELECT p.nombre proveedor, count(*) documentos,
       round(sum(c.total-coalesce(pg.pagado,0)),2) saldo
FROM compras c JOIN proveedores p ON p.id=c.proveedor_id
LEFT JOIN (SELECT compra_id,sum(monto) pagado FROM pagos_compra GROUP BY compra_id) pg ON pg.compra_id=c.id
WHERE c.estado<>'cancelada' AND c.total-coalesce(pg.pagado,0)>0
GROUP BY p.nombre ORDER BY p.nombre;

SELECT count(*) import_guard FROM importaciones_sistema WHERE clave='client-reset-week30-31-open-week32-v1';
ROLLBACK;
