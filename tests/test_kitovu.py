"""Kitovu Pay MoMo collections: signing, number formats, status mapping and
the service path (MOMO_GATEWAY=kitovu). No network: Kitovu is mocked."""
import hashlib
import hmac
import json
from decimal import Decimal

import httpx
import pytest
import respx

from app.config import Settings
from app.schemas.payment import PaymentCreate
from app.services import kitovu_client
from app.services.kitovu_client import KitovuClient, KitovuError

UAT = "https://gateway.uat.kitovupay.com"


def _settings(**kw):
    base = dict(kitovupay_api_key="k", kitovupay_api_secret="s3cret", kitovupay_base_url=UAT, momo_gateway="kitovu",
                lmbtech_test_mode=False, public_api_base_url="https://pay.example")
    return Settings(**{**base, **kw})


def test_signature_is_hmac_of_compact_method_path_body():
    body = {"amount": 100, "payment_rail": "mtn", "sender_account_issuer": "mtn"}
    expected = hmac.new(
        b"s3cret",
        b'{"method":"POST","path":"/merchant-transaction/merchant/transaction_fee","body":{"amount":100,"payment_rail":"mtn","sender_account_issuer":"mtn"}}',
        hashlib.sha256,
    ).hexdigest()
    assert kitovu_client.sign("s3cret", "post", kitovu_client.FEE_PATH, body) == expected


def test_number_formats_and_description():
    assert kitovu_client.rail_for("+250788123456") == "mtn"
    assert kitovu_client.rail_for("+250731234567") == "airtel"
    assert kitovu_client.account_number("+250788123456", "mtn") == "250788123456"
    assert kitovu_client.account_number("+250731234567", "airtel") == "731234567"
    assert kitovu_client.clean_description("Order #12 - café!") == "Order 12 caf"
    assert kitovu_client.clean_description("###") == "Payment"


def test_status_mapping():
    for raw, ours in [("APPROVED", "SUCCESS"), ("successful", "SUCCESS"), ("REJECTED", "FAILED"),
                      ("FAILED", "FAILED"), ("CANCELLED", "CANCELLED"), ("PENDING", "PENDING"), ("weird", "PENDING")]:
        assert kitovu_client.normalize_status(raw) == ours


@respx.mock
async def test_collect_sends_signed_body_and_status_lookups():
    client = KitovuClient(_settings())
    route = respx.post(f"{UAT}{kitovu_client.COLLECTION_PATH}").mock(return_value=httpx.Response(200, json={
        "success": True, "transactionId": "TXN1", "data": {"status": "pending", "message": "Collection request sent"}}))
    r = await client.collect(external_id="123456", amount=Decimal(500), phone="+250788123456", name="Aline",
                             description="Order #1", callback_url="https://pay.example/cb")
    assert r.status == "PENDING" and r.transaction_id == "TXN1"
    req = route.calls.last.request
    sent = json.loads(req.content)
    assert sent["sender_account_number"] == "250788123456" and sent["externalId"] == "123456" and sent["description"] == "Order 1"
    assert req.headers["x-api-signature"] == kitovu_client.sign("s3cret", "POST", kitovu_client.COLLECTION_PATH, sent)
    assert req.headers["x-api-timestamp"].isdigit() and len(req.headers["x-api-timestamp"]) == 13  # milliseconds

    respx.get(f"{UAT}/merchant-transaction/payment/123456").mock(return_value=httpx.Response(200, json={
        "reference_id": "TXN1", "status": "REJECTED", "reason": "NOT_ENOUGH_FUNDS"}))
    s = await client.get_status("123456")
    assert s.status == "FAILED" and "Not enough money" in s.message
    respx.get(f"{UAT}/merchant-transaction/payment/000000").mock(return_value=httpx.Response(404, json={"message": "Not Found"}))
    assert await client.get_status("000000") is None

    respx.post(f"{UAT}{kitovu_client.COLLECTION_PATH}").mock(return_value=httpx.Response(400, json={
        "success": False, "message": "Insufficient balance", "error": "INSUFFICIENT_BALANCE"}))
    with pytest.raises(KitovuError) as exc:
        await client.collect(external_id="123457", amount=Decimal(500), phone="+250788123456", name="A",
                             description="x", callback_url="https://pay.example/cb")
    assert exc.value.code == "INSUFFICIENT_BALANCE"
    await client.aclose()


