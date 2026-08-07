import httpx
import pytest
import respx

from app.config import Settings
from app.schemas.ddin_diagnostics import DdinDiagnosticsRequest
from app.services.ddin_diagnostics import run_ddin_diagnostics, stream_ddin_diagnostics

pytestmark = pytest.mark.asyncio


@pytest.fixture
def settings() -> Settings:
    return Settings(
        ddin_base_url="https://ddin.test",
        ddin_username="testuser",
        ddin_password="testpass",
    )


def steps_by_name(result):
    return {s.step: s for s in result.steps}


def login_response(access="access-1", refresh="refresh-1"):
    return httpx.Response(
        200, json={"success": True, "data": {"accessToken": access, "refreshToken": refresh}}
    )


def refresh_response(access="access-2", refresh="refresh-2"):
    return httpx.Response(200, json={"success": True, "accessToken": access, "refreshToken": refresh})


async def test_missing_credentials_fails_fast_without_a_network_call():
    settings = Settings(ddin_base_url="https://ddin.test", ddin_username="", ddin_password="")

    result = await run_ddin_diagnostics(settings)

    assert result.overall_status == "FAIL"
    steps = steps_by_name(result)
    assert steps["config"].status == "FAIL"
    assert steps["config"].category == "CONFIG"
    assert steps["login"].status == "SKIPPED"
    assert steps["balance"].status == "SKIPPED"


async def test_full_success_path(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        mock.get(settings.ddin_balance_path).mock(
            return_value=httpx.Response(200, json={"data": [{"currency": "RWF", "balance": 500000}]})
        )

        result = await run_ddin_diagnostics(settings)

    assert result.overall_status == "PASS"
    steps = steps_by_name(result)
    assert steps["config"].status == "PASS"
    assert steps["login"].status == "PASS"
    assert steps["refresh_token"].status == "PASS"
    assert steps["balance"].status == "PASS"
    assert steps["test_collection"].status == "SKIPPED"
    assert steps["balance"].detail is not None
    assert result.total_duration_ms >= 0


async def test_all_steps_share_the_same_correlation_id(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        mock.get(settings.ddin_balance_path).mock(return_value=httpx.Response(200, json={"data": []}))

        result = await run_ddin_diagnostics(settings)

    correlation_ids = {s.correlation_id for s in result.steps}
    assert len(correlation_ids) == 1
    assert result.correlation_id in correlation_ids


async def test_login_failure_skips_remaining_steps_with_unauthorized_category(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(
            return_value=httpx.Response(401, json={"message": "invalid credentials"})
        )

        result = await run_ddin_diagnostics(settings)

    assert result.overall_status == "FAIL"
    steps = steps_by_name(result)
    assert steps["login"].status == "FAIL"
    assert steps["login"].category == "UNAUTHORIZED"
    assert steps["login"].troubleshooting  # non-empty, actionable
    assert "401" in steps["login"].message
    assert steps["refresh_token"].status == "SKIPPED"
    assert steps["balance"].status == "SKIPPED"
    assert steps["test_collection"].status == "SKIPPED"


async def test_login_request_response_masks_password_and_never_leaks_token(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response(access="super-secret-token"))
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        mock.get(settings.ddin_balance_path).mock(return_value=httpx.Response(200, json={"data": []}))

        result = await run_ddin_diagnostics(settings)

    login_step = steps_by_name(result)["login"]
    assert login_step.request_response is not None
    assert login_step.request_response.body["password"] == "********"
    # The real access token must never appear anywhere in the serialized result.
    assert "super-secret-token" not in result.model_dump_json()


async def test_balance_request_masks_authorization_header(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response(access="super-secret-token"))
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response(access="refreshed-secret"))
        mock.get(settings.ddin_balance_path).mock(return_value=httpx.Response(200, json={"data": []}))

        result = await run_ddin_diagnostics(settings)

    balance_step = steps_by_name(result)["balance"]
    assert balance_step.request_response.headers["Authorization"] == "Bearer ********"
    assert "refreshed-secret" not in result.model_dump_json()


async def test_connect_error_classified_as_network(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(side_effect=httpx.ConnectError("Connection refused"))

        result = await run_ddin_diagnostics(settings)

    login_step = steps_by_name(result)["login"]
    assert login_step.status == "FAIL"
    assert login_step.category == "NETWORK"


async def test_timeout_classified_as_timeout(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(side_effect=httpx.ConnectTimeout("timed out"))

        result = await run_ddin_diagnostics(settings)

    login_step = steps_by_name(result)["login"]
    assert login_step.status == "FAIL"
    assert login_step.category == "TIMEOUT"


async def test_5xx_classified_as_ddin_unavailable(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=httpx.Response(503, text="down for maintenance"))

        result = await run_ddin_diagnostics(settings)

    login_step = steps_by_name(result)["login"]
    assert login_step.category == "DDIN_UNAVAILABLE"


async def test_balance_failure_marks_overall_fail_even_though_login_succeeded(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        mock.get(settings.ddin_balance_path).mock(return_value=httpx.Response(500, text="boom"))

        result = await run_ddin_diagnostics(settings)

    assert result.overall_status == "FAIL"
    steps = steps_by_name(result)
    assert steps["login"].status == "PASS"
    assert steps["balance"].status == "FAIL"


async def test_include_refresh_false_skips_refresh_but_still_checks_balance(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.get(settings.ddin_balance_path).mock(return_value=httpx.Response(200, json={"data": []}))

        result = await run_ddin_diagnostics(settings, DdinDiagnosticsRequest(include_refresh=False))

    steps = steps_by_name(result)
    assert steps["refresh_token"].status == "SKIPPED"
    assert steps["balance"].status == "PASS"


async def test_include_balance_false_skips_balance(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())

        result = await run_ddin_diagnostics(settings, DdinDiagnosticsRequest(include_balance=False))

    assert steps_by_name(result)["balance"].status == "SKIPPED"


async def test_optional_test_collection_reports_pending_as_pass(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        mock.get(settings.ddin_balance_path).mock(return_value=httpx.Response(200, json={"data": []}))
        mock.post(settings.ddin_collection_path).mock(
            return_value=httpx.Response(
                202, json={"data": {"status": "pending", "operationReferenceId": "op-123"}}
            )
        )

        result = await run_ddin_diagnostics(settings, DdinDiagnosticsRequest(run_test_collection=True))

    steps = steps_by_name(result)
    assert steps["test_collection"].status == "PASS"
    assert steps["test_collection"].detail["data"]["operationReferenceId"] == "op-123"
    # A "pending" acknowledgment still counts as connectivity working.
    assert result.overall_status == "PASS"


async def test_test_collection_not_requested_is_skipped(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        mock.get(settings.ddin_balance_path).mock(return_value=httpx.Response(200, json={"data": []}))

        result = await run_ddin_diagnostics(settings, DdinDiagnosticsRequest(run_test_collection=False))

    assert steps_by_name(result)["test_collection"].status == "SKIPPED"


async def test_stream_yields_steps_incrementally(settings):
    with respx.mock(base_url=settings.ddin_base_url) as mock:
        mock.post(settings.ddin_login_path).mock(return_value=login_response())
        mock.post(settings.ddin_refresh_path).mock(return_value=refresh_response())
        mock.get(settings.ddin_balance_path).mock(return_value=httpx.Response(200, json={"data": []}))

        seen = []
        async for step in stream_ddin_diagnostics(settings, DdinDiagnosticsRequest()):
            seen.append(step.step)

    assert seen == ["config", "login", "refresh_token", "balance", "test_collection"]
