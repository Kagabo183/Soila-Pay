USE soila_pay;

-- LMBTech charges Soila Pay a percentage of every payment (5% confirmed).
-- Mirrors the DDIN pattern for collections: the gateway's cost is a platform
-- setting, the integrator's fee is charged on top, margin = fee - cost, and
-- all three are frozen onto each payment row at creation time so later rate
-- changes never rewrite history.
INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('lmbtech_cost_percentage', '5.00')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Default fee charged to integrators on checkout payments (separate from the
-- collections fee in integrators.fee_percentage, which is priced against
-- DDIN's 2%). Must stay >= lmbtech_cost_percentage or every payment loses money.
INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('payment_fee_percentage', '6.00')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Per-integrator override; NULL = use the platform default above.
ALTER TABLE integrators
    ADD COLUMN payment_fee_percentage DECIMAL(5, 2) NULL AFTER fee_percentage;

ALTER TABLE payments
    ADD COLUMN gateway_cost_percentage DECIMAL(5, 2)  NULL AFTER fee_amount_rwf,
    ADD COLUMN gateway_cost_amount_rwf DECIMAL(18, 2) NULL AFTER gateway_cost_percentage,
    ADD COLUMN margin_amount_rwf       DECIMAL(18, 2) NULL AFTER gateway_cost_amount_rwf;

-- Backfill payments made before this migration at the 5% LMBTech rate.
-- Their stored fee was the old collections fee (2.20%), so their margin is
-- honestly negative - that is exactly the loss this migration prevents.
UPDATE payments
SET gateway_cost_percentage = 5.00,
    gateway_cost_amount_rwf = ROUND(amount_rwf * 5.00 / 100, 2),
    margin_amount_rwf = CASE
        WHEN fee_amount_rwf IS NULL THEN NULL
        ELSE fee_amount_rwf - ROUND(amount_rwf * 5.00 / 100, 2)
    END
WHERE gateway_cost_percentage IS NULL;
