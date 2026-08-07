import time
from collections import deque

from fastapi import Header, HTTPException

from app.config import settings
from app.services.admin_auth import verify_admin_token


async def require_admin(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency guarding every /api/v1/admin/* route (integrator
    CRUD, DDIN diagnostics, revenue summary). Bearer <admin session token>,
    obtained via POST /api/v1/admin/auth/login - see app/services/admin_auth.py.
    Distinct from Integrator-Key (API calls) and integrator portal session
    tokens (a different secret, a different subject).

    `authorization` must default to None rather than being required - a
    required Header() makes FastAPI reject a missing header with its own 422
    before this function body ever runs, breaking the documented 401
    contract for callers who branch on "401 means log in again"."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    if not verify_admin_token(token, settings.admin_session_secret):
        raise HTTPException(status_code=401, detail="Session expired or invalid - log in again")


# In-memory sliding-window limiter shared by every route that makes a real
# outbound call to DDIN (diagnostics run, diagnostics stream, ping). Global,
# not per-caller - the thing being protected is DDIN's sandbox from being
# hammered in total, not any one client. Per-process only: if this ever runs
# behind multiple replicas, each gets its own independent budget - move to a
# shared store (Redis etc.) before that matters.
_ddin_call_timestamps: deque[float] = deque()


async def rate_limit_ddin_calls() -> None:
    now = time.monotonic()
    window_seconds = 60.0
    while _ddin_call_timestamps and now - _ddin_call_timestamps[0] > window_seconds:
        _ddin_call_timestamps.popleft()
    if len(_ddin_call_timestamps) >= settings.ddin_diagnostics_rate_limit_per_minute:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Rate limit exceeded - max {settings.ddin_diagnostics_rate_limit_per_minute} "
                "DDIN diagnostics calls per minute. Wait and try again."
            ),
        )
    _ddin_call_timestamps.append(now)
