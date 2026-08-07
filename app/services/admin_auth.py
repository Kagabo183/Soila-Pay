import secrets

from app.services.integrator_auth import create_session_token, verify_session_token

# A single shared operator credential (env-configured), not a per-admin user
# table - see the "admin_username" comment in app/config.py. Reuses
# integrator_auth's generic, stdlib-only session token helpers with a
# separate secret, so an admin token and an integrator portal token are never
# interchangeable even if someone captured one.

_ADMIN_SUBJECT_ID = 1


def verify_admin_credentials(username: str, password: str, expected_username: str, expected_password: str) -> bool:
    if not expected_username or not expected_password:
        return False
    # Constant-time comparison - login endpoints are a classic timing-attack
    # surface, and this one guards every admin/operator action in the system.
    return secrets.compare_digest(username, expected_username) and secrets.compare_digest(
        password, expected_password
    )


def create_admin_token(secret: str) -> str:
    return create_session_token(_ADMIN_SUBJECT_ID, secret)


def verify_admin_token(token: str, secret: str) -> bool:
    return verify_session_token(token, secret) == _ADMIN_SUBJECT_ID
