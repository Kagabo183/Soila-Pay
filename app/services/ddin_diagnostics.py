import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, AsyncGenerator, Optional

import httpx

from app.config import Settings
from app.schemas.ddin_diagnostics import (
    DdinDiagnosticsRequest,
    DdinDiagnosticsResult,
    DdinDiagnosticStep,
    DiagnosticHttpDetail,
    ErrorCategory,
)

logger = logging.getLogger(__name__)


@dataclass
class _StepResult:
    """What _run_step actually needs to hand back to its caller: the
    client-safe (masked) step for the API/UI, plus the UNMASKED raw response
    body needed only internally to chain tokens between steps
    (login -> refresh -> balance). Named in place of a bare tuple so call
    sites read as `result.step` / `result.raw_body`, not `result[0]` / `[1]`."""

    step: DdinDiagnosticStep
    raw_body: Optional[dict[str, Any]]

# A deliberately implausible test collection - real enough to reach DDIN's
# collection/initiate endpoint and prove connectivity/auth, but obviously not
# a real customer. Only used when the caller explicitly opts in.
TEST_COLLECTION_ACCOUNT_NUMBER = "0700000000"
TEST_COLLECTION_AMOUNT = Decimal("100")

_SENSITIVE_HEADER_NAMES = {"authorization"}
_SENSITIVE_BODY_FIELDS = {"password", "accesstoken", "refreshtoken", "access_token", "refresh_token"}


def _mask_headers(headers: dict[str, str]) -> dict[str, str]:
    masked: dict[str, str] = {}
    for key, value in headers.items():
        if key.lower() in _SENSITIVE_HEADER_NAMES:
            # Never echo any part of a real token back to the client.
            masked[key] = "Bearer ********" if value.lower().startswith("bearer") else "********"
        else:
            masked[key] = value
    return masked


def _mask_sensitive(value: Any) -> Any:
    """Recursively masks password/token fields at any nesting depth - DDIN
    nests tokens under a "data" envelope on login but not on refresh, so this
    must not assume a fixed shape. Used for BOTH outgoing request bodies and
    incoming response bodies before either is ever placed on a
    DdinDiagnosticStep that gets serialized back to the client."""
    if isinstance(value, dict):
        return {
            k: ("********" if k.lower() in _SENSITIVE_BODY_FIELDS else _mask_sensitive(v))
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_mask_sensitive(v) for v in value]
    return value


def _classify_transport_error(exc: Exception) -> tuple[ErrorCategory, str, list[str]]:
    if isinstance(exc, httpx.TimeoutException):
        return (
            "TIMEOUT",
            f"Request timed out: {exc}",
            [
                "DDIN's sandbox may be slow or unreachable right now - retry in a moment",
                "Increase DDIN_TIMEOUT_SECONDS in .env if this happens consistently on a slow network",
            ],
        )
    if isinstance(exc, httpx.ConnectError):
        text = str(exc).lower()
        if "certificate" in text or "ssl" in text or "tls" in text:
            return (
                "TLS",
                f"TLS/SSL handshake failed: {exc}",
                [
                    "Verify DDIN_BASE_URL uses https:// and the host serves a valid certificate",
                    "Check the system clock - a wrong date/time breaks certificate validation",
                    "Corporate proxies that intercept TLS can also cause this - try from an unrestricted network",
                ],
            )
        return (
            "NETWORK",
            f"Could not connect: {exc}",
            [
                "Confirm DNS resolves for the DDIN base URL (try `nslookup` on the host)",
                "Check outbound firewall/proxy rules allow HTTPS to DDIN's sandbox",
                "Verify DDIN_BASE_URL in .env is spelled correctly",
            ],
        )
    if isinstance(exc, httpx.HTTPError):
        return (
            "NETWORK",
            f"Transport error: {exc}",
            ["Check network connectivity between the middleware and DDIN", "Retry the request"],
        )
    return ("UNEXPECTED", f"Unexpected error: {exc}", ["Check the middleware's application logs for a full stack trace"])


def _classify_http_status(status_code: int) -> tuple[ErrorCategory, list[str]]:
    if status_code in (401, 403):
        return (
            "UNAUTHORIZED",
            [
                "Verify DDIN_USERNAME and DDIN_PASSWORD in .env are correct",
                "Confirm the sandbox account is active and hasn't been rate-limited or disabled",
                "If this previously worked, the credential may have been rotated on DDIN's side",
            ],
        )
    if status_code == 429:
        return ("TIMEOUT", ["DDIN is rate-limiting requests - back off and retry after a delay"])
    if status_code >= 500:
        return (
            "DDIN_UNAVAILABLE",
            [
                "This looks like an outage or degradation on DDIN's side, not ours",
                "Retry after a short delay",
                "Check with DDIN if this persists",
            ],
        )
    return ("UNEXPECTED", [f"Unexpected HTTP {status_code} - inspect the response body for detail"])


