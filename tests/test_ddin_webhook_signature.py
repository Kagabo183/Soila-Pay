import hashlib
import hmac

from app.api.v1.webhooks import verify_ddin_signature

RAW_BODY = (
    b'{"event":"collection.success","timestamp":"2026-07-11T10:15:32.120Z",'
    b'"data":{"referenceId":"4a29f6d1","status":"success"}}'
)
SECRET = "whsec_test_secret"


def _sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def test_valid_signature_is_accepted():
    signature = _sign(RAW_BODY, SECRET)
    assert verify_ddin_signature(RAW_BODY, signature, SECRET) is True


def test_signature_from_wrong_secret_is_rejected():
    signature = _sign(RAW_BODY, "a-different-secret")
    assert verify_ddin_signature(RAW_BODY, signature, SECRET) is False


def test_signature_for_tampered_body_is_rejected():
    signature = _sign(RAW_BODY, SECRET)
    tampered = RAW_BODY.replace(b'"status":"success"', b'"status":"failed"')
    assert verify_ddin_signature(tampered, signature, SECRET) is False


def test_uppercase_hex_signature_still_verifies():
    signature = _sign(RAW_BODY, SECRET).upper()
    assert verify_ddin_signature(RAW_BODY, signature, SECRET) is True


def test_missing_secret_never_verifies():
    signature = _sign(RAW_BODY, "")
    assert verify_ddin_signature(RAW_BODY, signature, "") is False


def test_missing_signature_header_never_verifies():
    assert verify_ddin_signature(RAW_BODY, "", SECRET) is False
