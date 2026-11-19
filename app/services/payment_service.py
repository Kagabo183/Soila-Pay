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
from app.services import sandbox, webhook_dispatcher
from app.services import kitovu_client
from app.services.kitovu_client import KitovuClient, KitovuError
from app.services.lmbtech_client import GatewayResult, LMBTechClient, LMBTechError

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
DEFAULT_MOMO_COST = Decimal("3.00")  # Kitovu Pay, confirmed on its fee quote (3 RWF per 100)
DEFAULT_MOMO_PAYOUT_COST_RWF = Decimal("400.00")  # Kitovu Pay: flat per payout, any amount (UAT quote)
_CENT = Decimal("0.01")


class DuplicateReferenceError(Exception):
    pass


class ChannelUnavailableError(Exception):
    """The chosen payment method isn't switched on (e.g. Airtel without Kitovu)."""


class CashoutSetupError(Exception):
    """A cash-out can't be made yet (missing phone/bank) or a bank cash-out
    can't be settled. The message is shown to the user as-is."""


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
    gateway_cost_percentage: Decimal  # LMBTech's cut on card collections
    default_fee_percentage: Decimal  # integrators' default collection fee
    payout_cost_percentage: Decimal  # LMBTech's cut on payouts
    payout_default_fee_percentage: Decimal  # integrators' default payout fee
    momo_cost_percentage: Decimal = DEFAULT_MOMO_COST  # Kitovu's cut on MoMo collections
    momo_payout_cost_rwf: Decimal = DEFAULT_MOMO_PAYOUT_COST_RWF  # Kitovu's flat fee per payout

    @property
    def collection_cost_floor(self) -> Decimal:
        """A collection fee below this loses money on at least one gateway."""
        return max(self.gateway_cost_percentage, self.momo_cost_percentage)

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


def compute_money_flat_cost(amount: Decimal, fee_percentage: Optional[Decimal], cost_rwf: Decimal) -> PaymentMoney:
    """Like compute_money, for a gateway that charges a fixed amount (Kitovu
    payouts: 400 RWF whatever the size). The % is kept for display only."""
    cost = cost_rwf.quantize(_CENT, ROUND_HALF_UP)
    pct = (cost * 100 / amount).quantize(_CENT, ROUND_HALF_UP) if amount else Decimal(0)
    if fee_percentage is None:
        return PaymentMoney(None, None, pct, cost, None)
    fee = (amount * fee_percentage / 100).quantize(_CENT, ROUND_HALF_UP)
    return PaymentMoney(fee_percentage, fee, pct, cost, fee - cost)


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
    "momo_cost_percentage": ("kitovu_cost_percentage", DEFAULT_MOMO_COST),
    "momo_payout_cost_rwf": ("kitovu_payout_cost_rwf", DEFAULT_MOMO_PAYOUT_COST_RWF),
}


