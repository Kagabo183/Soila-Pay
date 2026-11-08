"""
Collections (customers paying in: cards first, plus MTN MoMo) and
disbursements (payouts out to MTN MoMo), both through the LMBTech gateway.
One table (payments, `direction` column), one status checker, one ledger.

Trust model: LMBTech's callback is NOT signed, so its body is never trusted
to change a status. A callback only tells us *which* row to re-check; the
status always comes from an authenticated GET to the gateway (sync()). The
same sync() runs from a background loop (callbacks can't reach localhost)
and whenever someone views a pending row.

Money: every row freezes fee (charged to the integrator), LMBTech's cost and
the margin (fee - cost) at creation, so rate changes never rewrite history.
An integrator's available balance = collected - collection fees - payouts -
payout fees (pending payouts included), and payouts can't exceed it.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from app.config import Settings
from app.db.integrator_repo import IntegratorRepo
from app.db.integrator_webhook_repo import IntegratorWebhookRepo
from app.db.payment_repo import TERMINAL_STATUSES, PaymentRepo
from app.schemas.payment import CARD_CHANNELS, DisbursementCreate, PaymentCreate
from app.services import webhook_dispatcher
from app.services.lmbtech_client import LMBTechClient, LMBTechError

logger = logging.getLogger(__name__)

COLLECTION = "COLLECTION"
DISBURSEMENT = "DISBURSEMENT"

EVENTS = {
    (COLLECTION, True): "payment.success",
    (COLLECTION, False): "payment.failed",
    (DISBURSEMENT, True): "disbursement.success",
    (DISBURSEMENT, False): "disbursement.failed",
}

DEFAULT_GATEWAY_COST = Decimal("5.00")  # LMBTech's cut on collections, confirmed 2026-11-08
DEFAULT_PAYMENT_FEE = Decimal("6.00")
DEFAULT_PAYOUT_COST = Decimal("5.00")  # assumed same as collections until LMBTech confirms
DEFAULT_PAYOUT_FEE = Decimal("6.00")
_CENT = Decimal("0.01")


class DuplicateReferenceError(Exception):
    pass


class InsufficientBalanceError(Exception):
    def __init__(self, needed: Decimal, available: Decimal):
        self.needed = needed
        self.available = available
        super().__init__(
            f"Not enough balance for this payout: needs {needed:,.0f} RWF (amount + fee), "
            f"available {available:,.0f} RWF"
        )


def new_reference(prefix: str = "SP") -> str:
    return f"{prefix}-{datetime.now():%Y%m%d}-{secrets.token_hex(4).upper()}"


@dataclass(frozen=True)
class Pricing:
    gateway_cost_percentage: Decimal  # LMBTech's cut on collections
    default_fee_percentage: Decimal  # integrators' default collection fee
    payout_cost_percentage: Decimal  # LMBTech's cut on payouts
    payout_default_fee_percentage: Decimal  # integrators' default payout fee

    def cost(self, direction: str) -> Decimal:
        return self.payout_cost_percentage if direction == DISBURSEMENT else self.gateway_cost_percentage

    def default_fee(self, direction: str) -> Decimal:
        return self.payout_default_fee_percentage if direction == DISBURSEMENT else self.default_fee_percentage


@dataclass(frozen=True)
class PaymentMoney:
    fee_percentage: Optional[Decimal]
    fee_amount_rwf: Optional[Decimal]
    gateway_cost_percentage: Decimal
    gateway_cost_amount_rwf: Decimal
    margin_amount_rwf: Optional[Decimal]


def compute_money(amount: Decimal, fee_percentage: Optional[Decimal], cost_percentage: Decimal) -> PaymentMoney:
    """fee (charged to the integrator) - LMBTech cost = margin. Console
    transactions (no integrator) have no fee and no margin - only the cost."""
    cost = (amount * cost_percentage / 100).quantize(_CENT, ROUND_HALF_UP)
    if fee_percentage is None:
        return PaymentMoney(None, None, cost_percentage, cost, None)
    fee = (amount * fee_percentage / 100).quantize(_CENT, ROUND_HALF_UP)
    return PaymentMoney(fee_percentage, fee, cost_percentage, cost, fee - cost)


_SETTING_KEYS = {
    "gateway_cost_percentage": ("lmbtech_cost_percentage", DEFAULT_GATEWAY_COST),
    "default_fee_percentage": ("payment_fee_percentage", DEFAULT_PAYMENT_FEE),
    "payout_cost_percentage": ("lmbtech_payout_cost_percentage", DEFAULT_PAYOUT_COST),
    "payout_default_fee_percentage": ("payout_fee_percentage", DEFAULT_PAYOUT_FEE),
}


class PaymentService:
    def __init__(
        self,
        settings: Settings,
        repo: PaymentRepo,
        gateway: LMBTechClient,
        webhook_repo: IntegratorWebhookRepo,
        integrator_repo: IntegratorRepo,
    ):
        self._settings = settings
        self._repo = repo
        self._gateway = gateway
        self._webhook_repo = webhook_repo
        self._integrator_repo = integrator_repo
        # One payout at a time per integrator, so two concurrent payouts can't
        # both pass the balance check. Per-process: the API runs one worker
        # (deploy/soila-pay-api.service); revisit before scaling out.
        self._payout_locks: dict[int, asyncio.Lock] = defaultdict(asyncio.Lock)

    # -- Pricing -------------------------------------------------------------

    async def pricing(self) -> Pricing:
        values = {}
        for field, (key, default) in _SETTING_KEYS.items():
            raw = await self._integrator_repo.get_setting(key)
            values[field] = Decimal(raw) if raw else default
        return Pricing(**values)

    async def set_pricing(self, **values: Decimal) -> Pricing:
        for field, value in values.items():
            key, _ = _SETTING_KEYS[field]
            await self._integrator_repo.set_setting(key, f"{value:.2f}")
        return await self.pricing()

    def fee_for(self, integrator: Optional[dict], pricing: Pricing, direction: str = COLLECTION) -> Optional[Decimal]:
        if integrator is None:
            return None
        column = "payout_fee_percentage" if direction == DISBURSEMENT else "payment_fee_percentage"
        override = integrator.get(column)
        return Decimal(str(override)) if override is not None else pricing.default_fee(direction)

    async def available_balance(self, integrator_id: int) -> Decimal:
        return await self._repo.integrator_balance(integrator_id)

    @property
    def gateway_configured(self) -> bool:
        return self._gateway.configured

    @property
    def payouts_configured(self) -> bool:
        return self._gateway.configured and bool(self._settings.lmbtech_account_email)

    def _callback_url(self) -> str:
        return f"{self._settings.public_api_base_url.rstrip('/')}/api/v1/payments/callback/lmbtech"

    def _card_return_url(self, reference_id: str) -> str:
        return f"{self._settings.frontend_base_url.rstrip('/')}/pay/return?ref={reference_id}"

    # -- Collections ---------------------------------------------------------

    async def create(self, body: PaymentCreate, integrator: Optional[dict]) -> dict:
        reference_id = body.reference_id or new_reference("SP")
        if await self._repo.get_by_reference(reference_id):
            raise DuplicateReferenceError(f"Reference {reference_id} was already used")

        method = "CARD" if body.channel in CARD_CHANNELS else "MOMO"
        channel = "MTN" if body.channel == "MTN_MOMO" else body.channel
        amount = Decimal(body.amount_rwf)
        pricing = await self.pricing()
        money = compute_money(amount, self.fee_for(integrator, pricing), pricing.gateway_cost_percentage)

        await self._repo.create(
            reference_id=reference_id,
            direction=COLLECTION,
            integrator_id=integrator["id"] if integrator else None,
            method=method,
            channel=channel,
            amount_rwf=amount,
            money=money,
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
            return await self._fail(reference_id, exc.message)
        return await self._apply(reference_id, result)

    # -- Disbursements -------------------------------------------------------

    async def create_disbursement(self, body: DisbursementCreate, integrator: Optional[dict]) -> dict:
        reference_id = body.reference_id or new_reference("SD")
        if await self._repo.get_by_reference(reference_id):
            raise DuplicateReferenceError(f"Reference {reference_id} was already used")

        amount = Decimal(body.amount_rwf)
        pricing = await self.pricing()
        money = compute_money(amount, self.fee_for(integrator, pricing, DISBURSEMENT), pricing.payout_cost_percentage)

        lock = self._payout_locks[integrator["id"]] if integrator else asyncio.Lock()
        async with lock:
            if integrator is not None:
                needed = amount + (money.fee_amount_rwf or Decimal(0))
                available = await self._repo.integrator_balance(integrator["id"])
                if needed > available:
                    raise InsufficientBalanceError(needed, available)
            await self._repo.create(
                reference_id=reference_id,
                direction=DISBURSEMENT,
                integrator_id=integrator["id"] if integrator else None,
                method="MOMO",
                channel="MTN",
                amount_rwf=amount,
                money=money,
                customer_name=body.recipient_name,
                customer_email=body.recipient_email or "",
                customer_phone=body.recipient_phone,
                description=body.description or "payout",
                return_url=None,
                is_test=self._settings.lmbtech_test_mode,
            )

        try:
            result = await self._gateway.payout(
                reference_id=reference_id,
                amount=amount,
                recipient_name=body.recipient_name,
                recipient_phone=body.recipient_phone,
                description=body.description or "payout",
                callback_url=self._callback_url(),
            )
        except LMBTechError as exc:
            return await self._fail(reference_id, exc.message)
        return await self._apply(reference_id, result)

    # -- Shared --------------------------------------------------------------

    async def _fail(self, reference_id: str, message: str) -> dict:
        await self._repo.update_gateway_state(reference_id, status="FAILED", status_message=message)
        row = await self._repo.get_by_reference(reference_id)
        await self._notify(row)
        return row

    async def _apply(self, reference_id: str, result) -> dict:
        changed = await self._repo.update_gateway_state(
            reference_id,
            status=result.status,
            status_message=result.message,
            gateway_transaction_id=result.transaction_id,
            redirect_url=getattr(result, "redirect_url", None),
        )
        row = await self._repo.get_by_reference(reference_id)
        if changed:
            await self._notify(row)
        return row

    async def sync(self, reference_id: str) -> Optional[dict]:
        """Ask the gateway for the real status and record it. Safe to call
        repeatedly; a no-op once the row is final."""
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
        event = EVENTS[(row.get("direction") or COLLECTION, row["status"] == "SUCCESS")]
        try:
            hooks = await self._webhook_repo.list_active_for_event(row["integrator_id"], event)
            if hooks:
                await webhook_dispatcher.dispatch_payment(hooks, event, row)
        except Exception:
            logger.exception("payment_webhook_dispatch_failed", extra={"reference_id": row["reference_id"]})
