from fastapi import Header, HTTPException

from app.config import settings
from app.services.admin_auth import verify_admin_token


async def require_admin(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency guarding every /api/v1/admin/* route. Bearer <admin
    session token>, obtained via POST /api/v1/admin/auth/login - see
    app/services/admin_auth.py. Distinct from Integrator-Key (API calls) and
    integrator portal session tokens (a different secret, a different subject).

    `authorization` must default to None rather than being required - a
    required Header() makes FastAPI reject a missing header with its own 422
    before this function body ever runs, breaking the documented 401
    contract for callers who branch on "401 means log in again"."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    if not verify_admin_token(token, settings.admin_session_secret):
        raise HTTPException(status_code=401, detail="Session expired or invalid - log in again")
