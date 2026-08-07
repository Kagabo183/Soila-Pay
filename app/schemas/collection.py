from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field, condecimal


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


CollectionStatus = Literal["SUCCESS", "PENDING", "FAILED_REFUNDED", "FAILED_REFUND_ERROR"]


class CollectionResponse(BaseModel):
    status: CollectionStatus
    idempotency_key: str
    fineract_savings_account_id: str
    debit_transaction_id: Optional[str] = None
    refund_transaction_id: Optional[str] = None
    provider_transaction_reference: Optional[str] = None
    amount_rwf: Decimal
    message: str
    refunded: bool = False
