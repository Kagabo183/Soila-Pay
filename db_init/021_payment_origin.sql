USE soila_pay;

-- Who started each transaction, how, and from where - for the admin
-- reconciliation report.
--   source:    API (integrator key), PORTAL (integrator dashboard), CONSOLE
--              (admin checkout / payouts), TEST_LAB, IMPORT (added from a
--              gateway's dashboard), UNKNOWN (integrator rows made before
--              this was recorded).
--   actor:     the integrator (and key type) or the admin who started it.
--   client_ip: the IP address the request came from.
ALTER TABLE payments
    ADD COLUMN source VARCHAR(16) NULL AFTER imported,
    ADD COLUMN actor VARCHAR(191) NULL AFTER source,
    ADD COLUMN client_ip VARCHAR(45) NULL AFTER actor,
    ADD KEY idx_payments_gateway (gateway, created_at);

-- Best guess for rows made before this was recorded.
UPDATE payments
SET source = CASE
        WHEN imported = 1 THEN 'IMPORT'
        WHEN integrator_id IS NULL AND gateway = 'SANDBOX' THEN 'TEST_LAB'
        WHEN integrator_id IS NULL THEN 'CONSOLE'
        ELSE 'UNKNOWN'
    END
WHERE source IS NULL;
