import asyncio
import logging
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

import httpx

from app.config import Settings
from app.exceptions import UtilityPurchaseError

logger = logging.getLogger(__name__)


class UtilityProvider(ABC):
    @abstractmethod
    async def purchase(
        self,
        provider: str,
        meter_number: str,
        amount: Decimal,
        *,
        reference_id: Optional[str] = None,
        customer_name: Optional[str] = None,
    ) -> str:
        """Returns a utility token string on success; raises UtilityPurchaseError on failure.

        reference_id: caller's idempotency key, forwarded as-is where a provider
        needs one (e.g. DDIN's required `referenceId`). Providers that don't
        need it may ignore it.
        customer_name: forwarded where a provider requires it (e.g. DDIN's
        required `customerName`). See DDINUtilityProvider's docstring for the
        current gap: nothing upstream of this call yet supplies a real value.
        """

    async def aclose(self) -> None:
        """Override if the provider owns a resource (e.g. an httpx.AsyncClient) to release."""


class DummyUtilityProvider(UtilityProvider):
    """
    Local stand-in for a real utility provider integration.

    Simulates the call in-process (latency only, no second container required).
    Use `FORCE_FAIL_METER` as the meter number to deliberately trigger a failure and
    exercise the rollback path - this is what the Bruno "Forced Utility Failure"
    request uses, and it's the only reliable way to test the refund path without
    depending on DDIN's sandbox rejecting a specific meter number on demand.

    Selected via UTILITY_PROVIDER_NAME=dummy (see get_utility_provider below).
    """

    FORCE_FAIL_METER = "00000000000"

    def __init__(self, settings: Settings):
        self._settings = settings

    async def purchase(
        self,
        provider: str,
        meter_number: str,
        amount: Decimal,
        *,
        reference_id: Optional[str] = None,
        customer_name: Optional[str] = None,
    ) -> str:
        await asyncio.sleep(self._settings.utility_dummy_latency_seconds)

        if meter_number == self.FORCE_FAIL_METER:
            logger.warning(
                "utility_purchase_forced_failure",
                extra={"provider": provider, "meter_number": meter_number},
            )
            raise UtilityPurchaseError(
                f"Utility provider {provider} rejected meter {meter_number} "
                "(forced failure for testing)"
            )

        token = f"{provider}-{uuid.uuid4().hex[:12].upper()}"
        logger.info(
            "utility_purchase_success",
            extra={"provider": provider, "meter_number": meter_number, "token": token},
        )
        return token


class _DDINUnauthorizedError(Exception):
    """Internal signal: the collection dispatch got a 401. Never escapes this module."""


class _DDINRefreshError(Exception):
    """Internal signal: refreshing the session failed and a full re-login is required."""


@dataclass
class _DDINTokenState:
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    # Bumped on every successful login/refresh. Lets concurrent callers that all
    # hit 401 at once detect "someone already renewed the session while I was
    # waiting for the lock" and skip a redundant, token-invalidating refresh.
    version: int = 0


