USE soila_pay;

-- Customer payments accepted through an aggregated gateway (LMBTech today):
-- MTN Mobile Money and cards (Visa / Mastercard / other, all processed on
-- LMBTech's hosted Pesapal page - Soila Pay never sees card numbers).
-- Deliberately separate from transaction_logs, which models the Fineract
-- debit -> DDIN collection -> refund flow; a checkout payment has no Fineract
-- leg and a different lifecycle (redirects, async callbacks).
CREATE TABLE IF NOT EXISTS payments (
    id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    -- Our reference, sent to the gateway as reference_id. Unique, so a
    -- retried create with the same reference can't double-charge.
    reference_id             VARCHAR(64)  NOT NULL,
    -- NULL = created from the admin console's own checkout, not an integrator.
    integrator_id            BIGINT UNSIGNED NULL,
    gateway                  VARCHAR(32)  NOT NULL DEFAULT 'LMBTECH',
    method                   ENUM('MOMO', 'CARD') NOT NULL,
    -- MOMO: network (MTN). CARD: what the customer picked (VISA / MASTERCARD /
    -- OTHER) - a UI hint only; the real brand is decided on the card page.
    channel                  VARCHAR(32)  NOT NULL,
    amount_rwf               DECIMAL(18, 2) NOT NULL,
    fee_percentage           DECIMAL(5, 2)  NULL,
    fee_amount_rwf           DECIMAL(18, 2) NULL,
    customer_name            VARCHAR(191) NOT NULL,
    customer_email           VARCHAR(255) NOT NULL,
    customer_phone           VARCHAR(32)  NULL,
    description              VARCHAR(191) NOT NULL DEFAULT 'payment',
    status                   ENUM('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    status_message           VARCHAR(255) NULL,
    gateway_transaction_id   VARCHAR(128) NULL,
    -- CARD only: LMBTech's hosted card page the customer is sent to.
    redirect_url             VARCHAR(512) NULL,
    -- Integrator's own URL to send the customer back to after a card payment.
    return_url               VARCHAR(512) NULL,
    is_test                  TINYINT(1)   NOT NULL DEFAULT 1,
    completed_at             DATETIME(3)  NULL,
    created_at               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                             ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_payments_reference (reference_id),
    KEY idx_payments_integrator (integrator_id, created_at),
    KEY idx_payments_status (status, created_at),
    CONSTRAINT fk_payments_integrator
        FOREIGN KEY (integrator_id) REFERENCES integrators(id)
) ENGINE=InnoDB;
