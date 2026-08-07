import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Header, HTTPException, Request, Response

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

EVENT_COLLECTION_SUCCESS = "collection.success"
EVENT_COLLECTION_FAILED = "collection.failed"


def verify_ddin_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """HMAC-SHA256 over the raw (unparsed) request body, per DDIN's documented
    node.js verification snippet. Constant-time compare to avoid a timing
    side-channel. False if no secret is configured - never treat an unsigned
    deployment as trusted by default."""
    if not secret or not signature_header:
        return False
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header.strip().lower())


@router.post("/ddin")
async def ddin_webhook(
    request: Request,
    x_moola_signature: str = Header(..., alias="X-Moola-Signature"),
    x_moola_event: str = Header(..., alias="X-Moola-Event"),
):
    raw_body = await request.body()

    if not verify_ddin_signature(raw_body, x_moola_signature, settings.ddin_webhook_secret):
        logger.warning("ddin_webhook_bad_signature", extra={"event": x_moola_event})
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        payload = json.loads(raw_body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc

    data = payload.get("data") or {}
    # DDIN correlates a webhook back to our request via data.referenceId, which
    # is the same value we sent as `referenceId` when initiating the collection
    # - the orchestrator always sets that to our own idempotency_key (see
    # DDINCollectionProvider.collect / CollectionOrchestrator._run_sequence), so
    # this doubles as our transaction_logs lookup key.
    reference_id = data.get("referenceId")
    orchestrator = request.app.state.orchestrator

    if x_moola_event == EVENT_COLLECTION_SUCCESS:
        if not reference_id:
            raise HTTPException(status_code=400, detail="Missing data.referenceId")
        provider_transaction_reference = (
            data.get("transactionId") or data.get("operationReferenceId") or reference_id
        )
        await orchestrator.resolve_provider_success(
            reference_id, str(provider_transaction_reference)
        )
    elif x_moola_event == EVENT_COLLECTION_FAILED:
        if not reference_id:
            raise HTTPException(status_code=400, detail="Missing data.referenceId")
        reason = data.get("message") or data.get("status") or "DDIN reported collection.failed"
        await orchestrator.resolve_provider_failure(reference_id, str(reason))
    else:
        # disbursement.completed / disbursement.failed / anything else - no
        # disbursement flow exists yet in this codebase (see frontend's
        # "Disbursement API docs are coming soon"). Acknowledge with 200 so
        # DDIN doesn't retry forever; just log it for now.
        logger.info(
            "ddin_webhook_unhandled_event",
            extra={"event": x_moola_event, "reference_id": reference_id},
        )

    return Response(status_code=200)
