"""
LMBTech payment gateway client - MTN MoMo and card (Visa/Mastercard via a
hosted Pesapal page).

Docs: https://github.com/danieltn889/LMBTech_Payment_System_API_Documentation
Behaviour below was CONFIRMED live against the test keys (2026-11-08), and in
several places differs from the PDF docs:

  - Endpoint is .../pay/config/api.php for both POST (pay/payout) and GET
    (status, ?reference_id=...).
  - Auth: `Authorization: Basic base64(app_key:secret_key)`. Bad keys -> HTTP
    401 {"status": "fail", "message": "Invalid credentials"}.
  - MoMo pay is SYNCHRONOUS: the request is held open while the customer
    approves on their phone (>40s observed). We use a short timeout and treat
    a timeout as "pending" - the status endpoint resolves it later.
  - Card pay returns immediately: {"status": "pending", "data": {...},
    "redirect_url": "https://pay.lmbtech.rw/pay/pesapal/iframe.php?..."}
    - redirect_url is TOP-LEVEL (the docs show it under data).
  - Status response is FLAT, no data envelope:
    {"status": "pending"|"success"|"fail", "amount", "reference_id",
     "transaction_id", "name", "message"}
  - Unknown reference -> HTTP 200 {"status": false, "message": "Payment not
    found ..."} (the docs say 404).
  - A merchant account in Test Mode gets an instant simulated success for
    both card and MoMo (transaction_id "TEST-..."), no card page. The status
    lookup then reports amount + 5% (e.g. 105.00 for 100) - LMBTech's fee.
"""
from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Optional

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

# Gateway vocabulary -> ours. Unknown values stay PENDING (never guess failure).
_STATUS_MAP = {
    "success": "SUCCESS",
    "successful": "SUCCESS",
    "completed": "SUCCESS",
    "fail": "FAILED",
    "failed": "FAILED",
    "cancelled": "CANCELLED",
    "canceled": "CANCELLED",
    "pending": "PENDING",
}


def normalize_status(raw: Any) -> str:
    return _STATUS_MAP.get(str(raw).strip().lower(), "PENDING")


