from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.services.admin_auth import create_admin_token, verify_admin_credentials

router = APIRouter()


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    token: str


@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(body: AdminLoginRequest):
    """Deliberately NOT behind require_admin (a login endpoint can't require
    the token it's about to issue). Every other /api/v1/admin/* route is."""
    if not verify_admin_credentials(
        body.username, body.password, settings.admin_username, settings.admin_password
    ):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return AdminLoginResponse(token=create_admin_token(settings.admin_session_secret))
