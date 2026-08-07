from decimal import Decimal

import httpx
import pytest
import respx

from app.config import Settings
from app.exceptions import FineractError
from app.services.fineract_client import FineractClient

pytestmark = pytest.mark.asyncio


@pytest.fixture
def settings() -> Settings:
    return Settings(fineract_base_url="https://fineract.test/fineract-provider/api/v1")


async def test_withdraw_sends_expected_payload_and_returns_transaction_id(settings):
    client = FineractClient(settings)

    with respx.mock(base_url=settings.fineract_base_url) as mock:
        route = mock.post("/savingsaccounts/12345/transactions").mock(
            return_value=httpx.Response(200, json={"savingsId": 12345, "resourceId": 9001})
        )

        txn_id = await client.withdraw("12345", Decimal("5000"), "test note")

        assert txn_id == "9001"
        request = route.calls[0].request
        assert request.url.params["command"] == "withdrawal"

    await client.aclose()


async def test_withdraw_raises_fineract_error_on_non_2xx(settings):
    client = FineractClient(settings)

    with respx.mock(base_url=settings.fineract_base_url) as mock:
        mock.post("/savingsaccounts/12345/transactions").mock(
            return_value=httpx.Response(400, json={"errors": [{"defaultUserMessage": "Insufficient balance"}]})
        )

        with pytest.raises(FineractError):
            await client.withdraw("12345", Decimal("5000"), "test note")

    await client.aclose()


async def test_deposit_uses_deposit_command(settings):
    client = FineractClient(settings)

    with respx.mock(base_url=settings.fineract_base_url) as mock:
        route = mock.post("/savingsaccounts/12345/transactions").mock(
            return_value=httpx.Response(200, json={"savingsId": 12345, "resourceId": 9002})
        )

        txn_id = await client.deposit("12345", Decimal("5000"), "refund note")

        assert txn_id == "9002"
        assert route.calls[0].request.url.params["command"] == "deposit"

    await client.aclose()
