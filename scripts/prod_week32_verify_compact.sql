BEGIN READ ONLY;
SELECT jsonb_build_object(
  'semana', semana, 'estado', estado,
  'carne', valor_carne, 'desechables', valor_desechables,
  'por_cobrar', cuentas_por_cobrar, 'por_pagar', cuentas_por_pagar, 'balance', balance_neto
) FROM semanas_operativas WHERE negocio_id=1 AND anio=2026 AND semana=32;
SELECT jsonb_object_agg(nombre,saldo ORDER BY nombre) FROM (
  SELECT p.nombre,round(sum(c.total-coalesce(x.pagado,0)),2) saldo
  FROM compras c JOIN proveedores p ON p.id=c.proveedor_id
  LEFT JOIN (SELECT compra_id,sum(monto) pagado FROM pagos_compra GROUP BY compra_id)x ON x.compra_id=c.id
  WHERE c.estado<>'cancelada' AND c.total-coalesce(x.pagado,0)>0 GROUP BY p.nombre
) q;
SELECT jsonb_build_object(
  'semanas_30_31', (SELECT count(*) FROM semanas_operativas WHERE negocio_id=1 AND anio=2026 AND semana IN (30,31)),
  'pedidos_30_31', (SELECT count(*) FROM pedidos_operativos WHERE negocio_id=1 AND fecha_entrega BETWEEN DATE '2026-07-19' AND DATE '2026-08-01'),
  'despachos_30_31', (SELECT count(*) FROM distribuciones WHERE negocio_id=1 AND fecha_entrega BETWEEN DATE '2026-07-19' AND DATE '2026-08-01'),
  'producciones_30_31', (SELECT count(*) FROM producciones WHERE negocio_id=1 AND fecha BETWEEN DATE '2026-07-19' AND DATE '2026-08-01'),
  'inventario_fuera_centrales', (SELECT count(*) FROM existencias e JOIN ubicaciones u ON u.id=e.ubicacion_id WHERE e.cantidad_disponible<>0 AND u.codigo NOT IN ('BOD','CARN'))
);
ROLLBACK;
