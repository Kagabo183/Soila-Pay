USE soila_pay;

-- Real KYC document storage - an integrator uploads the actual file (tax
-- clearance certificate, RDB certificate), not just a text reference/URL.
-- Stored as a BLOB directly in MySQL rather than on disk or in object storage
-- (S3 etc.) - there's no file storage service in this stack, and this keeps
-- the whole thing working out of the box in docker-compose with no new
-- infrastructure. Deliberately a SEPARATE table from `integrators`, not BLOB
-- columns on it - `integrators` is read on every single collection request
-- (IntegratorRepo.get_by_api_key), and that must never drag multi-megabyte
-- document bytes along for the ride.
CREATE TABLE IF NOT EXISTS integrator_documents (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    integrator_id   BIGINT UNSIGNED NOT NULL,
    document_type   ENUM('TAX_CLEARANCE', 'RDB_CERTIFICATE') NOT NULL,
    file_name       VARCHAR(255) NOT NULL,
    content_type    VARCHAR(100) NOT NULL,
    file_size_bytes INT UNSIGNED NOT NULL,
    file_data       LONGBLOB NOT NULL,
    uploaded_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
    -- One document per type per integrator - re-uploading replaces it
    -- (INSERT ... ON DUPLICATE KEY UPDATE in IntegratorDocumentRepo.upsert).
    UNIQUE KEY uq_integrator_document_type (integrator_id, document_type),
    CONSTRAINT fk_integrator_documents_integrator
        FOREIGN KEY (integrator_id) REFERENCES integrators(id)
) ENGINE=InnoDB;
