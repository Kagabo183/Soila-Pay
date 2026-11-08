USE soila_pay;

-- Cash-outs: an integrator withdrawing their own balance, like LMBTech's
-- "Cashout to Bank" / "Cashout to MoMo".
--   * To MoMo: an LMBTech payout to the integrator's own MTN number
--     (method MOMO, gateway LMBTECH) - same as any disbursement.
--   * To Bank: LMBTech has no bank payout API, so it's a request that an
--     admin settles by bank transfer (method BANK, gateway MANUAL). It stays
--     PENDING - reserving the money - until marked paid (SUCCESS) or
--     rejected (FAILED, which releases it).
ALTER TABLE payments
    MODIFY COLUMN method ENUM('MOMO', 'CARD', 'BANK') NOT NULL,
    -- 1 when the integrator is withdrawing to themselves (not paying a customer).
    ADD COLUMN is_cashout TINYINT(1) NOT NULL DEFAULT 0 AFTER direction;
