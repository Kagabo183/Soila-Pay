USE soila_pay;

-- An "integrator" is one of Soila Pay's own aggregator clients - a business
-- that calls our /api/v1/collection/collect endpoint to collect money from its
-- customers via us. fee_percentage is what WE charge them; it is intentionally
-- a plain mutable column (not a code constant) so an operator can change it
-- from the admin API/UI without a deploy. sandbox_api_key both authenticates
-- the caller and tells us who to bill/credit for revenue reporting - see
-- 004_integrator_self_service.sql for production_api_key and onboarding.
CREATE TABLE IF NOT EXISTS integrators (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name               VARCHAR(191) NOT NULL,
    sandbox_api_key    VARCHAR(64) NOT NULL,
    fee_percentage     DECIMAL(5, 2) NOT NULL DEFAULT 2.20,
    is_active          TINYINT(1) NOT NULL DEFAULT 1,
    created_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                       ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_sandbox_api_key (sandbox_api_key)
) ENGINE=InnoDB;

-- Generic key/value store for small platform-wide knobs that should also be
-- editable without a deploy. Currently holds only ddin_cost_percentage - what
-- DDIN charges Soila Pay per collection - so the margin (integrator fee minus
-- this) can be computed and re-computed as DDIN's own pricing changes, without
-- touching code.
CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key     VARCHAR(64) PRIMARY KEY,
    setting_value   VARCHAR(255) NOT NULL,
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('ddin_cost_percentage', '2.00')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Per-transaction fee/cost/margin snapshot. Stored (not recomputed later)
-- because integrator.fee_percentage and platform_settings.ddin_cost_percentage
-- can both change over time - historical transactions must keep the rates that
-- actually applied to them.
ALTER TABLE transaction_logs
    ADD COLUMN integrator_id             BIGINT UNSIGNED NULL AFTER fineract_savings_account_id,
    ADD COLUMN integrator_fee_percentage DECIMAL(5, 2) NULL,
    ADD COLUMN ddin_cost_percentage      DECIMAL(5, 2) NULL,
    ADD COLUMN fee_amount_rwf            DECIMAL(18, 2) NULL,
    ADD COLUMN ddin_cost_amount_rwf      DECIMAL(18, 2) NULL,
    ADD COLUMN margin_amount_rwf         DECIMAL(18, 2) NULL,
    ADD KEY idx_integrator (integrator_id),
    ADD CONSTRAINT fk_transaction_logs_integrator
        FOREIGN KEY (integrator_id) REFERENCES integrators(id);
