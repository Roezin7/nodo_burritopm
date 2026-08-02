BEGIN READ ONLY;
SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column,
       rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
JOIN information_schema.referential_constraints rc ON rc.constraint_name=tc.constraint_name AND rc.constraint_schema=tc.constraint_schema
WHERE tc.constraint_type='FOREIGN KEY'
  AND (tc.table_name IN ('pedidos_operativos','distribuciones','compras','producciones','conteos','semanas_operativas','facturas','movimientos_inventario','lotes_materia_prima')
       OR ccu.table_name IN ('pedidos_operativos','distribuciones','compras','producciones','conteos','semanas_operativas','facturas','movimientos_inventario','lotes_materia_prima'))
ORDER BY referenced_table, table_name;
ROLLBACK;
