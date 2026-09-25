-- =========================================================
-- Eliminar un usuario de prueba (sin dependencias reales)
-- Reemplaza 'admin' por el nombre de usuario que quieres borrar.
-- =========================================================

DO $$
DECLARE
    v_usuario VARCHAR := 'admin';
    v_id_usuario BIGINT;
    v_id_persona BIGINT;
    v_dependencias INT;
BEGIN
    SELECT id_usuario, id_persona INTO v_id_usuario, v_id_persona
    FROM usuario WHERE usuario = v_usuario;

    IF v_id_usuario IS NULL THEN
        RAISE NOTICE 'No existe un usuario con ese nombre: %', v_usuario;
        RETURN;
    END IF;

    -- Verifica que no haya creado nada real antes de borrar
    SELECT count(*) INTO v_dependencias FROM (
        SELECT 1 FROM contrato WHERE created_by = v_id_usuario OR id_usuario = v_id_usuario
        UNION ALL SELECT 1 FROM pago WHERE created_by = v_id_usuario
        UNION ALL SELECT 1 FROM auditoria WHERE id_usuario = v_id_usuario
        UNION ALL SELECT 1 FROM persona WHERE created_by = v_id_usuario AND id_persona <> v_id_persona
    ) t;

    IF v_dependencias > 0 THEN
        RAISE EXCEPTION 'El usuario % tiene % registro(s) dependientes. No se elimina para no romper la trazabilidad.', v_usuario, v_dependencias;
    END IF;

    DELETE FROM login_auditoria WHERE id_usuario = v_id_usuario;
    DELETE FROM sesion WHERE id_usuario = v_id_usuario;
    DELETE FROM usuario_rol WHERE id_usuario = v_id_usuario;
    DELETE FROM credencial WHERE id_usuario = v_id_usuario;
    DELETE FROM usuario WHERE id_usuario = v_id_usuario;
    DELETE FROM persona WHERE id_persona = v_id_persona;

    RAISE NOTICE 'Usuario % (id_usuario=%) y su persona (id_persona=%) eliminados correctamente.', v_usuario, v_id_usuario, v_id_persona;
END $$;
