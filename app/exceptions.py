class FineractError(Exception):
    """Raised when a Fineract API call fails (non-2xx or transport error)."""


class UtilityPurchaseError(Exception):
    """Raised when the utility provider rejects, times out, or errors on a purchase."""


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
