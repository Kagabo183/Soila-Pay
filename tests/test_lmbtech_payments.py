"""LMBTech gateway client + payment request validation.

Response bodies below are the real shapes observed live against LMBTech
(2026-11-08) - see app/services/lmbtech_client.py's module docstring.
"""
import base64
from decimal import Decimal

import httpx
import pytest
import respx
from pydantic import ValidationError

from app.config import Settings
from app.schemas.payment import PaymentCreate, normalize_rw_phone
from app.services.lmbtech_client import LMBTechClient, LMBTechError, normalize_status

URL = "https://pay.lmbtech.rw/pay/config/api.php"


def _client() -> LMBTechClient:
    return LMBTechClient(
        Settings(lmbtech_base_url=URL, lmbtech_app_key="app_x", lmbtech_secret_key="scrt_y", lmbtech_timeout_seconds=1)
    )


def _pay_kwargs(method="CARD", **over):
    kw = dict(
        method=method,
        reference_id="SP-TEST-1",
        amount=Decimal("1000"),
        name="Aline",
        email="a@example.com",
        phone="+250780000000" if method == "MOMO" else None,
        description="Order 1",
        callback_url="http://localhost:8000/cb",
        card_redirect_url="http://localhost:3000/pay/return?ref=SP-TEST-1",
    )
    kw.update(over)
    return kw


# -- phone / request validation ---------------------------------------------

@pytest.mark.parametrize("raw", ["0788123456", "788123456", "250788123456", "+250 788 123 456"])
def test_normalize_rw_phone_accepts_common_formats(raw):
    assert normalize_rw_phone(raw) == "+250788123456"


@pytest.mark.parametrize("raw", ["", "12345", "0612345678", "07881234567"])
def test_normalize_rw_phone_rejects_bad_numbers(raw):
    with pytest.raises(ValueError):
        normalize_rw_phone(raw)


def test_momo_requires_mtn_phone():
    base = dict(channel="MTN_MOMO", amount_rwf=1000, customer_name="Aline", customer_email="a@example.com")
    with pytest.raises(ValidationError, match="Phone number is required"):
        PaymentCreate(**base)
    with pytest.raises(ValidationError, match="MTN numbers start with 078 or 079"):
        PaymentCreate(**base, customer_phone="0721234567")
    assert PaymentCreate(**base, customer_phone="0780000000").customer_phone == "+250780000000"


def test_card_needs_no_phone_and_enforces_minimum():
    ok = PaymentCreate(channel="VISA", amount_rwf=100, customer_name="Aline", customer_email="a@example.com")
    assert ok.customer_phone is None
    with pytest.raises(ValidationError):
        PaymentCreate(channel="VISA", amount_rwf=99, customer_name="Aline", customer_email="a@example.com")
    with pytest.raises(ValidationError):
        PaymentCreate(channel="VISA", amount_rwf=500, customer_name="Aline", customer_email="not-an-email")


def test_normalize_status_never_guesses_failure():
    assert normalize_status("success") == "SUCCESS"
    assert normalize_status("fail") == "FAILED"
    assert normalize_status("cancelled") == "CANCELLED"
    assert normalize_status("something-new") == "PENDING"


# -- gateway client ---------------------------------------------------------

@respx.mock
async def test_sends_basic_auth_and_card_fields():
    route = respx.post(URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "pending",
                "data": {"reference_id": "SP-TEST-1", "transaction_id": "", "status": "pending"},
                "message": "Redirect to card payment gateway to complete payment",
                "redirect_url": "https://pay.lmbtech.rw/pay/pesapal/iframe.php?reference_id=SP-TEST-1&amount=1000",
            },
        )
    )
    result = await _client().pay(**_pay_kwargs())
    assert result.status == "PENDING"
    assert result.redirect_url.startswith("https://pay.lmbtech.rw/pay/pesapal/")
    req = route.calls.last.request
    assert req.headers["Authorization"] == "Basic " + base64.b64encode(b"app_x:scrt_y").decode()
    body = httpx.Request("POST", URL, content=req.content).read()
    assert b'"payment_method":"card"' in body.replace(b" ", b"")
    assert b"card_redirect_url" in body and b"payer_phone" not in body


@respx.mock
async def test_test_mode_account_returns_instant_success_without_card_page():
    respx.post(URL).mock(
        return_value=httpx.Response(
            200,
            json={"status": "success", "transaction_id": "TEST-ABC", "refid": "SP-TEST-1",
                  "message": "Successful", "response": {"responsecode": "01", "test_mode": True}},
        )
    )
    result = await _client().pay(**_pay_kwargs())
    assert result.status == "SUCCESS"
    assert result.transaction_id == "TEST-ABC"
    assert result.redirect_url is None


@respx.mock
async def test_momo_timeout_means_pending_not_failure():
    respx.post(URL).mock(side_effect=httpx.ReadTimeout("slow"))
    result = await _client().pay(**_pay_kwargs(method="MOMO"))
    assert result.status == "PENDING"


@respx.mock
async def test_momo_decline_is_a_failed_result_not_an_error():
    respx.post(URL).mock(
        return_value=httpx.Response(200, json={"status": "fail", "data": {"status": "fail"}, "message": "Declined"})
    )
    result = await _client().pay(**_pay_kwargs(method="MOMO"))
    assert result.status == "FAILED"


@respx.mock
async def test_bad_credentials_raise():
    respx.post(URL).mock(return_value=httpx.Response(401, json={"status": "fail", "message": "Invalid credentials"}))
    with pytest.raises(LMBTechError) as exc:
        await _client().pay(**_pay_kwargs())
    assert exc.value.status_code == 401


@respx.mock
async def test_status_flat_response_and_not_found():
    respx.get(URL, params={"reference_id": "SP-OK"}).mock(
        return_value=httpx.Response(
            200,
            json={"status": "success", "amount": "105.00", "reference_id": "SP-OK",
                  "transaction_id": "TEST-1", "name": "Aline", "message": "Payment successful"},
        )
    )
    respx.get(URL, params={"reference_id": "SP-NONE"}).mock(
        return_value=httpx.Response(200, json={"status": False, "message": "Payment not found"})
    )
    client = _client()
    ok = await client.get_status("SP-OK")
    assert ok.status == "SUCCESS" and ok.transaction_id == "TEST-1"
    assert await client.get_status("SP-NONE") is None


def test_unconfigured_client_refuses():
    client = LMBTechClient(Settings(lmbtech_app_key="", lmbtech_secret_key=""))
    assert client.configured is False
    with pytest.raises(LMBTechError):
        client._headers()