async def test_service_routes_live_momo_to_kitovu_and_syncs():
    """Live MoMo -> Kitovu with a 6-digit externalId (UAT = test money);
    cards stay on LMBTech; sync asks Kitovu by externalId."""
    from tests.test_sandbox import FakeRepo, _svc
    from app.services.lmbtech_client import GatewayResult

    repo = FakeRepo()

    async def external_id_taken(gateway, ext):
        return any(r.get("gateway_external_id") == ext for r in repo.rows.values())

    repo.external_id_taken = external_id_taken

    class FakeKitovu:
        configured, is_uat = True, True
        collected = []

        async def verify_number(self, phone):
            return "ALINE UWASE"  # the wallet's registered name wins over what was typed

        async def collect(self, **kw):
            self.collected.append(kw)
            return GatewayResult(status="PENDING", message="Collection request sent", transaction_id="TXN9")

        async def get_status(self, ext):
            return GatewayResult(status="SUCCESS", message="Payment received", transaction_id="TXN9")

    class FakeLMBTech:
        configured = True

        async def pay(self, **kw):
            return GatewayResult(status="PENDING", redirect_url="https://pay.lmbtech.rw/x")

    svc = _svc(repo)
    svc._settings = _settings()
    svc._kitovu = FakeKitovu()
    svc._gateway = FakeLMBTech()

    async def apply(ref, result):
        repo.rows[ref].update(status=result.status, gateway_transaction_id=result.transaction_id)
        return repo.rows[ref]

    svc._apply = apply
    live = {"id": 7, "name": "Shop", "key_mode": "production", "account_mode": "PRODUCTION",
            "payment_fee_percentage": None, "payout_fee_percentage": None}
    row = await svc.create(PaymentCreate(amount_rwf=500, channel="MTN_MOMO", customer_name="Aline",
                                         customer_email="a@b.rw", customer_phone="0788123456"), live)
    assert row["gateway"] == "KITOVU" and len(row["gateway_external_id"]) == 6 and row["gateway_external_id"].isdigit()
    assert row["is_test"] is True  # UAT moves no real money
    assert svc._kitovu.collected[0]["phone"] == "+250788123456"
    assert svc._kitovu.collected[0]["name"] == "ALINE UWASE"
    assert svc._kitovu.collected[0]["callback_url"] == "https://pay.example/api/v1/payments/callback/kitovu"

    card = await svc.create(PaymentCreate(amount_rwf=500, channel="VISA", customer_name="Aline", customer_email="a@b.rw"), live)
    assert card["gateway"] == "LMBTECH"

    synced = await svc.sync(row["reference_id"])
    assert synced["status"] == "SUCCESS"


def test_airtel_channel_checks_the_network():
    from pydantic import ValidationError

    p = PaymentCreate(amount_rwf=500, channel="AIRTEL_MONEY", customer_name="Eric", customer_email="e@b.rw", customer_phone="0731234567")
    assert p.customer_phone == "+250731234567"
    with pytest.raises(ValidationError, match="Airtel numbers start with 072 or 073"):
        PaymentCreate(amount_rwf=500, channel="AIRTEL_MONEY", customer_name="Eric", customer_email="e@b.rw", customer_phone="0788123456")
    with pytest.raises(ValidationError, match="MTN numbers start with 078 or 079"):
        PaymentCreate(amount_rwf=500, channel="MTN_MOMO", customer_name="Eric", customer_email="e@b.rw", customer_phone="0731234567")


async def test_airtel_needs_kitovu_and_momo_uses_kitovu_cost():
    from tests.test_sandbox import FakeRepo, _svc
    from app.services.lmbtech_client import GatewayResult
    from app.services.payment_service import ChannelUnavailableError, Pricing

    repo = FakeRepo()

    async def external_id_taken(gateway, ext):
        return False

    repo.external_id_taken = external_id_taken
    svc = _svc(repo)

    async def pricing():
        return Pricing(gateway_cost_percentage=Decimal("5"), default_fee_percentage=Decimal("6"),
                       payout_cost_percentage=Decimal("5"), payout_default_fee_percentage=Decimal("6"),
                       momo_cost_percentage=Decimal("3"))

    svc.pricing = pricing
    live = {"id": 7, "name": "Shop", "key_mode": "production", "account_mode": "PRODUCTION",
            "payment_fee_percentage": None, "payout_fee_percentage": None}
    airtel = PaymentCreate(amount_rwf=1000, channel="AIRTEL_MONEY", customer_name="Eric", customer_email="e@b.rw", customer_phone="0731234567")
    # LMBTech only (MOMO_GATEWAY=lmbtech): Airtel is refused up front.
    with pytest.raises(ChannelUnavailableError):
        await svc.create(airtel, live)

    class FakeKitovu:
        configured, is_uat = True, False

        async def verify_number(self, phone):
            return None  # lookup found nobody -> the typed name is used

        async def collect(self, **kw):
            return GatewayResult(status="PENDING")

    svc._settings = _settings()
    svc._kitovu = FakeKitovu()

    async def apply(ref, result):
        return repo.rows[ref]

    svc._apply = apply
    row = await svc.create(airtel, live)
    m = row["money"]
    assert row["gateway"] == "KITOVU" and row["channel"] == "AIRTEL" and row["is_test"] is False
    assert m.gateway_cost_percentage == Decimal("3") and m.gateway_cost_amount_rwf == Decimal("30.00")
    assert m.margin_amount_rwf == Decimal("30.00")  # 6% fee - 3% Kitovu = 3% margin (was 1% on LMBTech)
    assert (await pricing()).collection_cost_floor == Decimal("5")


