-- =========================================================
-- Migracion 04: permiso CRONOGRAMA_REPROGRAMAR
-- Ejecutar DESPUES de 03_migracion_forma_pago_credito.sql
-- =========================================================

INSERT INTO permiso (id_modulo, codigo, nombre)
SELECT m.id_modulo, 'CRONOGRAMA_REPROGRAMAR', 'Reprogramar cronograma de un contrato'
FROM modulo m WHERE m.nombre = 'Cobranza'
ON CONFLICT (codigo) DO NOTHING;

-- Responsables segun el Documento 06 (Entidad 002): Cobranzas y Super Administrador
INSERT INTO rol_permiso (id_rol, id_permiso)
SELECT r.id_rol, p.id_permiso FROM rol r, permiso p
WHERE r.nombre IN ('Cobranzas', 'Super Administrador') AND p.codigo = 'CRONOGRAMA_REPROGRAMAR'
ON CONFLICT DO NOTHING;