async def _run_step(
    client: httpx.AsyncClient,
    *,
    step: str,
    method: str,
    path: str,
    correlation_id: str,
    json_body: Optional[dict[str, Any]] = None,
    headers: Optional[dict[str, str]] = None,
    on_success_message: str,
) -> _StepResult:
    """Executes one HTTP call and always returns a _StepResult - never
    raises. .raw_body is the UNMASKED parsed JSON, needed internally to chain
    tokens between steps (login -> refresh -> balance); everything on
    .step itself (detail, request_response) is masked and safe to serialize
    back to the client. Callers inspect .step.status to decide whether to
    continue the chain."""
    started_at = datetime.now(timezone.utc)
    request_detail = DiagnosticHttpDetail(
        method=method,
        url=f"{client.base_url}{path}",
        headers=_mask_headers(headers or {}),
        body=_mask_sensitive(json_body) if json_body is not None else None,
    )
    start = time.monotonic()
    try:
        resp = await client.request(method, path, json=json_body, headers=headers)
        latency_ms = (time.monotonic() - start) * 1000
        request_detail.status_code = resp.status_code
        try:
            raw_body = resp.json() if resp.content else None
        except ValueError:
            raw_body = {"raw": resp.text[:500]}
        request_detail.response_body = _mask_sensitive(raw_body) if isinstance(raw_body, dict) else raw_body

        if resp.is_error:
            category, tips = _classify_http_status(resp.status_code)
            return _StepResult(
                step=DdinDiagnosticStep(
                    step=step,
                    status="FAIL",
                    latency_ms=latency_ms,
                    message=f"HTTP {resp.status_code}: {resp.text[:300]}",
                    category=category,
                    troubleshooting=tips,
                    request_response=request_detail,
                    correlation_id=correlation_id,
                    started_at=started_at,
                ),
                raw_body=None,
            )

        return _StepResult(
            step=DdinDiagnosticStep(
                step=step,
                status="PASS",
                latency_ms=latency_ms,
                message=on_success_message.format(status_code=resp.status_code),
                detail=request_detail.response_body if isinstance(request_detail.response_body, dict) else None,
                request_response=request_detail,
                correlation_id=correlation_id,
                started_at=started_at,
            ),
            raw_body=raw_body if isinstance(raw_body, dict) else None,
        )
    except Exception as exc:  # noqa: BLE001 - deliberately broad: never let a diagnostic crash the run
        latency_ms = (time.monotonic() - start) * 1000
        category, message, tips = _classify_transport_error(exc)
        return _StepResult(
            step=DdinDiagnosticStep(
                step=step,
                status="FAIL",
                latency_ms=latency_ms,
                message=message,
                category=category,
                troubleshooting=tips,
                request_response=request_detail,
                correlation_id=correlation_id,
                started_at=started_at,
            ),
            raw_body=None,
        )


def _skip(step, message: str, correlation_id: str) -> DdinDiagnosticStep:
    return DdinDiagnosticStep(
        step=step,
        status="SKIPPED",
        message=message,
        correlation_id=correlation_id,
        started_at=datetime.now(timezone.utc),
    )


def _extract_tokens(payload: Optional[dict[str, Any]]) -> tuple[Optional[str], Optional[str]]:
    if not payload:
        return None, None
    envelope = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    access = envelope.get("accessToken") or envelope.get("access_token")
    refresh = envelope.get("refreshToken") or envelope.get("refresh_token")
    return access, refresh


