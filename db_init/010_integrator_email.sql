-- Login identifier for the self-service portal changes from phone_number to email.
-- phone_number stays in the table (profile display only); email is the new
-- unique login credential. NULL allowed so admin-created integrators without
-- a portal account aren't broken.
ALTER TABLE integrators
    ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL AFTER phone_number;

-- Unique index that permits multiple NULLs (MySQL behaviour for UNIQUE columns).
ALTER TABLE integrators
    ADD UNIQUE INDEX IF NOT EXISTS uq_integrators_email (email);
