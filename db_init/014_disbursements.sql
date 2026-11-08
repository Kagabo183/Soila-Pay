USE soila_pay;

-- Disbursements (payouts to a customer's MTN MoMo via LMBTech action=payout)
-- live in the same table as collections: one ledger, one status checker,
-- one reconciliation loop. `direction` tells them apart.
ALTER TABLE payments
    ADD COLUMN direction ENUM('COLLECTION', 'DISBURSEMENT') NOT NULL DEFAULT 'COLLECTION' AFTER gateway,
    ADD KEY idx_payments_direction (direction, status, created_at);

-- LMBTech's cut on payouts (5% assumed, same as collections - editable on
-- the Pricing page once LMBTech confirms) and the default fee integrators pay
-- per payout. Fee must stay >= cost or every payout loses money.
INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('lmbtech_payout_cost_percentage', '5.00')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('payout_fee_percentage', '6.00')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Per-integrator payout fee override; NULL = platform default.
ALTER TABLE integrators
    ADD COLUMN payout_fee_percentage DECIMAL(5, 2) NULL AFTER payment_fee_percentage;
