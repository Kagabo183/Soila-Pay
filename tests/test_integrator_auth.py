import time

from app.services.integrator_auth import (
    create_session_token,
    hash_password,
    verify_password,
    verify_session_token,
)

SECRET = "test-secret"


def test_correct_password_verifies():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_wrong_password_fails():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong password", hashed) is False


def test_password_hash_is_salted_differently_each_time():
    a = hash_password("same password")
    b = hash_password("same password")
    assert a != b
    assert verify_password("same password", a) is True
    assert verify_password("same password", b) is True


def test_malformed_hash_never_verifies_or_raises():
    assert verify_password("anything", "not-a-valid-hash") is False
    assert verify_password("anything", "") is False


def test_session_token_round_trips():
    token = create_session_token(42, SECRET)
    assert verify_session_token(token, SECRET) == 42


def test_session_token_rejected_with_wrong_secret():
    token = create_session_token(42, SECRET)
    assert verify_session_token(token, "a-different-secret") is None


def test_tampered_token_is_rejected():
    token = create_session_token(42, SECRET)
    payload_b64, signature_b64 = token.split(".", 1)
    # Flip the payload without re-signing - simulates a forged token.
    tampered = payload_b64 + "x." + signature_b64
    assert verify_session_token(tampered, SECRET) is None


def test_malformed_token_never_raises():
    assert verify_session_token("not-a-token", SECRET) is None
    assert verify_session_token("", SECRET) is None


def test_expired_token_is_rejected():
    token = create_session_token(42, SECRET)
    # Directly craft an already-expired token rather than sleeping in a test.
    import base64
    import hashlib
    import hmac
    import json

    expired_payload = json.dumps({"integrator_id": 42, "exp": int(time.time()) - 10}).encode()
    payload_b64 = base64.urlsafe_b64encode(expired_payload).rstrip(b"=")
    signature = hmac.new(SECRET.encode(), payload_b64, hashlib.sha256).digest()
    signature_b64 = base64.urlsafe_b64encode(signature).rstrip(b"=")
    expired_token = f"{payload_b64.decode()}.{signature_b64.decode()}"

    assert verify_session_token(expired_token, SECRET) is None
    assert token != expired_token  # sanity: not comparing a token to itself
