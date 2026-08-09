-- Integrator webhook subscriptions. Each row represents a callback endpoint
-- an integrator has registered to receive real-time POST notifications when a
-- collection succeeds or fails. The `secret` column is the HMAC-SHA256 signing
-- key included on every delivery as X-Soila-Signature: sha256=<hex>.
CREATE TABLE IF NOT EXISTS integrator_webhooks (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    integrator_id BIGINT UNSIGNED NOT NULL,
    callback_url  VARCHAR(512)    NOT NULL,
    events        JSON            NOT NULL,
    secret        VARCHAR(64)     NOT NULL,
    is_active     TINYINT(1)      NOT NULL DEFAULT 1,
    created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_iw_integrator
        FOREIGN KEY (integrator_id) REFERENCES integrators(id) ON DELETE CASCADE,
    KEY idx_iw_integrator (integrator_id)
);
