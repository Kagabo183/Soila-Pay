USE soila_pay;

-- A debit failure (e.g. "savings account does not exist", insufficient
-- balance) is a clean, immediate, terminal outcome - no money moved. Before
-- this, such a row stayed at PENDING forever, and _handle_existing() treats
-- PENDING as "mid-flight, do not re-execute" - so any retry with the same
-- Idempotency-Key got a confusing 409 "in progress" instead of the real
-- error, permanently. DEBIT_FAILED is a genuine terminal status: the SAME
-- key now consistently replays the SAME clear error (proper idempotency
-- semantics), and the caller can tell from the response that a fresh
-- Idempotency-Key is what's needed, not "wait and retry".
ALTER TABLE transaction_logs
    MODIFY COLUMN status ENUM(
        'PENDING',
        'DEBITED',
        'DEBIT_FAILED',
        'SUCCESS',
        'FAILED_REFUNDED',
        'FAILED_REFUND_ERROR'
    ) NOT NULL DEFAULT 'PENDING';
