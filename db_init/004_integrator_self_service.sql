USE soila_pay;

-- Self-service onboarding, mirroring how DDIN itself onboarded Soila Pay: an
-- integrator can sign up with just a phone number and start testing in
-- sandbox immediately (sandbox_api_key, already on the integrators table,
-- works from the moment they sign up). Going live requires submitting KYC/KYB
-- info for manual review - production_api_key stays NULL until approved.
--
-- KNOWN SIMPLIFICATION: tax_clearance_reference / rdb_certificate_reference
-- are plain text fields (e.g. a document URL or reference number), not real
-- file uploads - there's no file storage service in this stack yet. Swap
-- these for real upload handling before this is used for actual KYC review.
ALTER TABLE integrators
    ADD COLUMN phone_number             VARCHAR(32) NULL,
    ADD COLUMN password_hash            VARCHAR(255) NULL,
    ADD COLUMN business_location        VARCHAR(255) NULL,
    ADD COLUMN tax_clearance_reference  VARCHAR(255) NULL,
    ADD COLUMN rdb_certificate_reference VARCHAR(255) NULL,
    ADD COLUMN ip_whitelist             VARCHAR(255) NULL,
    ADD COLUMN production_status        ENUM(
                                             'NOT_SUBMITTED',
                                             'PENDING_REVIEW',
                                             'APPROVED',
                                             'REJECTED'
                                         ) NOT NULL DEFAULT 'NOT_SUBMITTED',
    ADD COLUMN production_rejection_reason VARCHAR(255) NULL,
    ADD COLUMN production_api_key       VARCHAR(64) NULL,
    ADD UNIQUE KEY uq_phone_number (phone_number),
    ADD UNIQUE KEY uq_production_api_key (production_api_key);
