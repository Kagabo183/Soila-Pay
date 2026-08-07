from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field, condecimal


class UtilityPurchaseRequest(BaseModel):
    fineract_savings_account_id: str = Field(..., min_length=1)
    utility_provider: Literal["REG", "WASAC"]
    meter_number: str = Field(..., min_length=5, max_length=20)
    amount_rwf: condecimal(gt=0, decimal_places=2)


PurchaseStatus = Literal["SUCCESS", "FAILED_REFUNDED", "FAILED_REFUND_ERROR"]


class UtilityPurchaseResponse(BaseModel):
    status: PurchaseStatus
    idempotency_key: str
    fineract_savings_account_id: str
    debit_transaction_id: Optional[str] = None
    refund_transaction_id: Optional[str] = None
    utility_token: Optional[str] = None
    amount_rwf: Decimal
    message: str
    refunded: bool = False
