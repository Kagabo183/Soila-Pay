USE soila_pay;

-- 001_schema.sql was rewritten in-place to use the new MoMo-collection column
-- names (provider, customer_account_number, provider_transaction_reference)
-- on the assumption of a fresh database - fine for a brand-new install, but
-- this repo's transaction_logs table predates that rewrite and still has the
-- old utility-purchase-era names. This migration brings an EXISTING database
-- in line with what 001_schema.sql now defines, and what
-- app/db/transaction_log_repo.py actually queries against.
ALTER TABLE transaction_logs
    CHANGE COLUMN utility_provider provider VARCHAR(32) NOT NULL,
    CHANGE COLUMN meter_number customer_account_number VARCHAR(32) NOT NULL,
    CHANGE COLUMN utility_token provider_transaction_reference VARCHAR(255) NULL,
    ADD COLUMN customer_name VARCHAR(191) NOT NULL DEFAULT '' AFTER customer_account_number;
