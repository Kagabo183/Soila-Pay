USE soila_pay;

-- Integrator profile, modelled on LMBTech's own merchant profile page:
-- personal + business details, bank account for settlement, and an
-- admin-controlled Account Mode (Test / Production).
ALTER TABLE integrators
    ADD COLUMN first_name     VARCHAR(80)  NULL AFTER name,
    ADD COLUMN last_name      VARCHAR(80)  NULL AFTER first_name,
    -- Login handle; only an admin can change it (like email and phone).
    ADD COLUMN username       VARCHAR(60)  NULL AFTER last_name,
    ADD COLUMN address        VARCHAR(191) NULL AFTER business_location,
    ADD COLUMN location       VARCHAR(120) NULL AFTER address,
    ADD COLUMN city           VARCHAR(80)  NULL AFTER location,
    ADD COLUMN country        VARCHAR(80)  NULL DEFAULT 'Rwanda' AFTER city,
    -- Where Soila Pay settles the integrator's collections.
    ADD COLUMN bank_name      VARCHAR(120) NULL AFTER country,
    ADD COLUMN bank_account   VARCHAR(60)  NULL AFTER bank_name,
    -- TEST: only the sandbox key works. PRODUCTION: the production key works
    -- too. Switched by an admin only, separately from KYC approval.
    ADD COLUMN account_mode   ENUM('TEST', 'PRODUCTION') NOT NULL DEFAULT 'TEST' AFTER production_status,
    ADD COLUMN keys_rotated_at DATETIME(3) NULL,
    ADD UNIQUE KEY uq_integrators_username (username);

-- Integrators that were already approved keep working in production.
UPDATE integrators SET account_mode = 'PRODUCTION' WHERE production_status = 'APPROVED';

-- Profile picture lives with the other uploads (not on the integrators row,
-- which is read on every API call).
ALTER TABLE integrator_documents
    MODIFY COLUMN document_type ENUM('TAX_CLEARANCE', 'RDB_CERTIFICATE', 'PROFILE_IMAGE') NOT NULL;
