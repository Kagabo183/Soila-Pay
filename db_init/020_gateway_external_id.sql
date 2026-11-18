USE soila_pay;

-- Kitovu Pay identifies a transaction by OUR externalId, and requires it to
-- be a 6-digit number for collections (7 digits for disbursements) - so it
-- can't be Soila Pay's own reference (SP-20261118-...). Store it per row;
-- unique per gateway so a Kitovu callback maps to exactly one payment.
ALTER TABLE payments
    ADD COLUMN gateway_external_id VARCHAR(32) NULL AFTER gateway,
    ADD UNIQUE KEY uq_gateway_external_id (gateway, gateway_external_id);
