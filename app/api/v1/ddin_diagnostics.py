import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.api.v1.deps import rate_limit_ddin_calls
from app.config import settings
from app.schemas.ddin_diagnostics import (
    DdinConnectionInfo,
    DdinDiagnosticsRequest,
    DdinDiagnosticsResult,
    DdinPingResponse,
)
from app.services.ddin_diagnostics import run_ddin_diagnostics, stream_ddin_diagnostics

logger = logging.getLogger(__name__)

router = APIRouter()

API_PATH_VERSION = "v1"
MIDDLEWARE_VERSION = "1.0.0"


async def _persist_run(request: Request, result: DdinDiagnosticsResult) -> None:
    """Best-effort: a diagnostics run is still useful to the caller even if
    saving its history fails (e.g. DB hiccup) - never let this raise."""
    try:
        await request.app.state.ddin_diagnostics_repo.insert_run(result)
    except Exception:  # noqa: BLE001
        logger.exception("ddin_diagnostics_history_persist_failed")


@router.post("/diagnostics", response_model=DdinDiagnosticsResult, dependencies=[Depends(rate_limit_ddin_calls)])
async def run_diagnostics(request: Request, body: DdinDiagnosticsRequest = DdinDiagnosticsRequest()):
    """Live connectivity check against DDIN's real sandbox - login, token
    refresh, and a balance lookup, exactly the sequence in DDIN's own
    "Getting Started" docs. Never touches Fineract or our own
    transaction_logs. See app/services/ddin_diagnostics.py. For real-time,
    step-by-step progress use POST /diagnostics/stream instead - this
    endpoint waits for the full chain before responding."""
    result = await run_ddin_diagnostics(settings, body)
    logger.info(
        "ddin_diagnostics_run",
        extra={
            "correlation_id": result.correlation_id,
            "overall_status": result.overall_status,
            "run_test_collection": body.run_test_collection,
        },
    )
    await _persist_run(request, result)
    return result


@router.post("/diagnostics/stream", dependencies=[Depends(rate_limit_ddin_calls)])
async def stream_diagnostics(request: Request, body: DdinDiagnosticsRequest = DdinDiagnosticsRequest()):
    """Same checks as POST /diagnostics, but streamed as newline-delimited
    JSON (one DdinDiagnosticStep object per line) as each step completes,
    instead of waiting for the whole chain. Consumed with fetch() +
    ReadableStream on the frontend - see ddin-diagnostics.service.ts. Also
    persists the completed run to history, same as the non-streaming endpoint."""
    async def generate():
        collected = []
        async for step in stream_ddin_diagnostics(settings, body):
            collected.append(step)
            yield step.model_dump_json() + "\n"

        if collected:
            overall_status = "PASS" if all(s.status != "FAIL" for s in collected) else "FAIL"
            total_duration_ms = sum(s.latency_ms or 0 for s in collected)
            result = DdinDiagnosticsResult(
                overall_status=overall_status,
                base_url=settings.ddin_base_url,
                correlation_id=collected[0].correlation_id,
                steps=collected,
                ran_at=collected[0].started_at,
                total_duration_ms=total_duration_ms,
            )
            await _persist_run(request, result)

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@router.get("/diagnostics/history", response_model=list[DdinDiagnosticsResult])
async def diagnostics_history(request: Request, limit: int = 20):
    """Server-side run history - survives a page reload, unlike the previous
    session-only log viewer."""
    rows = await request.app.state.ddin_diagnostics_repo.list_runs(limit)
    return [
        DdinDiagnosticsResult(
            overall_status=row["overall_status"],
            base_url=row["base_url"],
            correlation_id=row["correlation_id"],
            steps=row["steps"],
            ran_at=row["ran_at"],
            total_duration_ms=row["total_duration_ms"],
        )
        for row in rows
    ]


@router.get("/ping", response_model=DdinPingResponse, dependencies=[Depends(rate_limit_ddin_calls)])
async def ping():
    """Lightweight uptime check (login only - no refresh/balance/collection
    calls) for monitors that prefer GET over POSTing a JSON body. Shares the
    same DDIN rate-limit budget as the full diagnostics run."""
    result = await run_ddin_diagnostics(
        settings, DdinDiagnosticsRequest(include_refresh=False, include_balance=False)
    )
    login_step = next((s for s in result.steps if s.step == "login"), None)
    config_step = next((s for s in result.steps if s.step == "config"), None)
    if config_step and config_step.status == "FAIL":
        return DdinPingResponse(reachable=False, message=config_step.message)
    if login_step is None:
        return DdinPingResponse(reachable=False, message="Login step did not run")
    return DdinPingResponse(
        reachable=login_step.status == "PASS",
        latency_ms=login_step.latency_ms,
        message=login_step.message,
    )


@router.get("/connection-info", response_model=DdinConnectionInfo)
async def connection_info():
    """Static configuration snapshot for the diagnostics page's "Connection
    Details" panel - no network call, just reports what we're configured to
    talk to."""
    return DdinConnectionInfo(
        middleware_version=MIDDLEWARE_VERSION,
        api_path_version=API_PATH_VERSION,
        ddin_base_url=settings.ddin_base_url,
        ddin_login_path=settings.ddin_login_path,
        ddin_refresh_path=settings.ddin_refresh_path,
        ddin_balance_path=settings.ddin_balance_path,
        ddin_collection_path=settings.ddin_collection_path,
        environment=settings.app_env,
        authentication_method="Bearer token (username/password login)",
        tls_enabled=settings.ddin_base_url.startswith("https://"),
        request_timeout_seconds=settings.ddin_timeout_seconds,
        retry_policy=(
            f"Up to {settings.ddin_retry_max_attempts} attempts with exponential backoff "
            "for timeouts/connection errors/5xx - never for 401/403 or other 4xx"
        ),
        credentials_configured=bool(settings.ddin_username and settings.ddin_password),
        webhook_secret_configured=bool(settings.ddin_webhook_secret),
    )
