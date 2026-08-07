from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel

DiagnosticStepName = Literal["config", "login", "refresh_token", "balance", "test_collection"]
DiagnosticStepStatus = Literal["PASS", "FAIL", "SKIPPED", "RUNNING"]

# Coarse failure categories an operator can act on immediately, independent
# of the raw exception text - see _classify_httpx_error in
# app/services/ddin_diagnostics.py for how each is derived.
ErrorCategory = Literal[
    "NETWORK",  # DNS / connection refused / connection reset
    "TLS",  # certificate / SSL handshake failure
    "TIMEOUT",
    "UNAUTHORIZED",  # 401/403 - bad credentials or expired token
    "DDIN_UNAVAILABLE",  # 5xx from DDIN
    "INVALID_RESPONSE",  # 2xx but unparseable / missing expected fields
    "CONFIG",  # our own misconfiguration (missing credentials)
    "UNEXPECTED",
]


class DiagnosticHttpDetail(BaseModel):
    """Safe-to-render request/response detail for the inspector panel.
    Authorization headers and credential fields are always masked before
    this is constructed - see _mask_headers / _mask_body."""

    method: str
    url: str
    headers: dict[str, str]
    body: Optional[dict[str, Any]] = None
    status_code: Optional[int] = None
    response_body: Optional[dict[str, Any]] = None


class DdinDiagnosticStep(BaseModel):
    step: DiagnosticStepName
    status: DiagnosticStepStatus
    latency_ms: Optional[float] = None
    message: str
    category: Optional[ErrorCategory] = None
    troubleshooting: list[str] = []
    # Safe-to-display response fragments only - never a token/credential.
    detail: Optional[dict[str, Any]] = None
    request_response: Optional[DiagnosticHttpDetail] = None
    correlation_id: str
    started_at: datetime


class DdinDiagnosticsRequest(BaseModel):
    include_refresh: bool = True
    include_balance: bool = True
    # Off by default: this actually initiates a real MoMo collection against
    # DDIN's sandbox (not our own Fineract flow) - opt-in, not automatic.
    run_test_collection: bool = False


class DdinDiagnosticsResult(BaseModel):
    overall_status: Literal["PASS", "FAIL"]
    base_url: str
    correlation_id: str
    steps: list[DdinDiagnosticStep]
    ran_at: datetime
    total_duration_ms: float


class DdinPingResponse(BaseModel):
    """Lightweight, login-only check (no refresh/balance/collection calls) for
    uptime monitors that prefer a plain GET over POSTing a JSON body. Shares
    the same rate-limit budget as the full diagnostics run - see
    rate_limit_ddin_calls in app/api/v1/deps.py."""

    reachable: bool
    latency_ms: Optional[float] = None
    message: str


class DdinConnectionInfo(BaseModel):
    middleware_version: str
    api_path_version: str
    ddin_base_url: str
    ddin_login_path: str
    ddin_refresh_path: str
    ddin_balance_path: str
    ddin_collection_path: str
    environment: str
    authentication_method: str
    tls_enabled: bool
    request_timeout_seconds: float
    retry_policy: str
    credentials_configured: bool
    webhook_secret_configured: bool
