"""
Kitovu Pay gateway client - MTN MoMo (and Airtel) collections.

Docs: https://docs.kitovupay.com/payment-api. Confirmed against UAT
(2026-11-18) with Soila Pay's UAT keys:

  - Auth: `x-api-key` on every call. POSTs also carry `x-api-timestamp`
    (Unix ms as a string) and `x-api-signature` = lowercase hex
    HMAC-SHA256(secret, compact JSON of {"method","path","body"}). The body
    sent must be byte-identical to the signed `body` (same compact JSON).
  - Fee quote POST /merchant-transaction/merchant/transaction_fee -> 201
    {"amount":100,"subscriber_charges":0,"merchant_charges":3, ...}.
  - Status GET /merchant-transaction/payment/{externalId} (key only) ->
    {"reference_id","status": PENDING|APPROVED|REJECTED|FAILED,"reason"};
    unknown -> 404 {"message":"This Merchant External Id Not Found."}.
  - Callbacks (POST to callbackUrl) are NOT signed - we only use them to
    trigger a status check, never as proof of payment.
  - externalId: 6 digits for collections (7 for disbursements).
  - description: letters, numbers and spaces only (symbols like # can stop
    the MoMo prompt from reaching the payer's phone).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import time
from decimal import Decimal
from typing import Any, Optional

import httpx

from app.config import Settings
from app.services.lmbtech_client import GatewayResult

logger = logging.getLogger(__name__)

GATEWAY = "KITOVU"
COLLECTION_PATH = "/merchant-transaction/merchant/collection/mobile_money"
FEE_PATH = "/merchant-transaction/merchant/transaction_fee"
STATUS_PATH = "/merchant-transaction/payment/{external_id}"

# Kitovu vocabulary -> ours. Unknown values stay PENDING (never guess failure).
_STATUS_MAP = {
    "APPROVED": "SUCCESS",
    "SUCCESSFUL": "SUCCESS",
    "COMPLETED": "SUCCESS",
    "SUCCESS": "SUCCESS",
    "REJECTED": "FAILED",
    "FAILED": "FAILED",
    "CANCELLED": "CANCELLED",
    "CANCELED": "CANCELLED",
    "PENDING": "PENDING",
}

# Kitovu's failure reasons, in words a payer understands.
_REASONS = {
    "NOT_ENOUGH_FUNDS": "Not enough money on the Mobile Money account",
    "INSUFFICIENT_BALANCE": "Not enough money on the Mobile Money account",
    "CANCELLED_BY_USER": "The customer cancelled the payment",
    "INVALID_NUMBER": "That Mobile Money number is not valid",
}


def normalize_status(raw: Any) -> str:
    if raw is True:
        return "SUCCESS"
    return _STATUS_MAP.get(str(raw or "").strip().upper(), "PENDING")


def compact_json(data: Any) -> str:
    """Same bytes as JavaScript JSON.stringify - what Kitovu signs."""
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def sign(secret: str, method: str, path: str, body: dict) -> str:
    payload = compact_json({"method": method.upper(), "path": path, "body": body})
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def rail_for(phone_e164: str) -> str:
    """+25078/79 -> mtn, +25072/73 -> airtel."""
    local = phone_e164.removeprefix("+").removeprefix("250")
    return "airtel" if local[:2] in ("72", "73") else "mtn"


def account_number(phone_e164: str, rail: str) -> str:
    """MTN: 250 + 9 digits. Airtel: the 9-digit local number."""
    local = phone_e164.removeprefix("+").removeprefix("250")
    return local if rail == "airtel" else f"250{local}"


def clean_description(text: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 ]+", " ", text or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned or "Payment")[:60]


class KitovuError(Exception):
    def __init__(self, message: str, status_code: Optional[int] = None, code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class KitovuClient:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.kitovupay_base_url.rstrip("/"), timeout=settings.kitovupay_timeout_seconds
        )

    @property
    def configured(self) -> bool:
        s = self._settings
        return bool(s.kitovupay_api_key and s.kitovupay_api_secret)

    @property
    def is_uat(self) -> bool:
        return ".uat." in self._settings.kitovupay_base_url

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _post(self, path: str, body: dict) -> httpx.Response:
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self._settings.kitovupay_api_key,
            "x-api-timestamp": str(int(time.time() * 1000)),
            "x-api-signature": sign(self._settings.kitovupay_api_secret, "POST", path, body),
        }
        try:
            return await self._client.post(path, content=compact_json(body).encode("utf-8"), headers=headers)
        except httpx.HTTPError as exc:
            raise KitovuError(f"Could not reach Kitovu Pay: {exc.__class__.__name__}") from exc

    @staticmethod
    def _json(resp: httpx.Response) -> dict:
        try:
            data = resp.json()
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    @staticmethod
    def _error(resp: httpx.Response, data: dict) -> KitovuError:
        msg = data.get("message")
        if isinstance(msg, list):  # validation errors come back as a list
            msg = "; ".join(str(m) for m in msg)
        code = data.get("error") if isinstance(data.get("error"), str) else None
        if resp.status_code in (401, 403) and not msg:
            msg = "Kitovu Pay rejected our credentials"
        return KitovuError(str(msg or f"Kitovu Pay refused the request (HTTP {resp.status_code})"), resp.status_code, code)

    async def collect(
        self,
        *,
        external_id: str,
        amount: Decimal,
        phone: str,
        name: str,
        description: str,
        callback_url: str,
    ) -> GatewayResult:
        """Send a MoMo payment prompt to the payer's phone. Returns PENDING
        (the payer still has to approve); the outcome comes from the status
        API, nudged by Kitovu's callback."""
        rail = rail_for(phone)
        body = {
            "amount": int(amount),
            "payment_rail": rail,
            "sender_account_issuer": rail,
            "sender_account_name": (name or "Customer")[:80],
            "sender_account_number": account_number(phone, rail),
            "description": clean_description(description),
            "callbackUrl": callback_url,
            "externalId": external_id,
        }
        resp = await self._post(COLLECTION_PATH, body)
        data = self._json(resp)
        if resp.is_error or data.get("success") is False:
            raise self._error(resp, data)
        inner = data.get("data") if isinstance(data.get("data"), dict) else {}
        status = normalize_status(inner.get("status") or data.get("status"))
        logger.info("kitovu_collection_accepted", extra={"external_id": external_id, "status": status})
        return GatewayResult(
            status=status,
            message=inner.get("message") or data.get("message") or "Waiting for the customer to approve on their phone",
            transaction_id=(data.get("transactionId") or inner.get("transactionId")) or None,
        )

    async def fee(self, amount: Decimal, rail: str = "mtn") -> dict:
        resp = await self._post(FEE_PATH, {"amount": int(amount), "payment_rail": rail, "sender_account_issuer": rail})
        data = self._json(resp)
        if resp.is_error:
            raise self._error(resp, data)
        return data

    async def get_status(self, external_id: str) -> Optional[GatewayResult]:
        """None if Kitovu has no record of this externalId (yet)."""
        try:
            resp = await self._client.get(
                STATUS_PATH.format(external_id=external_id), headers={"x-api-key": self._settings.kitovupay_api_key}
            )
        except httpx.HTTPError as exc:
            raise KitovuError(f"Could not reach Kitovu Pay: {exc.__class__.__name__}") from exc
        data = self._json(resp)
        if resp.status_code == 404:
            return None
        if resp.is_error:
            raise self._error(resp, data)
        inner = data.get("data") if isinstance(data.get("data"), dict) else data
        status = normalize_status(inner.get("status"))
        reason = inner.get("reason") or None
        if status == "SUCCESS":
            message = "Payment received"
        elif status in ("FAILED", "CANCELLED"):
            message = _REASONS.get(str(reason or "").upper(), str(reason) if reason else "The payment was not completed")
        else:
            message = "Waiting for the customer to approve on their phone"
        amount = inner.get("amount")
        try:
            amount = Decimal(str(amount)) if amount not in (None, "") else None
        except (ArithmeticError, ValueError):
            amount = None
        return GatewayResult(
            status=status,
            message=message,
            transaction_id=(inner.get("reference_id") or inner.get("transactionId")) or None,
            amount=amount,
        )
