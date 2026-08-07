import logging

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app.db.transaction_log_repo import STATUS_FAILED_REFUND_ERROR
from app.exceptions import (
    FineractError,
    IdempotencyConflictError,
    ManualReconciliationRequiredError,
)
from app.schemas.utility import UtilityPurchaseRequest, UtilityPurchaseResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/purchase", response_model=None)
async def purchase_utility(
    body: UtilityPurchaseRequest,
    request: Request,
    idempotency_key: str = Header(..., alias="Idempotency-Key", min_length=1),
) -> UtilityPurchaseResponse | JSONResponse:
    orchestrator = request.app.state.orchestrator

    try:
        response = await orchestrator.execute_purchase(body, idempotency_key)
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

    return response
