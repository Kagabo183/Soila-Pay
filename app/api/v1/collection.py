import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.api.v1.deps import require_admin
from app.db.transaction_log_repo import STATUS_DEBITED, STATUS_FAILED_REFUND_ERROR
from app.exceptions import (
    FineractError,
    IdempotencyConflictError,
    ManualReconciliationRequiredError,
)
from app.schemas.collection import CollectionRequest, CollectionResponse
from app.schemas.dashboard import CollectionTransactionOut, PaginatedTransactions

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/collect", response_model=None)
async def collect_payment(
    body: CollectionRequest,
    request: Request,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1),
    integrator_key: str = Header(..., alias="Integrator-Key", min_length=1),
) -> CollectionResponse | JSONResponse:
    integrator = await request.app.state.integrator_repo.get_by_api_key(integrator_key)
    if integrator is None:
        raise HTTPException(status_code=401, detail="Unknown Integrator-Key")
    if not integrator["is_active"]:
        raise HTTPException(status_code=403, detail="Integrator account is disabled")

    orchestrator = request.app.state.orchestrator

    try:
        response = await orchestrator.execute_collection(body, idempotency_key, integrator=integrator)
    except IdempotencyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ManualReconciliationRequiredError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FineractError as exc:
        raise HTTPException(status_code=502, detail=f"Fineract debit failed: {exc}") from exc

    if response.status == STATUS_FAILED_REFUND_ERROR:
        # A true system alert state (refund itself failed) - return the full
        # response body (not nested under "detail") with a 500 so clients can
        # still branch on `status` the same way they would for a 200 response.
        return JSONResponse(status_code=500, content=response.model_dump(mode="json"))

    if response.status == "PENDING":
        # DDIN acknowledged but hasn't resolved the collection yet - mirrors
        # DDIN's own 202 for collection/initiate. Resolves later via
        # collection.success/collection.failed webhook - see webhooks.py.
        return JSONResponse(status_code=202, content=response.model_dump(mode="json"))

    return response


def _transaction_out(row: dict) -> CollectionTransactionOut:
    return CollectionTransactionOut(
        id=str(row["id"]),
        idempotency_key=row["idempotency_key"],
        fineract_savings_account_id=row["fineract_savings_account_id"],
        provider=row["provider"],
        customer_account_number=row["customer_account_number"],
        customer_name=row["customer_name"],
        amount_rwf=row["amount_rwf"],
        status=row["status"],
        debit_transaction_id=row["fineract_debit_txn_id"],
        refund_transaction_id=row["fineract_refund_txn_id"],
        provider_transaction_reference=row["provider_transaction_reference"],
        created_at=row["created_at"].isoformat(),
    )


@router.get("/transactions", response_model=PaginatedTransactions, dependencies=[Depends(require_admin)])
async def list_transactions(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=200, alias="pageSize"),
    status: Optional[list[str]] = Query(default=None),
    channel: Optional[list[str]] = Query(default=None),
) -> PaginatedTransactions:
    """Admin-only view across every integrator's transactions - powers the
    Provider Dashboard's Recent Collections table. `channel` is accepted as an
    alias for provider filtering (MTN/AIRTEL) - the frontend's Provider type
    predates this real backend and calls it "channel"; there's no separate
    channel concept here, a collection's provider IS its channel."""
    repo = request.app.state.transaction_log_repo
    rows, total = await repo.list_paginated(page, page_size, status=status, provider=channel)
    items = [_transaction_out(row) for row in rows]
    return PaginatedTransactions(items=items, total=total, page=page, page_size=page_size)


@router.get("/transactions/{idempotency_key}", response_model=CollectionTransactionOut)
async def get_transaction(
    idempotency_key: str,
    request: Request,
    integrator_key: str = Header(..., alias="Integrator-Key", min_length=1),
) -> CollectionTransactionOut:
    """Lets an integrator poll the status of their own PENDING collection
    (DDIN's async collection.success/failed webhook is the primary
    resolution path - see webhooks.py - but a caller who can't run a
    reachable webhook endpoint yet, e.g. during local development, needs
    something to poll instead). Scoped to the calling integrator's own
    transactions only - returns 404, not 403, for another integrator's
    transaction, so this can't be used to probe which idempotency keys exist.

    If the row is DEBITED (debited, awaiting the provider's async outcome),
    this transparently asks the provider for its real current status first -
    see CollectionOrchestrator.sync_with_provider. So if DDIN already
    resolved this collection but its webhook never reached us, viewing the
    transaction here is enough to pick up the real outcome, not just replay
    a stale local guess."""
    integrator = await request.app.state.integrator_repo.get_by_api_key(integrator_key)
    if integrator is None:
        raise HTTPException(status_code=401, detail="Unknown Integrator-Key")

    repo = request.app.state.transaction_log_repo
    row = await repo.get_by_idempotency_key(idempotency_key)
    if row is None or row["integrator_id"] != integrator["id"]:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if row["status"] == STATUS_DEBITED:
        await request.app.state.orchestrator.sync_with_provider(idempotency_key)
        row = await repo.get_by_idempotency_key(idempotency_key)

    return _transaction_out(row)


@router.post("/transactions/{idempotency_key}/sync", response_model=CollectionTransactionOut)
async def sync_transaction(
    idempotency_key: str,
    request: Request,
    integrator_key: str = Header(..., alias="Integrator-Key", min_length=1),
) -> CollectionTransactionOut:
    """Explicitly re-checks the provider's real status for this transaction
    right now and reconciles our local record to match - the same
    reconciliation GET /transactions/{key} runs automatically for a DEBITED
    row, exposed directly so a caller can trigger it on demand (e.g. a
    "Check DDIN status" button) rather than only on the next read. A no-op
    (returns the current record unchanged) if the row isn't DEBITED or the
    provider has no record of it yet."""
    integrator = await request.app.state.integrator_repo.get_by_api_key(integrator_key)
    if integrator is None:
        raise HTTPException(status_code=401, detail="Unknown Integrator-Key")

    repo = request.app.state.transaction_log_repo
    row = await repo.get_by_idempotency_key(idempotency_key)
    if row is None or row["integrator_id"] != integrator["id"]:
        raise HTTPException(status_code=404, detail="Transaction not found")

    await request.app.state.orchestrator.sync_with_provider(idempotency_key)
    row = await repo.get_by_idempotency_key(idempotency_key)
    return _transaction_out(row)