@respx.mock
async def test_payout_body_and_fee_quote_send_full_bodies():
    client = KitovuClient(_settings())
    route = respx.post(f"{UAT}{kitovu_client.PAYOUT_PATH}").mock(return_value=httpx.Response(200, json={
        "success": True, "transactionId": "TXN7", "data": {"status": "pending"}}))
    r = await client.payout(external_id="1234567", amount=Decimal(5000), phone="+250731234567", name="Eric",
                            description="Refund #9", callback_url="https://pay.example/cb")
    assert r.status == "PENDING" and r.transaction_id == "TXN7"
    sent = json.loads(route.calls.last.request.content)
    assert sent["payment_rail"] == "airtel" and sent["recipient_account_number"] == "731234567"
    assert sent["externalId"] == "1234567" and sent["description"] == "Refund 9"

    fee = respx.post(f"{UAT}{kitovu_client.PAYOUT_FEE_PATH}").mock(return_value=httpx.Response(201, json={
        "amount": 5000, "merchant_charges": 400, "subscriber_charges": 0}))
    assert (await client.fee(Decimal(5000), "+250788123456", payout=True))["merchant_charges"] == 400
    quoted = json.loads(fee.calls.last.request.content)
    assert quoted["recipient_account_number"] == "250788123456" and quoted["externalId"] == "1000000"  # Kitovu validates the full body

    respx.post(f"{UAT}{kitovu_client.PAYOUT_PATH}").mock(return_value=httpx.Response(400, json={
        "success": False, "message": "Insufficient funds", "error": "NOT_ENOUGH_FUNDS"}))
    with pytest.raises(KitovuError, match="Kitovu account"):
        await client.payout(external_id="1234568", amount=Decimal(5000), phone="+250788123456", name="E",
                            description="x", callback_url="https://pay.example/cb")
    await client.aclose()


async def test_service_payout_via_kitovu_uses_flat_cost():
    from tests.test_sandbox import FakeRepo, _svc
    from app.schemas.payment import DisbursementCreate
    from app.services.lmbtech_client import GatewayResult
    from app.services.payment_service import Pricing

    repo = FakeRepo(balance="100000")

    async def external_id_taken(gateway, ext):
        return False

    repo.external_id_taken = external_id_taken
    svc = _svc(repo)

    async def pricing():
        return Pricing(gateway_cost_percentage=Decimal("5"), default_fee_percentage=Decimal("6"),
                       payout_cost_percentage=Decimal("5"), payout_default_fee_percentage=Decimal("6"))

    svc.pricing = pricing

    class FakeKitovu:
        configured, is_uat = True, False
        sent = []

        async def payout(self, **kw):
            self.sent.append(kw)
            return GatewayResult(status="PENDING", transaction_id="TXN7")

    svc._settings = _settings()
    svc._kitovu = FakeKitovu()

    async def apply(ref, result):
        return repo.rows[ref]

    svc._apply = apply
    live = {"id": 7, "name": "Shop", "key_mode": "production", "account_mode": "PRODUCTION",
            "payment_fee_percentage": None, "payout_fee_percentage": None}
    row = await svc.create_disbursement(
        DisbursementCreate(amount_rwf=20000, recipient_name="Aline", recipient_phone="0788123456"), live)
    m = row["money"]
    assert row["gateway"] == "KITOVU" and len(row["gateway_external_id"]) == 7 and row["channel"] == "MTN"
    assert m.gateway_cost_amount_rwf == Decimal("400.00") and m.gateway_cost_percentage == Decimal("2.00")
    assert m.fee_amount_rwf == Decimal("1200.00") and m.margin_amount_rwf == Decimal("800.00")  # 6% - flat 400
    assert svc._kitovu.sent[0]["external_id"] == row["gateway_external_id"]
