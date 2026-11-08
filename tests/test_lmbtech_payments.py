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


def test_money_breakdown_fee_minus_lmbtech_cost():
    from app.services.payment_service import compute_money

    m = compute_money(Decimal("10000"), Decimal("6.00"), Decimal("5.00"))
    assert m.fee_amount_rwf == Decimal("600.00")
    assert m.gateway_cost_amount_rwf == Decimal("500.00")
    assert m.margin_amount_rwf == Decimal("100.00")


def test_money_breakdown_flags_loss_when_fee_below_cost():
    from app.services.payment_service import compute_money

    m = compute_money(Decimal("1000"), Decimal("2.20"), Decimal("5.00"))
    assert m.margin_amount_rwf == Decimal("-28.00")


def test_console_payment_has_cost_but_no_fee_or_margin():
    from app.services.payment_service import compute_money

    m = compute_money(Decimal("333"), None, Decimal("5.00"))
    assert m.fee_amount_rwf is None and m.margin_amount_rwf is None
    assert m.gateway_cost_amount_rwf == Decimal("16.65")


def test_integrator_override_beats_default_fee():
    from app.services.payment_service import PaymentService, Pricing

    svc = PaymentService.__new__(PaymentService)
    pricing = Pricing(
        gateway_cost_percentage=Decimal("5.00"), default_fee_percentage=Decimal("6.00"),
        payout_cost_percentage=Decimal("5.00"), payout_default_fee_percentage=Decimal("6.50"),
    )
    assert svc.fee_for(None, pricing) is None
    assert svc.fee_for({"payment_fee_percentage": None}, pricing) == Decimal("6.00")
    assert svc.fee_for({"payment_fee_percentage": Decimal("7.50")}, pricing) == Decimal("7.50")
    # Payouts use their own default/override, independent of collections.
    assert svc.fee_for({"payment_fee_percentage": Decimal("7.50"), "payout_fee_percentage": None}, pricing, "DISBURSEMENT") == Decimal("6.50")


# -- disbursements (payouts) -----------------------------------------------

def _payout_client(email="merchant@soila.rw") -> LMBTechClient:
    return LMBTechClient(
        Settings(
            lmbtech_base_url=URL, lmbtech_app_key="app_x", lmbtech_secret_key="scrt_y",
            lmbtech_account_email=email, lmbtech_timeout_seconds=1,
        )
    )


def _payout_kwargs(**over):
    kw = dict(
        reference_id="SD-TEST-1", amount=Decimal("500"), recipient_name="Aline",
        recipient_phone="+250780000000", description="refund", callback_url="http://localhost:8000/cb",
    )
    kw.update(over)
    return kw


@respx.mock
async def test_payout_sends_documented_fields_and_reads_inner_status():
    route = respx.post(URL).mock(
        return_value=httpx.Response(
            200,
            json={"status": "success", "data": {"reference_id": "SD-TEST-1", "amount": "500.00", "status": "pending"},
                  "message": "Payout initiated successfully"},
        )
    )
    result = await _payout_client().payout(**_payout_kwargs())
    # Outer "success" = accepted; the payout itself is still pending.
    assert result.status == "PENDING"
    import json as _json
    sent = _json.loads(route.calls.last.request.content)
    assert sent["action"] == "payout" and sent["payment_method"] == "MTN_MOMO_RWA"
    assert sent["email"] == "merchant@soila.rw"  # OUR account email, per LMBTech docs
    assert sent["name"] == "Aline" and sent["payer_phone"] == "+250780000000"


@respx.mock
async def test_payout_insufficient_balance_is_a_clear_error():
    respx.post(URL).mock(return_value=httpx.Response(402, json={"status": "fail", "message": "Insufficient balance for payout"}))
    with pytest.raises(LMBTechError, match="Not enough balance"):
        await _payout_client().payout(**_payout_kwargs())


@respx.mock
async def test_payout_timeout_means_pending():
    respx.post(URL).mock(side_effect=httpx.ReadTimeout("slow"))
    assert (await _payout_client().payout(**_payout_kwargs())).status == "PENDING"


async def test_payout_refused_without_account_email():
    with pytest.raises(LMBTechError, match="LMBTECH_ACCOUNT_EMAIL"):
        await _payout_client(email="").payout(**_payout_kwargs())


def test_disbursement_request_mtn_only():
    from app.schemas.payment import DisbursementCreate

    ok = DisbursementCreate(amount_rwf=500, recipient_name="Aline", recipient_phone="0780000000", recipient_email="  ")
    assert ok.recipient_phone == "+250780000000" and ok.recipient_email is None
    with pytest.raises(ValidationError, match="MTN numbers only"):
        DisbursementCreate(amount_rwf=500, recipient_name="Aline", recipient_phone="0721234567")


async def test_payout_refused_when_integrator_balance_too_low():
    from app.schemas.payment import DisbursementCreate
    from app.services.payment_service import InsufficientBalanceError, PaymentService

    class Repo:
        created = False

        async def get_by_reference(self, ref):
            return None

        async def integrator_balance(self, integrator_id):
            return Decimal("500.00")

        async def create(self, **kw):
            Repo.created = True

    class Settings_:
        async def get_setting(self, key):
            return None  # defaults: payout cost 5%, payout fee 6%

    svc = PaymentService.__new__(PaymentService)
    svc._repo, svc._integrator_repo, svc._settings = Repo(), Settings_(), None
    from collections import defaultdict
    import asyncio as _asyncio
    svc._payout_locks = defaultdict(_asyncio.Lock)

    body = DisbursementCreate(amount_rwf=500, recipient_name="Aline", recipient_phone="0780000000")
    # 500 + 6% fee = 530 > 500 available -> refused before anything is written or sent.
    with pytest.raises(InsufficientBalanceError) as exc:
        await svc.create_disbursement(body, {"id": 1, "payout_fee_percentage": None})
    assert exc.value.needed == Decimal("530.00")
    assert Repo.created is False


def test_unconfigured_client_refuses():
    client = LMBTechClient(Settings(lmbtech_app_key="", lmbtech_secret_key=""))
    assert client.configured is False
    with pytest.raises(LMBTechError):
        client._headers()
