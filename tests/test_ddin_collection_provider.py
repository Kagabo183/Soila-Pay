import json
from decimal import Decimal

import httpx
import pytest
import respx

from app.config import Settings
from app.exceptions import CollectionError, CollectionPending
from app.services.collection_provider import DDINCollectionProvider

pytestmark = pytest.mark.asyncio


@pytest.fixture
def settings() -> Settings:
    return Settings(
        ddin_base_url="https://ddin.test",
        ddin_username="testuser",
        ddin_password="testpass",
    )


def login_response(access="access-1", refresh="refresh-1"):
    # CONFIRMED live shape: login's token pair is nested under "data".
    return httpx.Response(
        200,
        json={"success": True, "data": {"accessToken": access, "refreshToken": refresh}},
    )


def refresh_response(access="access-2", refresh="refresh-2"):
    # CONFIRMED live shape: refresh's token pair is top-level, NOT nested.
    return httpx.Response(200, json={"success": True, "accessToken": access, "refreshToken": refresh})


async def test_first_collect_logs_in_then_dispatches(settings):
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        login_route = mock.post(settings.ddin_login_path).mock(return_value=login_response())
        collect_route = mock.post(settings.ddin_collection_path).mock(
            return_value=httpx.Response(200, json={"token": "TXN-001"})
        )

        result = await provider.collect(
            "MTN", "0788123456", Decimal("5000"), reference_id="idem-001", customer_name="Jean Uwimana"
        )

        assert result == "TXN-001"
        assert login_route.call_count == 1
        assert collect_route.call_count == 1
        request = collect_route.calls[0].request
        assert request.headers["Authorization"] == "Bearer access-1"
        # CONFIRMED request field names (validation-error probe against the
        # real sandbox): provider, customerAccountNumber, customerName,
        # amount, referenceId.

        body = json.loads(request.content)
        assert body == {
            "provider": "MTN",
            "customerAccountNumber": "0788123456",
            "customerName": "Jean Uwimana",
            "amount": "5000",
            "referenceId": "idem-001",
        }

    await provider.aclose()


async def test_collect_defaults_reference_id_and_customer_name_when_omitted(settings):
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        collect_route = mock.post(settings.ddin_collection_path).mock(
            return_value=httpx.Response(200, json={"token": "TXN-001"})
        )

        await provider.collect("MTN", "0788123456", Decimal("5000"))

        body = json.loads(collect_route.calls[0].request.content)
        assert body["referenceId"].startswith("soila-")
        assert body["customerName"]  # non-empty placeholder when the caller omits one

    await provider.aclose()


async def test_second_collect_reuses_token_without_relogin(settings):
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        login_route = mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_collection_path).mock(
            return_value=httpx.Response(200, json={"token": "TXN-001"})
        )

        await provider.collect("MTN", "0788123456", Decimal("5000"))
        await provider.collect("MTN", "0788123456", Decimal("5000"))

        assert login_route.call_count == 1

    await provider.aclose()


async def test_401_triggers_refresh_and_succeeds_on_retry(settings):
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        refresh_route = mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        collect_route = mock.post(settings.ddin_collection_path).mock(
            side_effect=[
                httpx.Response(401, json={"message": "token expired"}),
                httpx.Response(200, json={"token": "TXN-002"}),
            ]
        )

        result = await provider.collect("MTN", "0788123456", Decimal("5000"))

        assert result == "TXN-002"
        assert refresh_route.call_count == 1
        assert collect_route.call_count == 2
        second_call_auth = collect_route.calls[1].request.headers["Authorization"]
        assert second_call_auth == "Bearer access-2"

    await provider.aclose()


async def test_refresh_failure_falls_back_to_full_login(settings):
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        login_route = mock.post(settings.ddin_login_path).mock(
            side_effect=[login_response(), login_response(access="access-3", refresh="refresh-3")]
        )
        mock.post(settings.ddin_refresh_path).mock(return_value=httpx.Response(400, json={"message": "expired"}))
        mock.post(settings.ddin_collection_path).mock(
            side_effect=[
                httpx.Response(401, json={"message": "token expired"}),
                httpx.Response(200, json={"token": "TXN-003"}),
            ]
        )

        result = await provider.collect("MTN", "0788123456", Decimal("5000"))

        assert result == "TXN-003"
        assert login_route.call_count == 2  # initial login + fallback re-login after failed refresh

    await provider.aclose()


async def test_persistent_401_raises_collection_error(settings):
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        mock.post(settings.ddin_collection_path).mock(
            return_value=httpx.Response(401, json={"message": "still unauthorized"})
        )

        with pytest.raises(CollectionError):
            await provider.collect("MTN", "0788123456", Decimal("5000"))

    await provider.aclose()


async def test_missing_credentials_raises_clear_error():
    settings = Settings(ddin_base_url="https://ddin.test", ddin_username="", ddin_password="")
    provider = DDINCollectionProvider(settings)

    with pytest.raises(CollectionError, match="not configured"):
        await provider.collect("MTN", "0788123456", Decimal("5000"))

    await provider.aclose()