class PaymentService:
    def __init__(
        self,
        settings: Settings,
        repo: PaymentRepo,
        gateway: LMBTechClient,
        webhook_repo: IntegratorWebhookRepo,
        integrator_repo: IntegratorRepo,
        kitovu: Optional[KitovuClient] = None,
        kitovu_test: Optional[KitovuClient] = None,
    ):
        self._settings = settings
        self._repo = repo
        self._gateway = gateway
        # MoMo collections go to Kitovu Pay when MOMO_GATEWAY=kitovu (cards
        # and payouts stay on LMBTech).
        self._kitovu = kitovu
        # Kitovu's TEST gateway: admin "Kitovu test" only, recorded as test money.
        self._kitovu_test = kitovu_test
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

    @staticmethod
    def is_sandbox(integrator: Optional[dict]) -> bool:
        """Sandbox = simulated by Soila Pay, never sent to LMBTech.
        API calls: the key decides (sandbox key -> sandbox, production key ->
        live). Portal sessions: the account mode decides (Test Mode ->
        sandbox). The admin console (no integrator) is always live."""
        if integrator is None:
            return False
        if integrator.get("key_mode") in ("sandbox", "production"):
            return integrator["key_mode"] == "sandbox"
        return integrator.get("account_mode") != "PRODUCTION"

    def is_test_for(self, sandboxed: bool) -> bool:
        return sandboxed or self._settings.lmbtech_test_mode

    async def available_balance(self, integrator: dict, *, is_test: Optional[bool] = None) -> Decimal:
        """Balance in one ledger - by default the integrator's current mode
        (sandbox money for sandbox, real money for live). Never mixed."""
        if is_test is None:
            is_test = self.is_test_for(self.is_sandbox(integrator))
        return await self._repo.integrator_balance(integrator["id"], is_test=is_test)

    @property
    def momo_via_kitovu(self) -> bool:
        return (
            self._settings.momo_gateway == "kitovu"
            and getattr(self, "_kitovu", None) is not None
            and self._kitovu.configured
        )

    @property
    def kitovu_test_available(self) -> bool:
        kv = getattr(self, "_kitovu_test", None)
        return kv is not None and kv.configured

    def _kitovu_for(self, test: bool) -> Optional[KitovuClient]:
        return getattr(self, "_kitovu_test", None) if test else getattr(self, "_kitovu", None)

    def _kitovu_callback_url(self) -> str:
        return f"{self._settings.public_api_base_url.rstrip('/')}/api/v1/payments/callback/kitovu"

    async def _new_kitovu_external_id(self, *, payout: bool = False) -> str:
        """Kitovu wants a unique externalId: 6 digits for a collection, 7 for
        a disbursement."""
        import secrets

        low = 1_000_000 if payout else 100_000
        for _ in range(20):
            candidate = str(low + secrets.randbelow(9 * low))
            if not await self._repo.external_id_taken(kitovu_client.GATEWAY, candidate):
                return candidate
        raise KitovuError("Could not allocate a Kitovu reference - try again")

    async def momo_lookup(
        self, phone: str, amount_rwf: int, integrator: Optional[dict], *, kitovu_test: bool = False, sandbox_only: bool = False
    ) -> dict:
        """Confirm step before a MoMo charge: the wallet's registered name and
        the fee, like Kitovu's own "New Collection" screen. Never fails the
        checkout - if a lookup can't be done, verified is False."""
        out = {"phone": phone, "account_name": None, "verified": False, "amount_rwf": amount_rwf,
               "customer_fee_rwf": 0.0, "total_to_pay_rwf": float(amount_rwf), "gateway": "LMBTECH"}
        if kitovu_test and not self.kitovu_test_available:
            raise ChannelUnavailableError("Kitovu test is not set up - add KITOVUPAY_TEST_API_KEY / KITOVUPAY_TEST_API_SECRET")
        if not kitovu_test and (sandbox_only or self.is_sandbox(integrator)):
            return {**out, "account_name": "Test Customer", "verified": True, "gateway": sandbox.GATEWAY}
        if not kitovu_test and not self.momo_via_kitovu:
            return out  # LMBTech has no number lookup
        kv = self._kitovu_for(kitovu_test)
        out["gateway"] = kitovu_client.GATEWAY
        try:
            name = await kv.verify_number(phone)
            out.update(account_name=name, verified=bool(name))
        except KitovuError as exc:
            logger.warning("kitovu_lookup_failed", extra={"error": exc.message})
        try:
            quote = await kv.fee(Decimal(amount_rwf), phone, callback_url=self._kitovu_callback_url())
            fee = float(quote.get("subscriber_charges") or 0)
            out.update(customer_fee_rwf=fee, total_to_pay_rwf=float(quote.get("total_subscriber_amount_to_pay") or amount_rwf + fee))
        except KitovuError as exc:
            logger.warning("kitovu_fee_quote_failed", extra={"error": exc.message})
        return out

    @property
    def gateway_configured(self) -> bool:
        return self._gateway.configured

    @property
    def payouts_configured(self) -> bool:
        return self.momo_via_kitovu or (self._gateway.configured and bool(self._settings.lmbtech_account_email))

    def _callback_url(self) -> str:
        return f"{self._settings.public_api_base_url.rstrip('/')}/api/v1/payments/callback/lmbtech"

    def _card_return_url(self, reference_id: str) -> str:
        return f"{self._settings.frontend_base_url.rstrip('/')}/pay/return?ref={reference_id}"

    # -- Collections ---------------------------------------------------------

    async def create(
        self, body: PaymentCreate, integrator: Optional[dict], *, sandbox_only: bool = False, kitovu_test: bool = False
    ) -> dict:
        """sandbox_only: the Test Lab - always simulated, whatever the account
        or console mode, so a test never charges anyone. kitovu_test: admin
        Kitovu test - a real request to Kitovu's TEST gateway (no real money)."""
        reference_id = body.reference_id or new_reference("SP")
        if await self._repo.get_by_reference(reference_id):
            raise DuplicateReferenceError(f"Reference {reference_id} was already used")

        method = "CARD" if body.channel in CARD_CHANNELS else "MOMO"
        channel = {"MTN_MOMO": "MTN", "AIRTEL_MONEY": "AIRTEL"}.get(body.channel, body.channel)
        amount = Decimal(body.amount_rwf)
        pricing = await self.pricing()
        if kitovu_test and (method != "MOMO" or not self.kitovu_test_available):
            raise ChannelUnavailableError("Kitovu test is for MTN / Airtel only, and needs the Kitovu test keys")
        sandboxed = not kitovu_test and (sandbox_only or self.is_sandbox(integrator))
        via_kitovu = kitovu_test or (not sandboxed and method == "MOMO" and self.momo_via_kitovu)
        kv = self._kitovu_for(kitovu_test)
        if channel == "AIRTEL" and not sandboxed and not via_kitovu:
            raise ChannelUnavailableError("Airtel Money is not available yet - use MTN MoMo or a card")
        # Each gateway's own cut: Kitovu for mobile money, LMBTech otherwise.
        cost = pricing.momo_cost_percentage if via_kitovu else pricing.gateway_cost_percentage
        money = compute_money(amount, self.fee_for(integrator, pricing), cost)
        external_id = await self._new_kitovu_external_id() if via_kitovu else None
        # Kitovu's UAT gateway moves no real money - record it as test money.
        is_test = kitovu_test or self.is_test_for(sandboxed) or (via_kitovu and kv.is_uat)

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
            is_test=is_test,
            gateway=sandbox.GATEWAY if sandboxed else (kitovu_client.GATEWAY if via_kitovu else "LMBTECH"),
            gateway_external_id=external_id,
        )

        if via_kitovu:
            # Kitovu wants the wallet's registered name as the sender name.
            try:
                payer_name = await kv.verify_number(body.customer_phone) or body.customer_name
            except KitovuError:
                payer_name = body.customer_name
            try:
                result = await kv.collect(
                    external_id=external_id,
                    amount=amount,
                    phone=body.customer_phone,
                    name=payer_name,
                    description=body.description or "payment",
                    callback_url=self._kitovu_callback_url(),
                )
            except KitovuError as exc:
                logger.warning("kitovu_collection_refused", extra={"reference_id": reference_id, "error": exc.message})
                return await self._fail(reference_id, exc.message)
            return await self._apply(reference_id, result)

        if sandboxed:
            # Card: Soila Pay's sandbox card page decides. MoMo: settles a few
            # seconds later by the test phone number (see app/services/sandbox.py).
            redirect = f"{self._settings.frontend_base_url.rstrip('/')}/pay/sandbox?ref={reference_id}" if method == "CARD" else None
            await self._repo.set_pending_details(
                reference_id,
                status_message="Sandbox: waiting for the test card page" if redirect else "Sandbox: waiting for the customer to approve",
                redirect_url=redirect,
            )
            return await self._repo.get_by_reference(reference_id)

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

    async def create_disbursement(
        self, body: DisbursementCreate, integrator: Optional[dict], *, is_cashout: bool = False, kitovu_test: bool = False
    ) -> dict:
        if kitovu_test and not self.kitovu_test_available:
            raise ChannelUnavailableError("Kitovu test is not set up - add the Kitovu test keys")
        sandboxed = not kitovu_test and self.is_sandbox(integrator)
        via_kitovu = kitovu_test or (not sandboxed and self.momo_via_kitovu)
        kv = self._kitovu_for(kitovu_test)
        airtel = kitovu_client.rail_for(body.recipient_phone) == "airtel"
        if airtel and not sandboxed and not via_kitovu:
            raise ChannelUnavailableError("Airtel payouts are not available yet - use an MTN number")
        reference_id = body.reference_id or new_reference("SC" if is_cashout else "SD")
        if await self._repo.get_by_reference(reference_id):
            raise DuplicateReferenceError(f"Reference {reference_id} was already used")

        amount = Decimal(body.amount_rwf)
        pricing = await self.pricing()
        fee_pct = self.fee_for(integrator, pricing, DISBURSEMENT)
        money = (
            compute_money_flat_cost(amount, fee_pct, pricing.momo_payout_cost_rwf)
            if via_kitovu
            else compute_money(amount, fee_pct, pricing.payout_cost_percentage)
        )
        external_id = await self._new_kitovu_external_id(payout=True) if via_kitovu else None
        is_test = kitovu_test or self.is_test_for(sandboxed) or (via_kitovu and kv.is_uat)

        lock = self._payout_locks[integrator["id"]] if integrator else asyncio.Lock()
        async with lock:
            if integrator is not None:
                needed = amount + (money.fee_amount_rwf or Decimal(0))
                # Same ledger as the payout: real payouts only spend real money.
                available = await self._repo.integrator_balance(integrator["id"], is_test=is_test)
                if needed > available:
                    raise InsufficientBalanceError(needed, available)
            await self._repo.create(
                reference_id=reference_id,
                direction=DISBURSEMENT,
                integrator_id=integrator["id"] if integrator else None,
                method="MOMO",
                channel="AIRTEL" if airtel else "MTN",
                amount_rwf=amount,
                money=money,
                customer_name=body.recipient_name,
                customer_email=body.recipient_email or "",
                customer_phone=body.recipient_phone,
                description=body.description or "payout",
                return_url=None,
                is_test=is_test,
                is_cashout=is_cashout,
                gateway=sandbox.GATEWAY if sandboxed else (kitovu_client.GATEWAY if via_kitovu else "LMBTECH"),
                gateway_external_id=external_id,
            )

        if sandboxed:
            await self._repo.set_pending_details(
                reference_id, status_message="Sandbox: payout is being delivered (simulated)", redirect_url=None
            )
            return await self._repo.get_by_reference(reference_id)

        if via_kitovu:
            try:
                result = await kv.payout(
                    external_id=external_id,
                    amount=amount,
                    phone=body.recipient_phone,
                    name=body.recipient_name,
                    description=body.description or "payout",
                    callback_url=self._kitovu_callback_url(),
                )
            except KitovuError as exc:
                logger.warning("kitovu_payout_refused", extra={"reference_id": reference_id, "error": exc.message})
                return await self._fail(reference_id, exc.message)
            return await self._apply(reference_id, result)

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

    # -- Cash-outs (integrator withdrawing their own balance) ----------------

    async def cashout(self, integrator: dict, destination: str, amount_rwf: int) -> dict:
        """Like LMBTech's "Cashout to MoMo" / "Cashout to Bank".
        MOMO: a payout to the integrator's own MoMo number (payout fee applies) -
        Kitovu when it's on (MTN or Airtel), else LMBTech (MTN only).
        BANK: a request an admin settles by bank transfer; no fee, the amount is
        reserved from the balance until it's paid or rejected."""
        owner = " ".join(filter(None, [integrator.get("first_name"), integrator.get("last_name")])) or integrator["name"]
        if destination == "MOMO":
            phone = integrator.get("phone_number")
            if not phone:
                raise CashoutSetupError("No MoMo number on your account yet - ask Soila Pay to add your phone number.")
            try:
                body = DisbursementCreate(
                    amount_rwf=amount_rwf, recipient_name=owner, recipient_phone=phone, description="Cash-out to MoMo"
                )
            except ValueError as exc:
                raise CashoutSetupError(f"Your phone {phone} can't receive MoMo payouts (MTN 078/079 or Airtel 072/073).") from exc
            try:
                return await self.create_disbursement(body, integrator, is_cashout=True)
            except ChannelUnavailableError as exc:
                raise CashoutSetupError(f"Cash-outs to Airtel ({phone}) aren't available yet - ask Soila Pay to use an MTN number.") from exc

        bank, account = integrator.get("bank_name"), integrator.get("bank_account")
        if not bank or not account:
            raise CashoutSetupError("Add your bank name and account number on the Account page first.")
        amount = Decimal(amount_rwf)
        reference_id = new_reference("SB")
        sandboxed = self.is_sandbox(integrator)
        is_test = self.is_test_for(sandboxed)
        async with self._payout_locks[integrator["id"]]:
            available = await self._repo.integrator_balance(integrator["id"], is_test=is_test)
            if amount > available:
                raise InsufficientBalanceError(amount, available)
            await self._repo.create(
                reference_id=reference_id,
                direction=DISBURSEMENT,
                integrator_id=integrator["id"],
                method="BANK",
                channel="BANK",
                amount_rwf=amount,
                money=compute_money(amount, None, Decimal(0)),
                customer_name=owner,
                customer_email=integrator.get("email") or "",
                customer_phone=None,
                description=f"Cash-out to {bank} {account}"[:120],
                return_url=None,
                is_test=is_test,
                is_cashout=True,
                # Sandbox: a simulated transfer that settles by itself; live:
                # an admin sends the real transfer and settles it.
                gateway=sandbox.GATEWAY if sandboxed else "MANUAL",
            )
        await self._repo.set_pending_details(
            reference_id,
            status_message="Sandbox: simulated bank transfer" if sandboxed else "Waiting for Soila Pay to send the bank transfer",
            redirect_url=None,
        )
        return await self._repo.get_by_reference(reference_id)

    async def settle_bank_cashout(self, reference_id: str, *, paid: bool, note: str) -> dict:
        """Admin: mark a bank cash-out paid (note = bank transfer reference) or
        rejected (note = reason; the money goes back to the balance)."""
        message = f"Paid by bank transfer (ref {note})" if paid else f"Rejected: {note}"
        status = await self._repo.settle_bank_cashout(
            reference_id, paid=paid, message=message, bank_reference=note if paid else None
        )
        if status is None:
            raise CashoutSetupError("This is not a pending bank cash-out")
        row = await self._repo.get_by_reference(reference_id)
        await self._notify(row)
        return row

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
        if row is not None and row["status"] not in TERMINAL_STATUSES and row.get("gateway") == sandbox.GATEWAY:
            return await self._sync_sandbox(row)
        if row is None or row["status"] in TERMINAL_STATUSES:
            return row
        gateway = row.get("gateway")
        # Bank cash-outs are settled by an admin, not a gateway.
        if gateway not in ("LMBTECH", kitovu_client.GATEWAY):
            return row
        try:
            if gateway == kitovu_client.GATEWAY:
                # Test rows were made on Kitovu's TEST gateway (when it is set up).
                kv = self._kitovu_for(bool(row.get("is_test")) and self.kitovu_test_available)
                if kv is None or not row.get("gateway_external_id"):
                    return row
                result = await kv.get_status(row["gateway_external_id"])
            else:
                result = await self._gateway.get_status(reference_id)
        except (LMBTechError, KitovuError) as exc:
            logger.warning("payment_sync_failed", extra={"reference_id": reference_id, "error": exc.message})
            return row
        if result is None:
            return row
        changed = await self._repo.update_gateway_state(
            reference_id,
            status=result.status,
            status_message=result.message,
            gateway_transaction_id=result.transaction_id,
            gateway_amount=result.amount,
        )
        row = await self._repo.get_by_reference(reference_id)
        if changed:
            logger.info("payment_status_changed", extra={"reference_id": reference_id, "status": row["status"]})
            await self._notify(row)
        return row

    # -- Sandbox -------------------------------------------------------------

    async def _sync_sandbox(self, row: dict) -> dict:
        """Settle a simulated MoMo payment, payout or bank cash-out once it's
        due. Sandbox cards wait for the sandbox card page instead."""
        if row["method"] == "CARD" or not sandbox.due(row.get("created_at")):
            return row
        if row["method"] == "BANK":
            result = GatewayResult(status="SUCCESS", message="Sandbox: bank transfer sent (simulated)", transaction_id=sandbox.transaction_id())
        else:
            result = sandbox.phone_outcome(row.get("customer_phone"), payout=row["direction"] == DISBURSEMENT)
        return await self._apply(row["reference_id"], result)

    async def complete_sandbox_card(self, reference_id: str, *, approve: bool, card_number: Optional[str]) -> Optional[dict]:
        """The sandbox card page's Pay / Cancel buttons. Only ever touches a
        pending SANDBOX card row - never a live payment."""
        row = await self._repo.get_by_reference(reference_id)
        if row is None or row.get("gateway") != sandbox.GATEWAY or row["method"] != "CARD":
            return None
        if row["status"] in TERMINAL_STATUSES:
            return row
        return await self._apply(reference_id, sandbox.card_outcome(card_number, approve))

    # -- Reconciliation with LMBTech -----------------------------------------

    async def reconcile(self, reference_id: str) -> Optional[dict]:
        """Compare one row with LMBTech and correct it - including a finished
        row we got wrong (FAILED here, paid at LMBTech). Returns a change
        record, or None if it already agreed / LMBTech doesn't know it."""
        try:
            result = await self._gateway.get_status(reference_id)
        except LMBTechError as exc:
            logger.warning("reconcile_lookup_failed", extra={"reference_id": reference_id, "error": exc.message})
            return {"reference_id": reference_id, "error": exc.message}
        if result is None or result.status == "PENDING":
            return None  # unknown at LMBTech, or still in progress - nothing to correct
        previous = await self._repo.reconcile_state(
            reference_id,
            status=result.status,
            status_message=result.message,
            gateway_transaction_id=result.transaction_id,
            gateway_amount=result.amount,
        )
        if previous is None:
            return None
        row = await self._repo.get_by_reference(reference_id)
        logger.warning(
            "payment_reconciled",
            extra={"reference_id": reference_id, "from": previous, "to": row["status"]},
        )
        await self._notify(row)
        return {
            "reference_id": reference_id,
            "name": row["customer_name"],
            "amount_rwf": float(row["amount_rwf"]),
            "from_status": previous,
            "to_status": row["status"],
        }

    async def reconcile_all(self, days: int) -> dict:
        # Only rows that went through LMBTech (not bank cash-outs).
        refs = await self._repo.list_references_since(days, gateway="LMBTECH")
        changes, errors = [], []
        for ref in refs:
            outcome = await self.reconcile(ref)
            if outcome and "error" in outcome:
                errors.append(outcome)
            elif outcome:
                changes.append(outcome)
        return {"checked": len(refs), "corrected": changes, "errors": errors}

    async def import_from_gateway(
        self,
        reference_id: str,
        amount_rwf: int,
        channel: str,
        description: str,
        *,
        direction: str = COLLECTION,
        recipient_phone: Optional[str] = None,
    ) -> dict:
        """Add a transaction that exists at LMBTech but not here (e.g. made
        outside Soila Pay, such as a payout or a cash-out done in LMBTech's
        dashboard). Its status/name come from LMBTech when LMBTech's status
        API knows the reference. A dashboard CASHOUT it doesn't know is still
        recorded (as done, from what the admin entered) so the books match.
        `amount_rwf` is the NET amount shown on LMBTech's dashboard. Imports
        belong to no integrator, so they never change an integrator's balance."""
        cashout = direction == "CASHOUT"
        payout = direction == DISBURSEMENT or cashout
        if await self._repo.get_by_reference(reference_id):
            raise DuplicateReferenceError(f"Reference {reference_id} is already in Soila Pay")
        result = await self._gateway.get_status(reference_id)
        if result is None and not cashout:
            raise LMBTechError(f"LMBTech has no transaction with reference {reference_id}")
        if result is None:  # dashboard cash-out LMBTech's API doesn't expose
            result = GatewayResult(status="SUCCESS", message="LMBTech cash-out recorded by admin")
        pricing = await self.pricing()
        amount = Decimal(amount_rwf)
        if cashout:
            money = compute_money(amount, None, Decimal(0))  # the NET amount left LMBTech; no fee is known
        else:
            money = compute_money(amount, None, pricing.payout_cost_percentage if payout else pricing.gateway_cost_percentage)
        method = "BANK" if channel == "BANK" else ("MOMO" if channel == "MTN" else "CARD")
        await self._repo.create(
            reference_id=reference_id,
            direction=DISBURSEMENT if payout else COLLECTION,
            integrator_id=None,
            method=method,
            channel=channel,
            amount_rwf=amount,
            money=money,
            customer_name=result.name or "Imported from LMBTech",
            customer_email="",
            customer_phone=recipient_phone,
            description=description or ("LMBTech cash-out" if cashout else "Imported from LMBTech"),
            return_url=None,
            is_test=self._settings.lmbtech_test_mode,
            imported=True,
            is_cashout=cashout,
            # Recorded-by-hand cash-outs are not polled at LMBTech.
            gateway="MANUAL" if cashout and result.message == "LMBTech cash-out recorded by admin" else "LMBTECH",
        )
        await self._repo.reconcile_state(
            reference_id,
            status=result.status,
            status_message=result.message,
            gateway_transaction_id=result.transaction_id,
            gateway_amount=result.amount,
        )
        return await self._repo.get_by_reference(reference_id)

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
