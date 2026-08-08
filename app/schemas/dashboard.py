from typing import Optional

from pydantic import BaseModel


class CollectionTransactionOut(BaseModel):
    id: str
    idempotency_key: str
    fineract_savings_account_id: str
    provider: str
    customer_account_number: str
    customer_name: str
    # float, not Decimal: Pydantic v2 serializes Decimal to a JSON *string*
    # (to preserve precision), which silently breaks frontend code expecting
    # a number. This is a read-only reporting field - the DB column and every
    # internal balance calculation still use Decimal.
    amount_rwf: float
    status: str
    debit_transaction_id: Optional[str] = None
    refund_transaction_id: Optional[str] = None
    provider_transaction_reference: Optional[str] = None
    created_at: str


class PaginatedTransactions(BaseModel):
    items: list[CollectionTransactionOut]
    total: int
    page: int
    page_size: int


class ProviderOut(BaseModel):
    id: str
    name: str
    # Every provider here is a mobile money network (DDIN's momo/collection
    # API) - there's no bank-rail integration to report on yet, so "type" is
    # always MOBILE_MONEY. Kept as a field (not dropped) so the frontend's
    # existing Provider type doesn't need a shape change if that ever adds a
    # real bank provider.
    type: str = "MOBILE_MONEY"
    # Derived from success_rate, not a real connectivity/latency check -
    # HEALTHY >=95%, DEGRADED >=80%, DOWN otherwise. No request-timing data is
    # collected anywhere in this stack, so avg_response_ms is always 0 rather
    # than a fabricated number - see DDIN Diagnostics for real latency.
    health: str
    success_rate: float
    avg_response_ms: int = 0
    collections_today: int
    disbursements_today: int = 0  # Disbursement API not implemented yet.


class DailyVolumePoint(BaseModel):
    date: str
    collections: int
    disbursements: int = 0  # Disbursement API not implemented yet.
    failed: int
