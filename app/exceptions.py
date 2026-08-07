class FineractError(Exception):
    """Raised when a Fineract API call fails (non-2xx or transport error)."""


class CollectionError(Exception):
    """Raised when the collection provider rejects, times out, or errors on a collection."""


class CollectionPending(Exception):
    """Raised when the provider acknowledged the request but hasn't resolved it
    yet (DDIN's collection/initiate returns 202 pending, not a result). The
    orchestrator leaves the transaction at DEBITED and waits for the
    provider's webhook (collection.success / collection.failed) to resolve it
    via CollectionOrchestrator.resolve_provider_success/resolve_provider_failure -
    see app/api/v1/webhooks.py. This is NOT a failure: raising CollectionError
    here would wrongly roll back a transaction that may still go on to
    succeed."""

    def __init__(self, operation_reference_id: str | None = None):
        self.operation_reference_id = operation_reference_id
        super().__init__(
            f"provider collection pending (operationReferenceId={operation_reference_id})"
        )


class RefundExhaustedError(Exception):
    """Raised when the rollback refund fails after exhausting all retry attempts."""

    def __init__(self, attempts: int, last_error: str):
        self.attempts = attempts
        self.last_error = last_error
        super().__init__(f"Refund failed after {attempts} attempts: {last_error}")


class IdempotencyConflictError(Exception):
    """Raised when an idempotency key is currently mid-flight (PENDING/DEBITED)."""


class ManualReconciliationRequiredError(Exception):
    """Raised when an idempotency key previously ended in FAILED_REFUND_ERROR."""
