BEGIN READ ONLY;

SELECT proveedor.nombre, count(*) docs,
       round(sum(c.total - coalesce(pg.pagado, 0)), 2) saldo
FROM compras c
JOIN proveedores proveedor ON proveedor.id = c.proveedor_id
LEFT JOIN (SELECT compra_id, sum(monto) pagado FROM pagos_compra GROUP BY compra_id) pg ON pg.compra_id = c.id
WHERE c.estado <> 'cancelada' AND c.total - coalesce(pg.pagado, 0) > 0
GROUP BY proveedor.nombre ORDER BY proveedor.nombre;

SELECT c.id, p.nombre proveedor, c.fecha, c.vence_at, c.referencia, c.total,
       coalesce(sum(pc.monto), 0) pagado, c.estado
FROM compras c
JOIN proveedores p ON p.id = c.proveedor_id
LEFT JOIN pagos_compra pc ON pc.compra_id = c.id
WHERE c.estado <> 'cancelada'
GROUP BY c.id, p.nombre
HAVING c.total - coalesce(sum(pc.monto), 0) > 0
ORDER BY c.fecha, c.id;

SELECT 'pedidos' entidad, count(*) FROM pedidos_operativos WHERE fecha_entrega BETWEEN DATE '2026-07-19' AND DATE '2026-08-08'
UNION ALL SELECT 'compras', count(*) FROM compras WHERE fecha BETWEEN DATE '2026-07-19' AND DATE '2026-08-08'
UNION ALL SELECT 'producciones', count(*) FROM producciones WHERE fecha BETWEEN DATE '2026-07-19' AND DATE '2026-08-08'
UNION ALL SELECT 'distribuciones', count(*) FROM distribuciones WHERE fecha_entrega BETWEEN DATE '2026-07-19' AND DATE '2026-08-08'
UNION ALL SELECT 'conteos', count(*) FROM conteos WHERE fecha BETWEEN DATE '2026-07-19' AND DATE '2026-08-08'
UNION ALL SELECT 'movimientos', count(*) FROM movimientos_inventario WHERE fecha::date BETWEEN DATE '2026-07-19' AND DATE '2026-08-08';

SELECT fecha_entrega, count(*)
FROM pedidos_operativos
WHERE fecha_entrega >= DATE '2026-08-02'
GROUP BY fecha_entrega ORDER BY fecha_entrega;

ROLLBACK;
