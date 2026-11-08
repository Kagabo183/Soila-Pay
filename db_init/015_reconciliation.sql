USE soila_pay;

-- What LMBTech's status API reports as the amount for the transaction. For
-- collections this has been observed HIGHER than amount_rwf (e.g. 105 for a
-- 100 RWF payment, 1200 for 1000) - LMBTech appears to add its own fee on top.
-- Stored as reported so fee questions are answered by data, not assumptions.
ALTER TABLE payments
    ADD COLUMN gateway_amount_rwf DECIMAL(18, 2) NULL AFTER amount_rwf,
    -- Last time this finished row was checked against LMBTech.
    ADD COLUMN reconciled_at DATETIME(3) NULL AFTER completed_at,
    -- Our previous status when a check against LMBTech CORRECTED this row
    -- (e.g. FAILED -> SUCCESS). NULL = never corrected.
    ADD COLUMN corrected_from VARCHAR(16) NULL AFTER reconciled_at,
    -- Rows added by an admin because they existed only at LMBTech.
    ADD COLUMN imported TINYINT(1) NOT NULL DEFAULT 0 AFTER is_test;
