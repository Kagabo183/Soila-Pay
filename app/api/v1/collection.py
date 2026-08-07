import logging

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app.db.transaction_log_repo import STATUS_FAILED_REFUND_ERROR
from app.exceptions import (
    FineractError,
    IdempotencyConflictError,
    ManualReconciliationRequiredError,
)
from app.schemas.collection import CollectionRequest, CollectionResponse

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

    # A sandbox key always runs against the safe dummy provider, regardless of
    # the globally configured collection provider - see
    # IntegratorRepo.get_by_api_key's key_mode and main.py's two orchestrators.
    # This is what lets an integrator safely test the full debit -> collect ->
    # refund flow before ever touching a production key.
    orchestrator = (
        request.app.state.sandbox_orchestrator
        if integrator["key_mode"] == "sandbox"
        else request.app.state.orchestrator
    )

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
