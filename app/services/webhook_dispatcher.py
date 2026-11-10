"""Signed webhook deliveries to integrators (payment.* and disbursement.*).
Each delivery carries X-Soila-Signature: sha256=<HMAC-SHA256 of the raw body
with the subscription's secret> and X-Soila-Event."""
import asyncio
import hashlib
import hmac
import json
import logging

import httpx

logger = logging.getLogger(__name__)


def _iso(value):
    return value.isoformat() if value else None


def _build_payment_payload(event: str, row: dict) -> dict:
    return {
        "event": event,
        # Unique per event - receivers use it to ignore retried duplicates.
        "delivery_id": f"{row.get('reference_id')}:{event}",
        "reference_id": row.get("reference_id"),
        "direction": row.get("direction"),
        "status": row.get("status"),
        "method": row.get("method"),
        "channel": row.get("channel"),
        "amount_rwf": float(row["amount_rwf"]) if row.get("amount_rwf") is not None else None,
        "fee_rwf": float(row["fee_amount_rwf"]) if row.get("fee_amount_rwf") is not None else None,
        "customer_name": row.get("customer_name"),
        "gateway_transaction_id": row.get("gateway_transaction_id"),
        "message": row.get("status_message"),
        "is_test": bool(row.get("is_test")),
        "created_at": _iso(row.get("created_at")),
        "completed_at": _iso(row.get("completed_at")),
    }


# Seconds to wait before each retry: 5 attempts over ~3 minutes. An
# integrator's server that's briefly down or slow still gets the event.
RETRY_DELAYS = (5, 30, 60, 90)

# Keep references to in-flight deliveries so they aren't garbage-collected.
_tasks: set[asyncio.Task] = set()


async def _deliver_one(callback_url: str, secret: str, event: str, payload: dict) -> bool:
    """Returns True once the integrator answers 2xx. Same body (and so the
    same signature and X-Soila-Delivery id) on every attempt, so a receiver
    can safely ignore duplicates."""
    body = json.dumps(payload, default=str).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-Soila-Signature": f"sha256={sig}",
        "X-Soila-Event": event,
        "X-Soila-Delivery": payload["delivery_id"],
    }
    for attempt in range(len(RETRY_DELAYS) + 1):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(callback_url, content=body, headers=headers)
            if 200 <= resp.status_code < 300:
                logger.info("webhook_delivered", extra={"url": callback_url, "event": event, "status": resp.status_code, "attempt": attempt + 1})
                return True
            error = f"HTTP {resp.status_code}"
        except Exception as exc:
            error = exc.__class__.__name__
        logger.warning("webhook_delivery_failed", extra={"url": callback_url, "event": event, "error": error, "attempt": attempt + 1})
        if attempt < len(RETRY_DELAYS):
            await asyncio.sleep(RETRY_DELAYS[attempt])
    logger.error("webhook_gave_up", extra={"url": callback_url, "event": event, "reference_id": payload.get("reference_id")})
    return False


async def dispatch_payment(webhook_rows: list[dict], event: str, row: dict) -> None:
    payload = _build_payment_payload(event, row)
    for webhook in webhook_rows:
        task = asyncio.create_task(_deliver_one(webhook["callback_url"], webhook["secret"], event, payload))
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
