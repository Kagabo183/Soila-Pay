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


class AdminTransactionOut(CollectionTransactionOut):
    """Admin-only view of a transaction: everything an integrator sees, PLUS
    the money breakdown (what we charged, what DDIN cost us, what we kept).

    Deliberately a SEPARATE schema from CollectionTransactionOut rather than
    extra fields on it. That base schema is also returned by the
    integrator-facing endpoints (integrator_portal.py's GET /transactions and
    collection.py's GET /transactions/{key}), so putting ddin_cost_* or
    margin_* on it would expose our provider cost and our per-transaction
    margin to every integrator -- our own commercial terms, leaked to the
    customers they're negotiated with. Admin routes use this subclass; the
    integrator routes keep the base and their responses are byte-identical to
    before.

    All money/percentage fields are Optional: the fee columns were added to
    transaction_logs after the table already had rows (see db_init/
    002_integrators_and_fees.sql), so older transactions have NULLs -- 14 of
    the 37 rows in production at the time of writing. The UI renders those as
    "-" rather than a misleading 0.00.

    float, not Decimal, for the same reason documented on
    CollectionTransactionOut.amount_rwf above.
    """
    integrator_id: Optional[int] = None
    integrator_name: Optional[str] = None
    # What the integrator was charged for this collection (their deduction).
    integrator_fee_percentage: Optional[float] = None
    fee_amount_rwf: Optional[float] = None
    # What DDIN charged us to move it.
    ddin_cost_percentage: Optional[float] = None
    ddin_cost_amount_rwf: Optional[float] = None
    # fee_amount_rwf - ddin_cost_amount_rwf, i.e. what Soila Pay actually kept.
    margin_amount_rwf: Optional[float] = None


class PaginatedAdminTransactions(BaseModel):
    items: list[AdminTransactionOut]
    total: int
    page: int
    page_size: int
    # Totals across every row matching the CURRENT FILTER, not just the page
    # being displayed -- a per-page sum would be meaningless for reconciliation
    # (page 1 of 4 telling you today's margin is a quarter of the real figure).
    totals: "AdminTransactionTotals"


class AdminTransactionTotals(BaseModel):
    collected_rwf: float = 0.0
    fees_rwf: float = 0.0
    ddin_cost_rwf: float = 0.0
    margin_rwf: float = 0.0
    # Only SUCCESS rows carry real money; a failed/refunded collection has no
    # margin. Surfaced so the admin can see the split rather than wonder why
    # totals don't match the row count.
    success_count: int = 0
    counted_rows: int = 0


PaginatedAdminTransactions.model_rebuild()


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
