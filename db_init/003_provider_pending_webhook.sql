USE soila_pay;

-- DDIN's collection API is asynchronous: a purchase can sit at DEBITED with
-- the provider call acknowledged-but-unresolved (status "pending") until its
-- collection.success/collection.failed webhook arrives (see
-- app/api/v1/webhooks.py and DDINCollectionProvider's docstring). This column
-- holds DDIN's operationReferenceId for that in-flight call, so a pending
-- transaction can be looked up/support-traced before its webhook resolves it.
ALTER TABLE transaction_logs
    ADD COLUMN provider_operation_reference_id VARCHAR(64) NULL,
    ADD KEY idx_provider_operation_reference_id (provider_operation_reference_id);
