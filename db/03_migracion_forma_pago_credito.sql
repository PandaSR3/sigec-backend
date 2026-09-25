-- =========================================================
-- Migracion 03: forma de pago "Credito" (para aplicar creditos
-- a cuotas reutilizando el motor de pagos existente)
-- Ejecutar DESPUES de 02_migracion_dashboards.sql
-- =========================================================

INSERT INTO forma_pago (nombre) VALUES ('Credito')
ON CONFLICT (nombre) DO NOTHING;
