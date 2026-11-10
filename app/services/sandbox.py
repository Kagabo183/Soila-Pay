"""
Sandbox: Soila Pay's own payment simulator for integrators testing with a
sandbox key (or a portal account still in Test Mode).

Sandbox payments NEVER reach LMBTech, so no real card is charged and no real
MoMo wallet is debited or credited - even though Soila Pay's LMBTech account
is live. Rows are stored with gateway='SANDBOX' and is_test=1, have their own
balance, and fire the same webhooks as live payments (with "is_test": true).

Outcomes are deterministic so integrators can test every path:

  MTN MoMo collections / payouts / MoMo cash-outs (by phone number):
    0780000002  -> FAILED   (customer declined / recipient unavailable)
    0780000003  -> FAILED   (insufficient funds)
    anything else -> SUCCESS, about SETTLE_SECONDS after creation
  Cards: the customer is sent to Soila Pay's sandbox card page, which
    approves or declines (test card 4000 0000 0000 0002 always declines).
  Bank cash-outs: simulated transfer, SUCCESS after SETTLE_SECONDS.
"""
from __future__ import annotations

import secrets
from datetime import datetime
from typing import Optional

from app.services.lmbtech_client import GatewayResult

GATEWAY = "SANDBOX"
SETTLE_SECONDS = 5

DECLINE_PHONE = "0780000002"
NO_FUNDS_PHONE = "0780000003"
DECLINE_CARD = "4000000000000002"
SUCCESS_CARD = "4242424242424242"


def transaction_id() -> str:
    return f"SANDBOX-{secrets.token_hex(6).upper()}"


def _local(phone: Optional[str]) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if digits.startswith("250") and len(digits) == 12:
        digits = "0" + digits[3:]
    return digits


def phone_outcome(phone: Optional[str], *, payout: bool) -> GatewayResult:
    p = _local(phone)
    if p == DECLINE_PHONE:
        msg = "Sandbox: recipient's wallet is unavailable" if payout else "Sandbox: customer declined the request"
        return GatewayResult(status="FAILED", message=msg, transaction_id=transaction_id())
    if p == NO_FUNDS_PHONE:
        msg = "Sandbox: not enough balance to send" if payout else "Sandbox: insufficient funds on the customer's wallet"
        return GatewayResult(status="FAILED", message=msg, transaction_id=transaction_id())
    msg = "Sandbox: payout delivered (simulated)" if payout else "Sandbox: payment approved (simulated)"
    return GatewayResult(status="SUCCESS", message=msg, transaction_id=transaction_id())


def card_outcome(card_number: Optional[str], approve: bool) -> GatewayResult:
    digits = "".join(c for c in (card_number or "") if c.isdigit())
    if not approve:
        return GatewayResult(status="CANCELLED", message="Sandbox: customer cancelled on the card page", transaction_id=transaction_id())
    if digits == DECLINE_CARD:
        return GatewayResult(status="FAILED", message="Sandbox: card declined by the bank", transaction_id=transaction_id())
    return GatewayResult(status="SUCCESS", message="Sandbox: card payment approved (simulated)", transaction_id=transaction_id())


def due(created_at: Optional[datetime]) -> bool:
    """A simulated MoMo/payout settles a few seconds after it was created, like
    the real thing (so integrators see PENDING first, then the webhook)."""
    if created_at is None:
        return True
    return (datetime.now() - created_at).total_seconds() >= SETTLE_SECONDS
