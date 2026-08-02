BEGIN;
WITH target AS (
  UPDATE semanas_operativas
  SET valor_desechables = 217507.29,
      balance_neto = 203821.94
  WHERE negocio_id = 1 AND anio = 2026 AND semana = 32
  RETURNING id
)
INSERT INTO auditoria_operativa (negocio_id, usuario_id, accion, entidad, entidad_id, datos)
SELECT 1, (SELECT id FROM usuarios WHERE negocio_id=1 AND rol='admin' AND activo ORDER BY id LIMIT 1),
       'corregir_redondeo_apertura_semana_32', 'semana_operativa', id,
       jsonb_build_object('valor_anterior',217507.28,'valor_correcto',217507.29,'fuente','Inventarios.xlsx · Inv Disposables (32) · DR56')
FROM target;
COMMIT;
