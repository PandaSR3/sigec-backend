-- =========================================================
-- Migracion 02: soporte para dashboards por rol (Documento 04)
-- Ejecutar DESPUES de sigec_schema.sql y sigec_seed.sql
-- =========================================================

-- Meta mensual de ventas por asesor (PD-003: enfoque motivacional del
-- dashboard del asesor). No se calcula, la define el negocio cada mes.
CREATE TABLE IF NOT EXISTS meta_comercial (
    id_meta_comercial    SERIAL PRIMARY KEY,
    id_usuario           BIGINT NOT NULL REFERENCES usuario(id_usuario),
    periodo              VARCHAR(7) NOT NULL, -- 'YYYY-MM'
    meta_contratos       INT,
    meta_monto           NUMERIC(10,2),
    created_at           TIMESTAMP NOT NULL DEFAULT now(),
    created_by           INT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_comercial_usuario_periodo
    ON meta_comercial (id_usuario, periodo);

-- Porcentaje de comision usado para estimar la comision del asesor en su
-- dashboard mientras no exista una tabla de reglas de comision mas fina.
INSERT INTO configuracion_empresa (id_empresa, clave, valor)
SELECT id_empresa, 'PORCENTAJE_COMISION_ASESOR', '5'
FROM empresa WHERE ruc = '00000000000'
ON CONFLICT (id_empresa, clave) DO NOTHING;
