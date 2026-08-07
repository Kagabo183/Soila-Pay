USE soila_pay;

-- Server-side history for the DDIN Diagnostics page (previously session-only
-- in the browser, lost on every page reload). steps_json holds the full
-- per-step detail (already masked before it ever reaches this table - see
-- _mask_sensitive in app/services/ddin_diagnostics.py) so the page can render
-- history the same way it renders a live run.
CREATE TABLE IF NOT EXISTS ddin_diagnostics_runs (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    correlation_id     VARCHAR(32) NOT NULL,
    overall_status     ENUM('PASS', 'FAIL') NOT NULL,
    base_url           VARCHAR(255) NOT NULL,
    total_duration_ms  DOUBLE NOT NULL,
    steps_json         JSON NOT NULL,
    ran_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_ran_at (ran_at),
    KEY idx_correlation_id (correlation_id)
) ENGINE=InnoDB;
