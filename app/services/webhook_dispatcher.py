import asyncio
import hashlib
import hmac
import json
import logging

import httpx

logger = logging.getLogger(__name__)

EVENT_COLLECTION_SUCCESS = "collection.success"
EVENT_COLLECTION_FAILED = "collection.failed"
EVENT_COLLECTION_PENDING = "collection.pending"


def _build_payload(event: str, row: dict) -> dict:
    return {
        "event": event,
        "idempotency_key": row.get("idempotency_key"),
        "status": row.get("status"),
        "provider": row.get("provider"),
        "customer_account_number": row.get("customer_account_number"),
        "customer_name": row.get("customer_name"),
        "amount_rwf": float(row["amount_rwf"]) if row.get("amount_rwf") is not None else None,
        "provider_transaction_reference": row.get("provider_transaction_reference"),
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
    }


async def _deliver_one(callback_url: str, secret: str, event: str, payload: dict) -> None:
    body = json.dumps(payload, default=str).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                callback_url,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Soila-Signature": f"sha256={sig}",
                    "X-Soila-Event": event,
                },
            )
        logger.info(
            "webhook_delivered",
            extra={"url": callback_url, "event": event, "status": resp.status_code},
        )
    except Exception as exc:
        logger.warning(
            "webhook_delivery_failed",
            extra={"url": callback_url, "event": event, "error": str(exc)},
        )


async def dispatch(webhook_rows: list[dict], event: str, row: dict) -> None:
    payload = _build_payload(event, row)
    for webhook in webhook_rows:
        asyncio.create_task(
            _deliver_one(webhook["callback_url"], webhook["secret"], event, payload)
        )