class DDINUtilityProvider(UtilityProvider):
    """
    Real integration with the DDIN/Moola sandbox Agent API.

    Login and Refresh Token were fully documented and are implemented exactly
    as specified - and verified live against the sandbox (2026-08-07):
      - Login's token pair is nested under a `data` envelope:
        {"success": true, "data": {"accessToken": "...", "refreshToken": "..."}}
      - Refresh Token's response is NOT nested - tokens are top-level:
        {"success": true, "accessToken": "...", "refreshToken": "..."}
      `_store_tokens` below handles both shapes.

    The Collection API's full docs were not provided, but both the request's
    REQUIRED FIELDS and its actual runtime behavior were confirmed live
    against the real sandbox (2026-08-07):
      - Request fields (via a validation-error probe): `provider`,
        `customerAccountNumber`, `customerName`, `amount`, `referenceId`.
      - `provider` accepts the mobile money NETWORK (confirmed "MTN" is
        accepted) - not a utility company code like "REG"/"WASAC". This is a
        MoMo (mobile money) collection API, not a utility-vending API.
      - THE API IS ASYNCHRONOUS. A real test call returned HTTP 202 with
        {"data": {"status": "pending", "transactionId": null,
        "operationReferenceId": "..."}} - DDIN acknowledges the request and
        resolves the actual outcome later, not in this response. This is a
        BLOCKING ARCHITECTURAL GAP, not a minor detail:
          1. Neither a status-polling endpoint nor a webhook payload/signature
             scheme has been confirmed yet (their own docs hint at a webhook
             - "notified the instant a transaction resolves, instead of
             polling" - but the registration endpoint and payload shape are
             still needed from DDIN).
          2. `_dispatch_collection` currently treats any non-success `status`
             (including "pending") as a hard failure, which triggers the
             Fineract refund rollback immediately. This is a deliberately
             chosen SAFE STOPGAP (never claim success DDIN hasn't confirmed),
             NOT a correct final design - it means every real collection
             attempt will currently be refunded even when the underlying
             MoMo collection might have gone on to succeed.
          3. The real fix needs either: (a) poll a status endpoint in a retry
             loop with a timeout before deciding success/failure, or
             (b) redesign the purchase flow to be genuinely async - return a
             PENDING state to the client immediately and resolve it later via
             DDIN's webhook, updating transaction_logs and only refunding
             once DDIN confirms failure. Needs DDIN's answer on which
             mechanism they actually offer before choosing.

    KNOWN GAP: `customerName` is required by DDIN but nothing upstream of
    this call (UtilityPurchaseRequest / PurchaseOrchestrator) currently
    captures a customer name - it falls back to a placeholder here. Wire a
    real value through (e.g. fetched from the Fineract client record) before
    relying on this beyond sandbox smoke-testing.

    Selected via UTILITY_PROVIDER_NAME=ddin (the default - see
    get_utility_provider below).
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.ddin_base_url,
            timeout=settings.ddin_timeout_seconds,
        )
        self._token_state = _DDINTokenState()
        # Guards login/refresh so concurrent purchase() calls don't stampede
        # DDIN's auth endpoints (each refresh invalidates the prior refresh
        # token, per DDIN's own docs, so concurrent refreshes can race).
        self._auth_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def purchase(
        self,
        provider: str,
        meter_number: str,
        amount: Decimal,
        *,
        reference_id: Optional[str] = None,
        customer_name: Optional[str] = None,
    ) -> str:
        # See the KNOWN GAP note in the class docstring - customer_name has no
        # real upstream source yet.
        reference_id = reference_id or f"soila-{uuid.uuid4().hex[:20]}"
        customer_name = customer_name or "Soila Pay Customer"

        if self._token_state.access_token is None:
            await self._ensure_logged_in()

        token_version = self._token_state.version
        try:
            return await self._dispatch_collection(
                provider, meter_number, amount, reference_id, customer_name
            )
        except _DDINUnauthorizedError:
            logger.warning(
                "ddin_unauthorized_retry",
                extra={"provider": provider, "meter_number": meter_number},
            )
            await self._renew_session(seen_version=token_version)
            try:
                return await self._dispatch_collection(
                    provider, meter_number, amount, reference_id, customer_name
                )
            except _DDINUnauthorizedError as exc:
                raise UtilityPurchaseError(
                    "DDIN rejected the request with 401 even after refreshing "
                    "credentials and retrying once"
                ) from exc

    # -- Session lifecycle -------------------------------------------------

    async def _ensure_logged_in(self) -> None:
        async with self._auth_lock:
            if self._token_state.access_token is None:
                await self._login()

    async def _renew_session(self, seen_version: int) -> None:
        async with self._auth_lock:
            if self._token_state.version != seen_version:
                # Another concurrent request already renewed the session while
                # we were waiting for the lock - reuse it, don't refresh again.
                return
            try:
                await self._refresh_token()
            except _DDINRefreshError as exc:
                logger.warning(
                    "ddin_refresh_failed_falling_back_to_login",
                    extra={"error": str(exc)},
                )
                await self._login()

    async def _login(self) -> None:
        if not self._settings.ddin_username or not self._settings.ddin_password:
            raise UtilityPurchaseError(
                "DDIN_USERNAME / DDIN_PASSWORD are not configured"
            )
        try:
            resp = await self._client.post(
                self._settings.ddin_login_path,
                json={
                    "username": self._settings.ddin_username,
                    "password": self._settings.ddin_password,
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise UtilityPurchaseError(f"DDIN login timed out: {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise UtilityPurchaseError(
                f"DDIN login failed ({exc.response.status_code}): {exc.response.text}"
            ) from exc
        except httpx.HTTPError as exc:
            raise UtilityPurchaseError(f"DDIN login transport error: {exc}") from exc

        self._store_tokens(resp, context="login")
        logger.info("ddin_login_succeeded")

    async def _refresh_token(self) -> None:
        if not self._token_state.refresh_token:
            raise _DDINRefreshError("no refresh token available")
        try:
            resp = await self._client.post(
                self._settings.ddin_refresh_path,
                json={"refreshToken": self._token_state.refresh_token},
            )
            resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise _DDINRefreshError(f"DDIN refresh timed out: {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise _DDINRefreshError(
                f"DDIN refresh failed ({exc.response.status_code}): {exc.response.text}"
            ) from exc
        except httpx.HTTPError as exc:
            raise _DDINRefreshError(f"DDIN refresh transport error: {exc}") from exc

        self._store_tokens(resp, context="refresh")
        logger.info("ddin_token_refreshed")

    def _store_tokens(self, resp: httpx.Response, context: str) -> None:
        try:
            data = resp.json()
        except ValueError as exc:
            raise UtilityPurchaseError(
                f"DDIN {context} response was not valid JSON: {resp.text}"
            ) from exc

        # CONFIRMED live: login nests tokens under "data"; refresh does not.
        # Handle both without caring which endpoint produced this response.
        envelope = data.get("data") if isinstance(data.get("data"), dict) else data
        access_token = envelope.get("accessToken") or envelope.get("access_token")
        refresh_token = envelope.get("refreshToken") or envelope.get("refresh_token")
        if not access_token or not refresh_token:
            raise UtilityPurchaseError(
                f"DDIN {context} response missing accessToken/refreshToken: {data}"
            )

        self._token_state.access_token = access_token
        self._token_state.refresh_token = refresh_token
        self._token_state.version += 1

    # -- Collection dispatch -------------------------------------------------

    async def _dispatch_collection(
        self,
        provider: str,
        meter_number: str,
        amount: Decimal,
        reference_id: str,
        customer_name: str,
    ) -> str:
        headers = {"Authorization": f"Bearer {self._token_state.access_token}"}
        # CONFIRMED live via a validation-error probe against the sandbox:
        # POST .../v1/momo/collection/initiate with {} returned 400
        # "Required fields: provider, customerAccountNumber, customerName,
        # amount, referenceId". Field VALUES/types beyond "required" (e.g.
        # whether amount must be numeric vs string) are still inferred.
        payload = {
            "provider": provider,
            "customerAccountNumber": meter_number,
            "customerName": customer_name,
            "amount": str(amount),
            "referenceId": reference_id,
        }

        try:
            resp = await self._client.post(
                self._settings.ddin_collection_path, json=payload, headers=headers
            )
        except httpx.TimeoutException as exc:
            raise UtilityPurchaseError(f"DDIN collection request timed out: {exc}") from exc
        except httpx.HTTPError as exc:
            raise UtilityPurchaseError(f"DDIN collection transport error: {exc}") from exc

        if resp.status_code == 401:
            raise _DDINUnauthorizedError()

        if resp.is_error:
            raise UtilityPurchaseError(self._format_error(resp))

        try:
            data = resp.json()
        except ValueError as exc:
            raise UtilityPurchaseError(
                f"DDIN collection response was not valid JSON: {resp.text}"
            ) from exc

        # CONFIRMED live: a successful call to /v1/momo/collection/initiate
        # returns HTTP 202 (not 200) with the payload nested under "data" and
        # a "status" field. Observed value: "status": "pending",
        # "transactionId": null - DDIN does NOT resolve the transaction in
        # this response. This is an ASYNCHRONOUS API: initiate returns an
        # acknowledgment, not a result. The real outcome (success/failure)
        # arrives later - either via a status-check endpoint or a webhook
        # (DDIN's own "Getting Started" guide says "...so you're notified the
        # instant a transaction resolves, instead of polling", implying a
        # webhook). NEITHER is confirmed yet - see the class docstring.
        #
        # STOPGAP: since UtilityProvider.purchase()'s contract is synchronous
        # (return a token = success, raise = failure, nothing in between),
        # and this codebase has no mechanism yet to resolve a transaction
        # asynchronously after this call returns, treating "pending" as
        # anything other than a failure would be actively wrong: it would
        # report SUCCESS - and hand back operationReferenceId as if it were a
        # real utility token - for a transaction whose real outcome DDIN
        # hasn't determined yet. Raising here instead triggers the Fineract
        # refund rollback, which is the safer failure mode (customer's money
        # stays put; worst case they retry) versus a false-positive success
        # (customer is told it worked before DDIN confirms the debit actually
        # happened). This needs a real fix - see DDINUtilityProvider docstring.
        envelope = data.get("data") if isinstance(data.get("data"), dict) else data
        status = envelope.get("status")
        if status and status.lower() not in ("success", "successful", "completed"):
            raise UtilityPurchaseError(
                f"DDIN collection did not complete synchronously (status={status!r}); "
                "this integration does not yet support DDIN's async resolution "
                f"(operationReferenceId={envelope.get('operationReferenceId')})"
            )

        token = (
            envelope.get("token")
            or envelope.get("transactionReference")
            or envelope.get("transactionId")
            or envelope.get("reference")
        )
        if not token:
            raise UtilityPurchaseError(
                f"DDIN collection response missing a token/reference field: {data}"
            )

        logger.info(
            "ddin_collection_succeeded",
            extra={"provider": provider, "meter_number": meter_number, "reference_id": reference_id},
        )
        return str(token)

    @staticmethod
    def _format_error(resp: httpx.Response) -> str:
        # ASSUMPTION: error envelope shape - tries a few common field names,
        # falls back to the raw response body. Correct once DDIN's real error
        # structure is known.
        try:
            data = resp.json()
        except ValueError:
            return f"DDIN collection failed ({resp.status_code}): {resp.text}"

        message = (
            data.get("message")
            or data.get("error")
            or data.get("errorMessage")
            or (data.get("errors")[0] if isinstance(data.get("errors"), list) and data.get("errors") else None)
            or data
        )
        return f"DDIN collection failed ({resp.status_code}): {message}"


def get_utility_provider(settings: Settings) -> UtilityProvider:
    if settings.utility_provider_name == "ddin":
        return DDINUtilityProvider(settings)
    if settings.utility_provider_name == "dummy":
        return DummyUtilityProvider(settings)
    raise ValueError(f"Unknown utility_provider_name: {settings.utility_provider_name}")
