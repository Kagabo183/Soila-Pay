-- This database holds ONLY our own audit log (transaction_logs below). Fineract
-- gets its own separate Postgres database (see db_init_postgres/ and the
-- fineract-db comment in docker-compose.yml) - the official Fineract Docker
-- image can't load a MySQL or MariaDB JDBC driver due to license
-- incompatibility, so it cannot share this database.
CREATE DATABASE IF NOT EXISTS soila_pay CHARACTER SET utf8mb4;

USE soila_pay;

CREATE TABLE IF NOT EXISTS transaction_logs (
    id                           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idempotency_key              VARCHAR(191) NOT NULL,
    fineract_savings_account_id  VARCHAR(64) NOT NULL,
    utility_provider             VARCHAR(32) NOT NULL,
    meter_number                 VARCHAR(32) NOT NULL,
    amount_rwf                   DECIMAL(18, 2) NOT NULL,
    status                       ENUM(
                                      'PENDING',
                                      'DEBITED',
                                      'SUCCESS',
                                      'FAILED_REFUNDED',
                                      'FAILED_REFUND_ERROR'
                                  ) NOT NULL DEFAULT 'PENDING',
    fineract_debit_txn_id        VARCHAR(64) NULL,
    fineract_refund_txn_id       VARCHAR(64) NULL,
    utility_token                VARCHAR(255) NULL,
    error_detail                 TEXT NULL,
    refund_attempts              INT UNSIGNED NOT NULL DEFAULT 0,
    request_payload              JSON NULL,
    response_payload             JSON NULL,
    created_at                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at                   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_idempotency_key (idempotency_key),
    KEY idx_status (status),
    KEY idx_savings_account (fineract_savings_account_id),
    KEY idx_created_at (created_at)
) ENGINE=InnoDB;

-- Application user (matches MYSQL_USER/MYSQL_PASSWORD env vars set by the mysql
-- container, which docker-entrypoint already grants full rights on MYSQL_DATABASE;
-- this GRANT is a no-op safety net if that user already exists from env-based init).
GRANT ALL PRIVILEGES ON soila_pay.* TO 'soila_app'@'%';
FLUSH PRIVILEGES;
