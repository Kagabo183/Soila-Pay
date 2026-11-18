USE soila_pay;

-- An admin can switch an integrator's live access off ("Suspend live").
-- SUSPENDED differs from REJECTED: the integrator can't go live again by
-- themselves (the Go live form is refused) until an admin restores it.
ALTER TABLE integrators
    MODIFY COLUMN production_status ENUM(
        'NOT_SUBMITTED',
        'PENDING_REVIEW',
        'APPROVED',
        'REJECTED',
        'SUSPENDED'
    ) NOT NULL DEFAULT 'NOT_SUBMITTED';
