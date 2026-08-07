import asyncio
import logging
import uuid
from datetime import date
from decimal import Decimal

import httpx

from app.config import Settings
from app.exceptions import FineractError

logger = logging.getLogger(__name__)

# Fineract's dateFormat tokens map onto strftime as: dd -> %d, MMMM -> %B, yyyy -> %Y.
# This only covers the default "dd MMMM yyyy" format configured in Settings; if that
# setting is changed, this mapping must be revisited.
_FINERACT_DATE_STRFTIME = "%d %B %Y"


class FineractClient:
    """
    Thin async wrapper around the Fineract savings account transactions API.

    ASSUMPTIONS TO VALIDATE AGAINST THE LIVE FINERACT INSTANCE (see plan doc):
      1. `command=withdrawal` / `command=deposit` on
         POST /savingsaccounts/{accountId}/transactions is the correct action, and the
         response contains the new transaction id under `resourceId` (and account id
         under `savingsId`). Some Fineract versions/configs may differ - confirm with
         one manual call before relying on this in production.
      2. `paymentTypeId` (Settings.fineract_payment_type_id) must reference a real,
         existing payment type configured on the target tenant. The default of `1` is
         a placeholder.
      3. `transactionDate` formatting must match `dateFormat` + `locale` exactly, or
         Fineract will reject the request.
      4. Basic Auth + `Fineract-Platform-TenantId` header is assumed sufficient (no
         OAuth2/Keycloak layer). Adjust if the target deployment uses OAuth2.
      5. A business-rule rejection (e.g. insufficient balance) is assumed to come back
         as a non-2xx response with an `errors` array, not a 200 with an embedded
         error flag. `raise_for_status()` below treats any non-2xx as a hard failure.
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.fineract_base_url,
            auth=(settings.fineract_username, settings.fineract_password),
            verify=settings.fineract_ssl_verify,
            headers={"Fineract-Platform-TenantId": settings.fineract_tenant_id},
            timeout=settings.fineract_timeout_seconds,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def withdraw(self, account_id: str, amount: Decimal, note: str) -> str:
        return await self._transact(account_id, amount, note, command="withdrawal")

    async def deposit(self, account_id: str, amount: Decimal, note: str) -> str:
        return await self._transact(account_id, amount, note, command="deposit")

    async def _transact(
        self, account_id: str, amount: Decimal, note: str, command: str
    ) -> str:
        payload = {
            "transactionDate": date.today().strftime(_FINERACT_DATE_STRFTIME),
            "transactionAmount": str(amount),
            "paymentTypeId": self._settings.fineract_payment_type_id,
            "note": note,
            "locale": self._settings.fineract_locale,
            "dateFormat": self._settings.fineract_date_format,
        }
        try:
            resp = await self._client.post(
                f"/savingsaccounts/{account_id}/transactions",
                params={"command": command},
                json=payload,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "fineract_transaction_failed",
                extra={
                    "command": command,
                    "account_id": account_id,
                    "status_code": exc.response.status_code,
                    "response_body": exc.response.text,
                },
            )
            raise FineractError(
                f"Fineract {command} failed ({exc.response.status_code}): {exc.response.text}"
            ) from exc
        except httpx.HTTPError as exc:
            logger.error(
                "fineract_transaction_transport_error",
                extra={"command": command, "account_id": account_id, "error": str(exc)},
            )
            raise FineractError(f"Fineract {command} transport error: {exc}") from exc

        data = resp.json()
        transaction_id = data.get("resourceId")
        if transaction_id is None:
            raise FineractError(
                f"Fineract {command} response missing 'resourceId': {data}"
            )
        return str(transaction_id)


class DummyFineractClient:
    """
    Local stand-in for FineractClient, used only for sandbox-key traffic (see
    app.state.sandbox_orchestrator in main.py) - the same role
    DummyCollectionProvider plays for DDIN. Apache Fineract is a separate,
    external core-banking platform (not part of this repo) that has to be run
    on its own; without it reachable at FINERACT_BASE_URL, every collection -
    sandbox or production - fails at the debit step before ever reaching
    DDIN. This lets a sandbox key exercise the full debit -> collect -> refund
    flow locally, exactly like the dummy DDIN provider does, without standing
    up Fineract. Production traffic always uses the real FineractClient above.
    """

    def __init__(self, settings: Settings):
        self._settings = settings

    async def aclose(self) -> None:
        return None

    async def withdraw(self, account_id: str, amount: Decimal, note: str) -> str:
        return await self._transact()

    async def deposit(self, account_id: str, amount: Decimal, note: str) -> str:
        return await self._transact()

    async def _transact(self) -> str:
        await asyncio.sleep(self._settings.collection_dummy_latency_seconds)
        return f"SANDBOX-FIN-{uuid.uuid4().hex[:10].upper()}"