async def test_pending_status_raises_pending_not_failure(settings):
    """
    CONFIRMED live behavior: a real sandbox call to collection/initiate
    returned HTTP 202 with {"data": {"status": "pending", "transactionId":
    null, "operationReferenceId": "..."}}. DDIN has NOT resolved the
    transaction yet at this point - treating it as a synchronous success OR
    failure would both be wrong; the real outcome arrives later via DDIN's
    collection.success/collection.failed webhook (see
    CollectionOrchestrator.resolve_provider_success/failure and
    app/api/v1/webhooks.py). This must raise CollectionPending specifically,
    carrying operationReferenceId for tracing, NOT CollectionError (which
    would wrongly trigger an immediate refund).
    """
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_collection_path).mock(
            return_value=httpx.Response(
                202,
                json={
                    "success": True,
                    "message": "Money collection initiated successfully",
                    "data": {
                        "referenceId": "soila-probe-test-0001",
                        "operationReferenceId": "2419cd74-faa6-4688-bcae-167f0bd59fd5",
                        "status": "pending",
                        "transactionMessage": "Transaction initiated successfully",
                        "transactionId": None,
                    },
                },
            )
        )

        with pytest.raises(CollectionPending) as exc_info:
            await provider.collect("MTN", "0788123456", Decimal("100"))
        assert exc_info.value.operation_reference_id == "2419cd74-faa6-4688-bcae-167f0bd59fd5"

    await provider.aclose()


async def test_business_error_maps_to_collection_error(settings):
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_collection_path).mock(
            return_value=httpx.Response(422, json={"message": "insufficient float balance"})
        )

        with pytest.raises(CollectionError, match="insufficient float balance"):
            await provider.collect("MTN", "0788123456", Decimal("5000"))

    await provider.aclose()


async def test_collect_required_fields_probed_live_match_confirmed_shape(settings):
    """Guards the CONFIRMED collection request contract from silent drift."""
    provider = DDINCollectionProvider(settings)

    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        collect_route = mock.post(settings.ddin_collection_path).mock(
            return_value=httpx.Response(200, json={"token": "TXN-004"})
        )

        await provider.collect(
            "MTN", "0799988776", Decimal("1500.50"), reference_id="idem-xyz", customer_name="Alice Mukamana"
        )

        body = json.loads(collect_route.calls[0].request.content)
        assert set(body.keys()) == {
            "provider",
            "customerAccountNumber",
            "customerName",
            "amount",
            "referenceId",
        }

    await provider.aclose()


@pytest.fixture
def fast_retry_settings() -> Settings:
    # Same as `settings`, but with near-zero backoff so retry tests don't
    # actually sleep for real wall-clock time.
    return Settings(
        ddin_base_url="https://ddin.test",
        ddin_username="testuser",
        ddin_password="testpass",
        ddin_retry_max_attempts=3,
        ddin_retry_backoff_base_seconds=0.001,
    )


async def test_transient_connection_error_is_retried_then_succeeds(fast_retry_settings):
    provider = DDINCollectionProvider(fast_retry_settings)

    with respx.mock(base_url=fast_retry_settings.ddin_base_url) as mock:
        mock.post(fast_retry_settings.ddin_login_path).mock(
            side_effect=[httpx.ConnectError("connection refused"), login_response()]
        )
        collect_route = mock.post(fast_retry_settings.ddin_collection_path).mock(
            return_value=httpx.Response(200, json={"token": "TXN-005"})
        )

        result = await provider.collect("MTN", "0788123456", Decimal("5000"))

        assert result == "TXN-005"
        assert collect_route.call_count == 1  # login succeeded on retry before ever reaching collect

    await provider.aclose()


async def test_persistent_5xx_is_retried_then_still_fails_as_collection_error(fast_retry_settings):
    provider = DDINCollectionProvider(fast_retry_settings)

    with respx.mock(base_url=fast_retry_settings.ddin_base_url) as mock:
        mock.post(fast_retry_settings.ddin_login_path).mock(return_value=login_response())
        collect_route = mock.post(fast_retry_settings.ddin_collection_path).mock(
            return_value=httpx.Response(503, text="sandbox unavailable")
        )

        with pytest.raises(CollectionError, match="503"):
            await provider.collect("MTN", "0788123456", Decimal("5000"))

        # Retried up to ddin_retry_max_attempts, not just once.
        assert collect_route.call_count == fast_retry_settings.ddin_retry_max_attempts

    await provider.aclose()


async def test_4xx_is_never_retried(fast_retry_settings):
    provider = DDINCollectionProvider(fast_retry_settings)

    with respx.mock(base_url=fast_retry_settings.ddin_base_url) as mock:
        mock.post(fast_retry_settings.ddin_login_path).mock(return_value=login_response())
        collect_route = mock.post(fast_retry_settings.ddin_collection_path).mock(
            return_value=httpx.Response(422, json={"message": "insufficient float balance"})
        )

        with pytest.raises(CollectionError):
            await provider.collect("MTN", "0788123456", Decimal("5000"))

        # A genuine business rejection - retrying it cannot help, so exactly one call.
        assert collect_route.call_count == 1

    await provider.aclose()
