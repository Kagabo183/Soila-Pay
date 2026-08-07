import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

# stdlib-only password hashing (PBKDF2-HMAC-SHA256) and a lightweight signed
# session token, so integrator self-service login doesn't need a new
# dependency. Adequate for this MVP; swap for a maintained library
# (passlib/bcrypt, a real JWT lib) before this handles real customer accounts
# at scale.

PBKDF2_ITERATIONS = 200_000
_SALT_BYTES = 16
SESSION_TTL_SECONDS = 7 * 24 * 3600  # 7 days


def hash_password(password: str) -> str:
    salt = os.urandom(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        salt_hex, digest_hex = password_hash.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return hmac.compare_digest(actual, expected)


def create_session_token(integrator_id: int, secret: str) -> str:
    payload = json.dumps(
        {"integrator_id": integrator_id, "exp": int(time.time()) + SESSION_TTL_SECONDS}
    ).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload).rstrip(b"=")
    signature = hmac.new(secret.encode("utf-8"), payload_b64, hashlib.sha256).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).rstrip(b"=")
    return f"{payload_b64.decode('ascii')}.{signature_b64.decode('ascii')}"


def verify_session_token(token: str, secret: str) -> Optional[int]:
    """Returns the integrator_id if the token is validly signed and unexpired,
    else None. Never raises - any malformed input is just an invalid session."""
    try:
        payload_b64, signature_b64 = token.split(".", 1)
    except ValueError:
        return None

    expected_signature = hmac.new(secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).digest()
    expected_signature_b64 = base64.urlsafe_b64encode(expected_signature).rstrip(b"=").decode("ascii")
    if not hmac.compare_digest(expected_signature_b64, signature_b64):
        return None

    try:
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, UnicodeDecodeError):
        return None

    if payload.get("exp", 0) < time.time():
        return None
    integrator_id = payload.get("integrator_id")
    return int(integrator_id) if isinstance(integrator_id, int) else None
