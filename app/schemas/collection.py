from typing import Literal, Optional

from pydantic import BaseModel, Field, condecimal, model_validator

# DDIN validates that the phone number's prefix matches the mobile money
# network, and rejects a mismatch with a 422 - but only at collection/initiate,
# which we reach AFTER the Fineract wallet has already been debited, forcing a
# pointless debit-then-refund round trip for what is purely a bad-input error.
# Rejecting it here instead keeps the wallet untouched.
#
# Prefixes are DDIN's own, quoted verbatim from its validation errors
# (confirmed live against the sandbox, 2026-08-09):
#   "MTN account number must start with 078, 079, 25078, or 25079"
#   "Airtel account number must start with 072, 073, 25072, or 25073"
PROVIDER_ACCOUNT_PREFIXES: dict[str, tuple[str, ...]] = {
    "MTN": ("078", "079", "25078", "25079"),
    "AIRTEL": ("072", "073", "25072", "25073"),
}


def provider_prefix_error(provider: str, customer_account_number: str) -> Optional[str]:
    """DDIN's own message for a provider/prefix mismatch, or None if it matches."""
    prefixes = PROVIDER_ACCOUNT_PREFIXES.get(provider)
    if prefixes is None:
        return None
    number = customer_account_number.strip().replace(" ", "").lstrip("+")
    if number.startswith(prefixes):
        return None
    return (
        f"{provider} account number must start with "
        f"{', '.join(prefixes[:-1])}, or {prefixes[-1]}"
    )


class CollectionRequest(BaseModel):
    fineract_savings_account_id: str = Field(..., min_length=1)
    # Mobile money network DDIN collects through - confirmed live that "MTN"
    # is accepted; DDIN's own docs sample also shows MTN. Add "AIRTEL" here
    # once confirmed against the sandbox.
    provider: Literal["MTN", "AIRTEL"]
    # Phone number the collection debits, e.g. "0788123456".
    customer_account_number: str = Field(..., min_length=5, max_length=20)
    # Required by DDIN's collection/initiate API (customerName) - a real
    # field now, not a placeholder guessed inside the provider client.
    customer_name: str = Field(..., min_length=1)
    amount_rwf: condecimal(gt=0, decimal_places=2)

    @model_validator(mode="after")
    def _account_number_matches_provider(self) -> "CollectionRequest":
        error = provider_prefix_error(self.provider, self.customer_account_number)
        if error:
            raise ValueError(error)
        return self


CollectionStatus = Literal["SUCCESS", "PENDING", "FAILED_REFUNDED", "FAILED_REFUND_ERROR"]


class CollectionResponse(BaseModel):
    status: CollectionStatus
    idempotency_key: str
    fineract_savings_account_id: str
    debit_transaction_id: Optional[str] = None
    refund_transaction_id: Optional[str] = None
    provider_transaction_reference: Optional[str] = None
    # float, not Decimal: this is the response/output side - Pydantic v2
    # serializes Decimal to a JSON *string* (to preserve precision), which
    # silently breaks frontend code expecting a number. CollectionRequest
    # above (the input side) correctly keeps condecimal for validation; the
    # orchestrator's internal math is still all Decimal.
    amount_rwf: float
    message: str
    refunded: bool = False