class LMBTechError(Exception):
    """The gateway rejected the request or couldn't be reached. `message` is
    safe to show the customer/integrator."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class GatewayResult:
    status: str  # PENDING | SUCCESS | FAILED | CANCELLED
    message: Optional[str] = None
    transaction_id: Optional[str] = None
    redirect_url: Optional[str] = None
    # Status API only: the amount LMBTech reports (observed to include its own
    # fee on top of what we asked for, e.g. 105 for 100).
    amount: Optional[Decimal] = None
    # Status API only: the payer/recipient name LMBTech has on file.
    name: Optional[str] = None


class LMBTechClient:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._client = httpx.AsyncClient(timeout=settings.lmbtech_timeout_seconds)

    @property
    def configured(self) -> bool:
        return bool(self._settings.lmbtech_app_key and self._settings.lmbtech_secret_key)

    def _headers(self) -> dict[str, str]:
        if not self.configured:
            raise LMBTechError("Card/MoMo gateway is not configured (LMBTECH_APP_KEY / LMBTECH_SECRET_KEY)")
        raw = f"{self._settings.lmbtech_app_key}:{self._settings.lmbtech_secret_key}"
        return {
            "Authorization": "Basic " + base64.b64encode(raw.encode()).decode(),
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def _json(resp: httpx.Response) -> dict:
        try:
            data = resp.json()
        except ValueError as exc:
            raise LMBTechError(f"Gateway returned an unreadable response (HTTP {resp.status_code})") from exc
        if not isinstance(data, dict):
            raise LMBTechError(f"Gateway returned an unexpected response (HTTP {resp.status_code})")
        return data

    async def pay(
        self,
        *,
        method: str,  # "MOMO" | "CARD"
        reference_id: str,
        amount: Decimal,
        name: str,
        email: str,
        phone: Optional[str],
        description: str,
        callback_url: str,
        card_redirect_url: Optional[str],
    ) -> GatewayResult:
        payload: dict[str, Any] = {
            "email": email,
            "name": name,
            "payment_method": "MTN_MOMO_RWA" if method == "MOMO" else "card",
            # Whole RWF - the gateway's own examples use integers.
            "amount": int(amount),
            "service_paid": description[:60] or "payment",
            "reference_id": reference_id,
            "callback_url": callback_url,
            "action": "pay",
        }
        if method == "MOMO":
            payload["payer_phone"] = phone
        else:
            payload["card_redirect_url"] = card_redirect_url

        try:
            resp = await self._client.post(self._settings.lmbtech_base_url, json=payload, headers=self._headers())
        except httpx.TimeoutException:
            # Expected for MoMo: the gateway is waiting on the customer's PIN.
            logger.info("lmbtech_pay_timeout_pending", extra={"reference_id": reference_id, "method": method})
            return GatewayResult(status="PENDING", message="Waiting for the customer to approve")
        except httpx.HTTPError as exc:
            raise LMBTechError(f"Could not reach the payment gateway: {exc.__class__.__name__}") from exc

        data = self._json(resp)
        if resp.status_code == 401:
            raise LMBTechError("Payment gateway rejected our credentials", status_code=401)
        rejected = data.get("status") in (False, "fail", "failed", "error")
        # A card request that's rejected never produced a payment page - an
        # error. A MoMo "fail" is a real outcome (customer declined, no funds)
        # and is returned below as a FAILED result instead.
        if resp.is_error or (rejected and method == "CARD"):
            raise LMBTechError(str(data.get("message") or f"Gateway error (HTTP {resp.status_code})"), resp.status_code)

        envelope = data.get("data") if isinstance(data.get("data"), dict) else {}
        status = normalize_status(envelope.get("status") or data.get("status"))
        redirect_url = data.get("redirect_url") or envelope.get("redirect_url")
        # A merchant account in LMBTech "Test Mode" doesn't show a card page:
        # both card and MoMo come back instantly as a simulated success -
        # {"status":"success","transaction_id":"TEST-...","refid":...,
        #  "response":{"test_mode":true}} (confirmed live 2026-11-08). Only a
        # still-pending card payment needs a page to send the customer to.
        if method == "CARD" and status == "PENDING" and not redirect_url:
            raise LMBTechError(str(data.get("message") or "Gateway did not return a card payment page"))

        logger.info(
            "lmbtech_pay_accepted",
            extra={"reference_id": reference_id, "method": method, "status": status},
        )
        return GatewayResult(
            status=status,
            message=data.get("message"),
            transaction_id=(envelope.get("transaction_id") or data.get("transaction_id")) or None,
            redirect_url=redirect_url,
        )

    async def payout(
        self,
        *,
        reference_id: str,
        amount: Decimal,
        recipient_name: str,
        recipient_phone: str,
        description: str,
        callback_url: str,
    ) -> GatewayResult:
        """Send money from the Soila Pay LMBTech balance to an MTN MoMo number
        (action=payout). Per LMBTech's docs, `email` is OUR account's email and
        `name` is the recipient; the account needs payout permission and
        enough balance (HTTP 402 "Insufficient balance for payout" otherwise).
        Documented response: {"status":"success","data":{"reference_id",
        "amount","status":"pending"},"message":"Payout initiated successfully"}
        - so the outcome usually resolves later via the status API. Not yet
        observed live (a test payout needs explicit go-ahead), hence the
        defensive parsing shared with pay()."""
        account_email = self._settings.lmbtech_account_email
        if not account_email:
            raise LMBTechError("Payouts are not set up yet (LMBTECH_ACCOUNT_EMAIL is missing)")
        payload: dict[str, Any] = {
            "email": account_email,
            "name": recipient_name,
            "payment_method": "MTN_MOMO_RWA",
            "amount": int(amount),
            "payer_phone": recipient_phone,
            "service_paid": (description or "payout")[:60],
            "reference_id": reference_id,
            "callback_url": callback_url,
            "action": "payout",
        }
        try:
            resp = await self._client.post(self._settings.lmbtech_base_url, json=payload, headers=self._headers())
        except httpx.TimeoutException:
            logger.info("lmbtech_payout_timeout_pending", extra={"reference_id": reference_id})
            return GatewayResult(status="PENDING", message="Payout sent, waiting for confirmation")
        except httpx.HTTPError as exc:
            raise LMBTechError(f"Could not reach the payment gateway: {exc.__class__.__name__}") from exc

        data = self._json(resp)
        if resp.status_code == 401:
            raise LMBTechError("Payment gateway rejected our credentials", status_code=401)
        if resp.status_code == 402:
            raise LMBTechError("Not enough balance at LMBTech for this payout", status_code=402)
        if resp.is_error or data.get("status") in (False, "fail", "failed", "error"):
            raise LMBTechError(str(data.get("message") or f"Payout refused (HTTP {resp.status_code})"), resp.status_code)

        envelope = data.get("data") if isinstance(data.get("data"), dict) else {}
        # The inner status is the payout's own state ("pending" while MTN
        # processes it); the outer "success" only means "request accepted".
        status = normalize_status(envelope.get("status") or data.get("status"))
        logger.info("lmbtech_payout_accepted", extra={"reference_id": reference_id, "status": status})
        return GatewayResult(
            status=status,
            message=data.get("message"),
            transaction_id=(envelope.get("transaction_id") or data.get("transaction_id")) or None,
        )

    async def get_status(self, reference_id: str) -> Optional[GatewayResult]:
        """None if the gateway has no record of this reference (yet)."""
        try:
            resp = await self._client.get(
                self._settings.lmbtech_base_url,
                params={"reference_id": reference_id},
                headers=self._headers(),
            )
        except httpx.HTTPError as exc:
            raise LMBTechError(f"Could not reach the payment gateway: {exc.__class__.__name__}") from exc

        data = self._json(resp)
        if resp.status_code == 401:
            raise LMBTechError("Payment gateway rejected our credentials", status_code=401)
        if data.get("status") is False or resp.status_code == 404:
            return None
        if resp.is_error:
            raise LMBTechError(str(data.get("message") or f"Gateway error (HTTP {resp.status_code})"), resp.status_code)

        # Flat in practice; tolerate a data envelope in case they add one.
        envelope = data.get("data") if isinstance(data.get("data"), dict) else data
        try:
            amount = Decimal(str(envelope.get("amount"))) if envelope.get("amount") not in (None, "") else None
        except (ArithmeticError, ValueError):
            amount = None
        return GatewayResult(
            status=normalize_status(envelope.get("status")),
            message=envelope.get("message") or data.get("message"),
            transaction_id=envelope.get("transaction_id") or None,
            amount=amount,
            name=envelope.get("name") or None,
        )
