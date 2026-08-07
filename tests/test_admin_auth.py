import pytest
from fastapi import HTTPException

from app.api.v1.deps import require_admin
from app.config import settings
from app.services.admin_auth import create_admin_token, verify_admin_credentials, verify_admin_token

SECRET = "test-admin-secret"


def test_correct_credentials_verify():
    assert verify_admin_credentials("ops", "correct-password", "ops", "correct-password") is True


def test_wrong_password_rejected():
    assert verify_admin_credentials("ops", "wrong-password", "ops", "correct-password") is False


def test_wrong_username_rejected():
    assert verify_admin_credentials("someone-else", "correct-password", "ops", "correct-password") is False


def test_empty_expected_credentials_fail_closed():
    """No ADMIN_USERNAME/PASSWORD configured -> nobody can log in, not "any
    password works" - a common fail-open bug when comparing against blanks."""
    assert verify_admin_credentials("", "", "", "") is False
    assert verify_admin_credentials("ops", "anything", "", "") is False


def test_admin_token_round_trips():
    token = create_admin_token(SECRET)
    assert verify_admin_token(token, SECRET) is True


def test_admin_token_rejected_with_wrong_secret():
    token = create_admin_token(SECRET)
    assert verify_admin_token(token, "a-different-secret") is False


def test_malformed_admin_token_never_raises():
    assert verify_admin_token("not-a-token", SECRET) is False
    assert verify_admin_token("", SECRET) is False


@pytest.fixture
def admin_secret(monkeypatch):
    monkeypatch.setattr(settings, "admin_session_secret", SECRET)
    return SECRET


async def test_require_admin_rejects_missing_header_with_401_not_422(admin_secret):
    """authorization=None (header absent entirely) must reach the function
    body and raise a 401, not be rejected by FastAPI's own request validation
    as a 422 before require_admin ever runs - that would silently break every
    client that branches on "401 means log in again"."""
    with pytest.raises(HTTPException) as exc_info:
        await require_admin(authorization=None)
    assert exc_info.value.status_code == 401


async def test_require_admin_rejects_malformed_header(admin_secret):
    with pytest.raises(HTTPException) as exc_info:
        await require_admin(authorization="Basic sometoken")
    assert exc_info.value.status_code == 401


async def test_require_admin_rejects_invalid_token(admin_secret):
    with pytest.raises(HTTPException) as exc_info:
        await require_admin(authorization="Bearer not-a-real-token")
    assert exc_info.value.status_code == 401


async def test_require_admin_accepts_valid_token(admin_secret):
    token = create_admin_token(admin_secret)
    await require_admin(authorization=f"Bearer {token}")
