import asyncio
import logging
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

import httpx
from tenacity import AsyncRetrying, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import Settings
from app.exceptions import CollectionError, CollectionPending

logger = logging.getLogger(__name__)


@dataclass
class ProviderCollectionStatus:
    """A provider's own real, current view of a previously-initiated
    collection - used to reconcile our local record when we can't rely on
    (or haven't yet received) an async webhook. `status` is whatever
    vocabulary the provider itself uses, lowercased (DDIN: "pending" /
    "success" / "failed") - never remapped or invented here."""

    status: str
    message: Optional[str]
    provider_transaction_reference: Optional[str]
    customer_name: Optional[str]


class CollectionProvider(ABC):
    @abstractmethod
    async def collect(
        self,
        provider: str,
        customer_account_number: str,
        amount: Decimal,
        *,
        reference_id: Optional[str] = None,
        customer_name: Optional[str] = None,
    ) -> str:
        """Returns a provider transaction reference string on success; raises
        CollectionError on failure.

        reference_id: caller's idempotency key, forwarded as-is where a provider
        needs one (e.g. DDIN's required `referenceId`). Providers that don't
        need it may ignore it.
        customer_name: forwarded where a provider requires it (e.g. DDIN's
        required `customerName`).
        """

    async def get_status(self, reference_id: str) -> Optional[ProviderCollectionStatus]:
        """Query the provider for a previously-initiated collection's current
        state, by the same reference_id passed to collect(). Returns None if
        the provider has no record of it, or doesn't support this at all.
        Default: unsupported - only DDINCollectionProvider overrides this."""
        return None

    async def aclose(self) -> None:
        """Override if the provider owns a resource (e.g. an httpx.AsyncClient) to release."""


class _DDINUnauthorizedError(Exception):
    """Internal signal: the collection dispatch got a 401. Never escapes this module."""


class _DDINRefreshError(Exception):
    """Internal signal: refreshing the session failed and a full re-login is required."""


class _DDINTransientServerError(Exception):
    """Internal signal: DDIN returned a 5xx, worth retrying. Never escapes
    _request_with_retry - either a later attempt succeeds, or retries are
    exhausted and the last (still-5xx) httpx.Response is returned normally,
    so every existing caller's status-code handling is unaffected."""


@dataclass
class _DDINTokenState:
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    # Bumped on every successful login/refresh. Lets concurrent callers that all
    # hit 401 at once detect "someone already renewed the session while I was
    # waiting for the lock" and skip a redundant, token-invalidating refresh.
    version: int = 0


