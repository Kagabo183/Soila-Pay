USE soila_pay;

-- Per-integrator, database-driven override (not a hardcoded name/ID check):
-- when true, even this integrator's SANDBOX key routes through the real
-- Fineract + real DDIN collection provider instead of the safe internal
-- simulator. Off by default for every integrator - including future
-- self-service signups - so external businesses get a genuinely safe sandbox
-- that never touches DDIN or spends Soila Pay's real quota. Intended for
-- Soila Pay's own house/testing account(s); toggle via
-- PATCH /api/v1/admin/integrators/{id}. See app/api/v1/collection.py's
-- key_mode routing.
ALTER TABLE integrators
    ADD COLUMN sandbox_uses_real_provider TINYINT(1) NOT NULL DEFAULT 0;
