"""
Checkout payments through the LMBTech gateway (MTN MoMo + cards).

Trust model: LMBTech's callback is NOT signed, so its body is never trusted
to change a payment's status. A callback only tells us *which* payment to
re-check; the status itself always comes from an authenticated GET to the
gateway's status API (sync()). The same sync() also runs from a background
loop (callbacks can't reach localhost) and whenever someone views a pending
payment.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from app.config import Settings
from app.db.integrator_webhook_repo import IntegratorWebhookRepo
from app.db.payment_repo import TERMINAL_STATUSES, PaymentRepo
from app.schemas.payment import CARD_CHANNELS, PaymentCreate
from app.services import webhook_dispatcher
from app.services.lmbtech_client import LMBTechClient, LMBTechError

logger = logging.getLogger(__name__)

EVENT_PAYMENT_SUCCESS = "payment.success"
EVENT_PAYMENT_FAILED = "payment.failed"


class DuplicateReferenceError(Exception):
    pass


def new_reference() -> str:
    return f"SP-{datetime.now():%Y%m%d}-{secrets.token_hex(4).upper()}"


class PaymentService:
    def __init__(
        self,
        settings: Settings,
        repo: PaymentRepo,
        gateway: LMBTechClient,
        webhook_repo: IntegratorWebhookRepo,
    ):
        self._settings = settings
        self._repo = repo
        self._gateway = gateway
        self._webhook_repo = webhook_repo

    @property
    def gateway_configured(self) -> bool:
        return self._gateway.configured

    def _callback_url(self) -> str:
        return f"{self._settings.public_api_base_url.rstrip('/')}/api/v1/payments/callback/lmbtech"

    def _card_return_url(self, reference_id: str) -> str:
        return f"{self._settings.frontend_base_url.rstrip('/')}/pay/return?ref={reference_id}"

    async def create(self, body: PaymentCreate, integrator: Optional[dict]) -> dict:
        reference_id = body.reference_id or new_reference()
        if await self._repo.get_by_reference(reference_id):
            raise DuplicateReferenceError(f"Reference {reference_id} was already used")

        method = "CARD" if body.channel in CARD_CHANNELS else "MOMO"
        channel = "MTN" if body.channel == "MTN_MOMO" else body.channel
        amount = Decimal(body.amount_rwf)
        fee_pct = Decimal(str(integrator["fee_percentage"])) if integrator else None
        fee_amt = (amount * fee_pct / 100).quantize(Decimal("0.01"), ROUND_HALF_UP) if fee_pct is not None else None

        await self._repo.create(
            reference_id=reference_id,
            integrator_id=integrator["id"] if integrator else None,
            method=method,
            channel=channel,
            amount_rwf=amount,
            fee_percentage=fee_pct,
            fee_amount_rwf=fee_amt,
            customer_name=body.customer_name,
            customer_email=body.customer_email,
            customer_phone=body.customer_phone,
            description=body.description or "payment",
            return_url=str(body.return_url) if body.return_url else None,
            is_test=self._settings.lmbtech_test_mode,
        )

        try:
            result = await self._gateway.pay(
                method=method,
                reference_id=reference_id,
                amount=amount,
                name=body.customer_name,
                email=body.customer_email,
                phone=body.customer_phone,
                description=body.description or "payment",
                callback_url=self._callback_url(),
                card_redirect_url=self._card_return_url(reference_id),
            )
        except LMBTechError as exc:
            await self._repo.update_gateway_state(reference_id, status="FAILED", status_message=exc.message)
            row = await self._repo.get_by_reference(reference_id)
            await self._notify(row)
            return row

        changed = await self._repo.update_gateway_state(
            reference_id,
            status=result.status,
            status_message=result.message,
            gateway_transaction_id=result.transaction_id,
            redirect_url=result.redirect_url,
        )
        row = await self._repo.get_by_reference(reference_id)
        if changed:
            await self._notify(row)
        return row

    async def sync(self, reference_id: str) -> Optional[dict]:
        """Ask the gateway for the real status and record it. Safe to call
        repeatedly; a no-op once the payment is final."""
        row = await self._repo.get_by_reference(reference_id)
        if row is None or row["status"] in TERMINAL_STATUSES:
            return row
        try:
            result = await self._gateway.get_status(reference_id)
        except LMBTechError as exc:
            logger.warning("payment_sync_failed", extra={"reference_id": reference_id, "error": exc.message})
            return row
        if result is None:
            return row
        changed = await self._repo.update_gateway_state(
            reference_id,
            status=result.status,
            status_message=result.message,
            gateway_transaction_id=result.transaction_id,
        )
        row = await self._repo.get_by_reference(reference_id)
        if changed:
            logger.info("payment_status_changed", extra={"reference_id": reference_id, "status": row["status"]})
            await self._notify(row)
        return row

    async def _notify(self, row: Optional[dict]) -> None:
        if not row or not row.get("integrator_id") or row["status"] not in ("SUCCESS", "FAILED", "CANCELLED"):
            return
        event = EVENT_PAYMENT_SUCCESS if row["status"] == "SUCCESS" else EVENT_PAYMENT_FAILED
        try:
            hooks = await self._webhook_repo.list_active_for_event(row["integrator_id"], event)
            if hooks:
                await webhook_dispatcher.dispatch_payment(hooks, event, row)
        except Exception:
            logger.exception("payment_webhook_dispatch_failed", extra={"reference_id": row["reference_id"]})