async def stream_ddin_diagnostics(
    settings: Settings, request: DdinDiagnosticsRequest
) -> AsyncGenerator[DdinDiagnosticStep, None]:
    """Independently verifies real connectivity to DDIN's sandbox - login,
    (optionally) token refresh, and a balance lookup, exactly following the
    "Getting Started" sequence in DDIN's own docs. Yields each step's result
    as soon as it's known, so a caller (the SSE endpoint) can stream progress
    instead of waiting for the whole chain. Never touches Fineract, our own
    transaction_logs, or DDINCollectionProvider's cached session - this is a
    fully independent, read-only-to-us reachability check."""
    correlation_id = uuid.uuid4().hex[:16]

    if not settings.ddin_username or not settings.ddin_password:
        yield DdinDiagnosticStep(
            step="config",
            status="FAIL",
            message="DDIN_USERNAME / DDIN_PASSWORD are not set in .env",
            category="CONFIG",
            troubleshooting=[
                "Add DDIN_USERNAME and DDIN_PASSWORD to your .env file with real sandbox credentials",
                "Restart the middleware after editing .env",
            ],
            correlation_id=correlation_id,
            started_at=datetime.now(timezone.utc),
        )
        for step_name in ("login", "refresh_token", "balance", "test_collection"):
            yield _skip(step_name, "Skipped - credentials not configured", correlation_id)
        return

    yield DdinDiagnosticStep(
        step="config",
        status="PASS",
        message=f"DDIN_USERNAME set; targeting {settings.ddin_base_url}",
        correlation_id=correlation_id,
        started_at=datetime.now(timezone.utc),
    )

    access_token: Optional[str] = None
    refresh_token: Optional[str] = None

    async with httpx.AsyncClient(
        base_url=settings.ddin_base_url, timeout=settings.ddin_timeout_seconds
    ) as client:
        login_result = await _run_step(
            client,
            step="login",
            method="POST",
            path=settings.ddin_login_path,
            correlation_id=correlation_id,
            json_body={"username": settings.ddin_username, "password": settings.ddin_password},
            on_success_message="Logged in successfully ({status_code})",
        )
        login_step = login_result.step
        if login_step.status == "PASS":
            access_token, refresh_token = _extract_tokens(login_result.raw_body)
            if not access_token:
                login_step = login_step.model_copy(
                    update={
                        "status": "FAIL",
                        "category": "INVALID_RESPONSE",
                        "message": "Login returned 2xx but no accessToken was found in the response",
                        "troubleshooting": [
                            "DDIN's response shape may have changed - inspect the raw response below",
                        ],
                    }
                )
        yield login_step

        if access_token is None:
            for step_name in ("refresh_token", "balance", "test_collection"):
                yield _skip(step_name, "Skipped - login did not produce a token", correlation_id)
            return

        if not request.include_refresh:
            yield _skip("refresh_token", "Not requested", correlation_id)
        else:
            if refresh_token is None:
                yield DdinDiagnosticStep(
                    step="refresh_token",
                    status="FAIL",
                    message="Login response did not include a refreshToken to test with",
                    category="INVALID_RESPONSE",
                    troubleshooting=["Inspect the login response below for the actual field names"],
                    correlation_id=correlation_id,
                    started_at=datetime.now(timezone.utc),
                )
            else:
                refresh_result = await _run_step(
                    client,
                    step="refresh_token",
                    method="POST",
                    path=settings.ddin_refresh_path,
                    correlation_id=correlation_id,
                    json_body={"refreshToken": refresh_token},
                    on_success_message="Refreshed successfully ({status_code})",
                )
                refresh_step = refresh_result.step
                if refresh_step.status == "PASS":
                    new_access, _ = _extract_tokens(refresh_result.raw_body)
                    if new_access:
                        access_token = new_access  # use the freshest token for balance below
                    else:
                        refresh_step = refresh_step.model_copy(
                            update={
                                "status": "FAIL",
                                "category": "INVALID_RESPONSE",
                                "message": "Refresh returned 2xx but no accessToken was found in the response",
                            }
                        )
                yield refresh_step

        if not request.include_balance:
            yield _skip("balance", "Not requested", correlation_id)
        else:
            balance_result = await _run_step(
                client,
                step="balance",
                method="GET",
                path=settings.ddin_balance_path,
                correlation_id=correlation_id,
                headers={"Authorization": f"Bearer {access_token}"},
                on_success_message="Retrieved float account balances ({status_code})",
            )
            yield balance_result.step

        if not request.run_test_collection:
            yield _skip("test_collection", "Not requested", correlation_id)
        else:
            reference_id = f"soila-diagnostics-{uuid.uuid4().hex[:16]}"
            collection_step = (
                await _run_step(
                    client,
                    step="test_collection",
                    method="POST",
                    path=settings.ddin_collection_path,
                    correlation_id=correlation_id,
                    json_body={
                        "provider": "MTN",
                        "customerAccountNumber": TEST_COLLECTION_ACCOUNT_NUMBER,
                        "customerName": "Soila Pay Diagnostics",
                        "amount": str(TEST_COLLECTION_AMOUNT),
                        "referenceId": reference_id,
                    },
                    headers={"Authorization": f"Bearer {access_token}"},
                    on_success_message="DDIN acknowledged the request ({status_code})",
                )
            ).step
            if collection_step.status == "PASS":
                collection_step = collection_step.model_copy(
                    update={
                        "message": collection_step.message
                        + " - this only proves connectivity, not a completed collection "
                        "(DDIN's collection API is asynchronous)"
                    }
                )
            yield collection_step


async def run_ddin_diagnostics(
    settings: Settings, request: Optional[DdinDiagnosticsRequest] = None
) -> DdinDiagnosticsResult:
    """Non-streaming wrapper around stream_ddin_diagnostics - collects every
    step and returns the full report in one response. Used by the plain
    POST /diagnostics endpoint (and API docs / cURL examples); the console UI
    itself uses the streaming endpoint for live progress."""
    request = request or DdinDiagnosticsRequest()
    start = time.monotonic()
    steps: list[DdinDiagnosticStep] = []
    correlation_id = ""
    async for step in stream_ddin_diagnostics(settings, request):
        steps.append(step)
        correlation_id = step.correlation_id

    total_duration_ms = (time.monotonic() - start) * 1000
    overall_status = "PASS" if all(s.status != "FAIL" for s in steps) else "FAIL"
    return DdinDiagnosticsResult(
        overall_status=overall_status,
        base_url=settings.ddin_base_url,
        correlation_id=correlation_id,
        steps=steps,
        ran_at=datetime.now(timezone.utc),
        total_duration_ms=total_duration_ms,
    )