class DDINCollectionProvider(CollectionProvider):
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
        accepted). This is purely a MoMo (mobile money) collection API - Soila
        Pay does not model utility vending (electricity/water tokens) at all;
        it only pulls money from a customer's mobile money account into a
        Fineract savings account.
      - THE API IS ASYNCHRONOUS. A real test call returned HTTP 202 with
        {"data": {"status": "pending", "transactionId": null,
        "operationReferenceId": "..."}} - DDIN acknowledges the request and
        resolves the actual outcome later, not in this response.
      - RESOLVED (2026-08-07): DDIN's webhook payload/signature scheme is now
        documented - `collection.success` / `collection.failed` events,
        HMAC-SHA256-signed (`X-Moola-Signature` over the raw body), correlated
        back to our request via `data.referenceId` (== the `reference_id` we
        send as `referenceId` above, which the orchestrator sets to our
        `idempotency_key`). `_dispatch_collection` raises `CollectionPending`
        (not `CollectionError`) on a "pending" status, so a real collection is
        no longer wrongly refunded while still in flight.
        `CollectionOrchestrator.resolve_provider_success` /
        `resolve_provider_failure` (invoked from `app/api/v1/webhooks.py`)
        resolve the transaction later - success is recorded, or the same
        Fineract refund rollback runs, once DDIN actually confirms which one
        happened. Registering our callback URL with DDIN to receive these
        webhooks needs its own endpoint, which is not yet documented to us -
        see the README's "Webhooks" section.

    Selected via COLLECTION_PROVIDER_NAME=ddin (the default - see
    get_collection_provider below).
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.ddin_base_url,
            timeout=settings.ddin_timeout_seconds,
        )
        self._token_state = _DDINTokenState()
        # Guards login/refresh so concurrent collect() calls don't stampede
        # DDIN's auth endpoints (each refresh invalidates the prior refresh
        # token, per DDIN's own docs, so concurrent refreshes can race).
        self._auth_lock = asyncio.Lock()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _request_with_retry(self, method: str, path: str, **kwargs) -> httpx.Response:
        """Retries transient failures (timeouts, connection errors, DDIN 5xx)
        with exponential backoff before giving up - never a 401/403 or other
        4xx, which are genuine outcomes, not transient failures, and are
        handled by the caller exactly as before (raise_for_status/is_error/
        status_code checks all still see a normal httpx.Response - even a
        5xx one if retries were exhausted - since this never converts a
        response into a different exception type)."""
        attempts = 0
        last_response: Optional[httpx.Response] = None
        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self._settings.ddin_retry_max_attempts),
                wait=wait_exponential(
                    multiplier=self._settings.ddin_retry_backoff_base_seconds, min=0.1, max=10
                ),
                retry=retry_if_exception_type(
                    (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError, _DDINTransientServerError)
                ),
                reraise=True,
            ):
                with attempt:
                    attempts += 1
                    resp = await self._client.request(method, path, **kwargs)
                    last_response = resp
                    if resp.status_code >= 500:
                        if attempts > 1:
                            logger.warning(
                                "ddin_transient_5xx_retry",
                                extra={"path": path, "attempt": attempts, "status_code": resp.status_code},
                            )
                        raise _DDINTransientServerError()
        except _DDINTransientServerError:
            pass  # exhausted retries on a persistent 5xx - fall through and return it as-is

        assert last_response is not None
        if attempts > 1 and last_response.status_code < 500:
            logger.info("ddin_request_succeeded_after_retry", extra={"path": path, "attempts": attempts})
        return last_response

    async def collect(
        self,
        provider: str,
        customer_account_number: str,
        amount: Decimal,
        *,
        reference_id: Optional[str] = None,
        customer_name: Optional[str] = None,
    ) -> str:
        reference_id = reference_id or f"soila-{uuid.uuid4().hex[:20]}"
        customer_name = customer_name or "Soila Pay Customer"

        if self._token_state.access_token is None:
            await self._ensure_logged_in()

        token_version = self._token_state.version
        try:
            return await self._dispatch_collection(
                provider, customer_account_number, amount, reference_id, customer_name
            )
        except _DDINUnauthorizedError:
            logger.warning(
                "ddin_unauthorized_retry",
                extra={"provider": provider, "customer_account_number": customer_account_number},
            )
            await self._renew_session(seen_version=token_version)
            try:
                return await self._dispatch_collection(
                    provider, customer_account_number, amount, reference_id, customer_name
                )
            except _DDINUnauthorizedError as exc:
                raise CollectionError(
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
            raise CollectionError(
                "DDIN_USERNAME / DDIN_PASSWORD are not configured"
            )
        try:
            resp = await self._request_with_retry(
                "POST",
                self._settings.ddin_login_path,
                json={
                    "username": self._settings.ddin_username,
                    "password": self._settings.ddin_password,
                },
            )
            resp.raise_for_status()
        except httpx.TimeoutException as exc:
            raise CollectionError(f"DDIN login timed out: {exc}") from exc
        except httpx.HTTPStatusError as exc:
            raise CollectionError(
                f"DDIN login failed ({exc.response.status_code}): {exc.response.text}"
            ) from exc
        except httpx.HTTPError as exc:
            raise CollectionError(f"DDIN login transport error: {exc}") from exc

        self._store_tokens(resp, context="login")
        logger.info("ddin_login_succeeded")

    async def _refresh_token(self) -> None:
        if not self._token_state.refresh_token:
            raise _DDINRefreshError("no refresh token available")
        try:
            resp = await self._request_with_retry(
                "POST",
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
            raise CollectionError(
                f"DDIN {context} response was not valid JSON: {resp.text}"
            ) from exc

        # CONFIRMED live: login nests tokens under "data"; refresh does not.
        # Handle both without caring which endpoint produced this response.
        envelope = data.get("data") if isinstance(data.get("data"), dict) else data
        access_token = envelope.get("accessToken") or envelope.get("access_token")
        refresh_token = envelope.get("refreshToken") or envelope.get("refresh_token")
        if not access_token or not refresh_token:
            raise CollectionError(
                f"DDIN {context} response missing accessToken/refreshToken: {data}"
            )

        self._token_state.access_token = access_token
        self._token_state.refresh_token = refresh_token
        self._token_state.version += 1

    # -- Collection dispatch -------------------------------------------------

    async def _dispatch_collection(
        self,
        provider: str,
        customer_account_number: str,
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
            "customerAccountNumber": customer_account_number,
            "customerName": customer_name,
            "amount": str(amount),
            "referenceId": reference_id,
        }

        try:
            resp = await self._request_with_retry(
                "POST", self._settings.ddin_collection_path, json=payload, headers=headers
            )
        except httpx.TimeoutException as exc:
            raise CollectionError(f"DDIN collection request timed out: {exc}") from exc
        except httpx.HTTPError as exc:
            raise CollectionError(f"DDIN collection transport error: {exc}") from exc

        if resp.status_code == 401:
            raise _DDINUnauthorizedError()

        if resp.is_error:
            raise CollectionError(self._format_error(resp))

        try:
            data = resp.json()
        except ValueError as exc:
            raise CollectionError(
                f"DDIN collection response was not valid JSON: {resp.text}"
            ) from exc

        # CONFIRMED live: a successful call to /v1/momo/collection/initiate
        # returns HTTP 202 (not 200) with the payload nested under "data" and
        # a "status" field. Observed value: "status": "pending",
        # "transactionId": null - DDIN does NOT resolve the transaction in
        # this response; the real outcome arrives later via the
        # collection.success / collection.failed webhook (see class
        # docstring). "pending" specifically means "wait for the webhook", not
        # "failed" - raising CollectionError here would trigger an immediate
        # Fineract refund for a transaction that may still succeed. Any OTHER
        # non-success status is a genuine synchronous rejection and still
        # fails immediately below.
        envelope = data.get("data") if isinstance(data.get("data"), dict) else data
        status = envelope.get("status")
        if status and status.lower() == "pending":
            raise CollectionPending(
                operation_reference_id=envelope.get("operationReferenceId")
            )
        if status and status.lower() not in ("success", "successful", "completed"):
            raise CollectionError(
                f"DDIN collection failed (status={status!r}); "
                f"operationReferenceId={envelope.get('operationReferenceId')}"
            )

        reference = (
            envelope.get("token")
            or envelope.get("transactionReference")
            or envelope.get("transactionId")
            or envelope.get("reference")
        )
        if not reference:
            raise CollectionError(
                f"DDIN collection response missing a token/reference field: {data}"
            )

        logger.info(
            "ddin_collection_succeeded",
            extra={
                "provider": provider,
                "customer_account_number": customer_account_number,
                "reference_id": reference_id,
            },
        )
        return str(reference)

    # -- Status reconciliation -----------------------------------------------

    async def get_status(self, reference_id: str) -> Optional[ProviderCollectionStatus]:
        """GET {ddin_collection_status_path}/{reference_id} - see config.py
        for how this endpoint was discovered. Used to actively reconcile a
        DEBITED (awaiting-webhook) transaction with DDIN's real, current
        outcome - see CollectionOrchestrator.sync_with_provider."""
        if self._token_state.access_token is None:
            await self._ensure_logged_in()

        token_version = self._token_state.version
        try:
            return await self._fetch_status(reference_id)
        except _DDINUnauthorizedError:
            await self._renew_session(seen_version=token_version)
            try:
                return await self._fetch_status(reference_id)
            except _DDINUnauthorizedError as exc:
                raise CollectionError(
                    "DDIN rejected the status lookup with 401 even after refreshing "
                    "credentials and retrying once"
                ) from exc

    async def _fetch_status(self, reference_id: str) -> Optional[ProviderCollectionStatus]:
        headers = {"Authorization": f"Bearer {self._token_state.access_token}"}
        try:
            resp = await self._request_with_retry(
                "GET",
                f"{self._settings.ddin_collection_status_path}/{reference_id}",
                headers=headers,
            )
        except httpx.TimeoutException as exc:
            raise CollectionError(f"DDIN status lookup timed out: {exc}") from exc
        except httpx.HTTPError as exc:
            raise CollectionError(f"DDIN status lookup transport error: {exc}") from exc

        if resp.status_code == 401:
            raise _DDINUnauthorizedError()

        if resp.status_code == 404:
            # CONFIRMED live: a genuinely unknown reference returns 404 with a
            # real JSON body {"success": false, "message": "Transaction not
            # found"}. If it's NOT valid JSON, this 404 is a routing error
            # (wrong path), not "unknown transaction" - don't mask that as
            # "still pending" forever.
            try:
                resp.json()
            except ValueError as exc:
                raise CollectionError(
                    f"DDIN status endpoint returned 404 (check ddin_collection_status_path): "
                    f"{resp.text[:200]}"
                ) from exc
            return None

        if resp.is_error:
            raise CollectionError(self._format_error(resp))

        try:
            data = resp.json()
        except ValueError as exc:
            raise CollectionError(f"DDIN status response was not valid JSON: {resp.text}") from exc

        envelope = data.get("data") if isinstance(data.get("data"), dict) else data
        status = envelope.get("status")
        reference = envelope.get("transactionId") or envelope.get("operationReferenceId")
        return ProviderCollectionStatus(
            status=str(status).lower() if status else "",
            message=envelope.get("message"),
            provider_transaction_reference=str(reference) if reference else None,
            customer_name=envelope.get("customerName"),
        )

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


def get_collection_provider(settings: Settings) -> CollectionProvider:
    if settings.collection_provider_name == "ddin":
        return DDINCollectionProvider(settings)
    raise ValueError(f"Unknown collection_provider_name: {settings.collection_provider_name}")
