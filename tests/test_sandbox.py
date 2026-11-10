"""Sandbox keys / Test Mode accounts are simulated by Soila Pay: they must
never reach LMBTech (whose account is live = real money), and test money must
never be spendable as real money."""
import asyncio
from collections import defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

import httpx
import pytest
import respx

from app.config import Settings
from app.schemas.payment import DisbursementCreate, PaymentCreate
from app.services import sandbox, webhook_dispatcher
from app.services.payment_service import PaymentService

SANDBOX_KEY = {"id": 7, "name": "Shop", "key_mode": "sandbox", "account_mode": "PRODUCTION", "payment_fee_percentage": None, "payout_fee_percentage": None}
LIVE_KEY = {**SANDBOX_KEY, "key_mode": "production"}
TEST_PORTAL = {"id": 7, "name": "Shop", "account_mode": "TEST", "payment_fee_percentage": None, "payout_fee_percentage": None}


def test_who_gets_sandbox():
    assert PaymentService.is_sandbox(None) is False  # admin console = live
    assert PaymentService.is_sandbox(SANDBOX_KEY) is True  # the key wins, even on a live account
    assert PaymentService.is_sandbox(LIVE_KEY) is False
    assert PaymentService.is_sandbox(TEST_PORTAL) is True  # portal: account mode
    assert PaymentService.is_sandbox({**TEST_PORTAL, "account_mode": "PRODUCTION"}) is False


def test_phone_and_card_outcomes():
    assert sandbox.phone_outcome("0788123456", payout=False).status == "SUCCESS"
    assert sandbox.phone_outcome("+250780000002", payout=False).status == "FAILED"
    assert sandbox.phone_outcome("0780000003", payout=True).status == "FAILED"
    assert sandbox.card_outcome("4242 4242 4242 4242", approve=True).status == "SUCCESS"
    assert sandbox.card_outcome("4000000000000002", approve=True).status == "FAILED"
    assert sandbox.card_outcome(None, approve=False).status == "CANCELLED"
    assert sandbox.phone_outcome("0788123456", payout=False).transaction_id.startswith("SANDBOX-")
    assert not sandbox.due(datetime.now()) and sandbox.due(datetime.now() - timedelta(seconds=sandbox.SETTLE_SECONDS + 1))


class FakeRepo:
    def __init__(self, balance="10000"):
        self.rows: dict = {}
        self.balance = Decimal(balance)
        self.balance_asked: list = []

    async def get_by_reference(self, ref):
        return self.rows.get(ref)

    async def integrator_balance(self, integrator_id, is_test=False):
        self.balance_asked.append(is_test)
        return self.balance

    async def create(self, **kw):
        self.rows[kw["reference_id"]] = {**kw, "status": "PENDING", "created_at": datetime.now(), "customer_phone": kw.get("customer_phone")}

    async def set_pending_details(self, ref, *, status_message, redirect_url):
        self.rows[ref].update(status_message=status_message, redirect_url=redirect_url)

    async def update_gateway_state(self, ref, *, status, status_message=None, gateway_transaction_id=None, redirect_url=None, gateway_amount=None):
        row = self.rows[ref]
        if row["status"] in ("SUCCESS", "FAILED", "CANCELLED") or row["status"] == status:
            return False
        row.update(status=status, status_message=status_message, gateway_transaction_id=gateway_transaction_id)
        return True


class NoLMBTech:
    """Any call means a sandbox request reached the real gateway."""
    configured = True

    async def pay(self, **kw):
        raise AssertionError("sandbox payment reached LMBTech")

    async def payout(self, **kw):
        raise AssertionError("sandbox payout reached LMBTech")

    async def get_status(self, ref):
        raise AssertionError("sandbox status reached LMBTech")


class NoSettings:
    async def get_setting(self, key):
        return None


def _svc(repo):
    svc = PaymentService.__new__(PaymentService)
    svc._repo, svc._gateway, svc._integrator_repo = repo, NoLMBTech(), NoSettings()
    svc._settings = Settings(lmbtech_test_mode=False, frontend_base_url="https://app.soila.test")
    svc._payout_locks = defaultdict(asyncio.Lock)

    async def no_webhooks(row):
        return None

    svc._notify = no_webhooks
    return svc


async def test_sandbox_card_payment_never_reaches_lmbtech_and_uses_sandbox_page():
    repo = FakeRepo()
    svc = _svc(repo)
    row = await svc.create(PaymentCreate(amount_rwf=1000, channel="VISA", customer_name="Aline", customer_email="a@b.rw"), SANDBOX_KEY)
    assert row["gateway"] == "SANDBOX" and row["is_test"] is True
    assert row["redirect_url"] == f"https://app.soila.test/pay/sandbox?ref={row['reference_id']}"
    # Waits for the card page; the background check doesn't settle it.
    row["created_at"] = datetime.now() - timedelta(minutes=5)
    assert (await svc.sync(row["reference_id"]))["status"] == "PENDING"
    done = await svc.complete_sandbox_card(row["reference_id"], approve=True, card_number="4242424242424242")
    assert done["status"] == "SUCCESS"


async def test_sandbox_momo_settles_by_test_number():
    repo = FakeRepo()
    svc = _svc(repo)
    ok = await svc.create(PaymentCreate(amount_rwf=500, channel="MTN_MOMO", customer_name="Aline", customer_email="a@b.rw", customer_phone="0788123456"), TEST_PORTAL)
    bad = await svc.create(PaymentCreate(amount_rwf=500, channel="MTN_MOMO", customer_name="Bosco", customer_email="b@b.rw", customer_phone="0780000002"), TEST_PORTAL)
    assert (await svc.sync(ok["reference_id"]))["status"] == "PENDING"  # not due yet
    for r in (ok, bad):
        r["created_at"] = datetime.now() - timedelta(seconds=10)
    assert (await svc.sync(ok["reference_id"]))["status"] == "SUCCESS"
    assert (await svc.sync(bad["reference_id"]))["status"] == "FAILED"


async def test_sandbox_payout_spends_only_test_money_and_live_only_real():
    repo = FakeRepo()
    svc = _svc(repo)
    body = DisbursementCreate(amount_rwf=500, recipient_name="Aline", recipient_phone="0788123456")
    row = await svc.create_disbursement(body, SANDBOX_KEY)
    assert row["gateway"] == "SANDBOX" and row["is_test"] is True
    assert repo.balance_asked == [True]  # checked against the sandbox ledger

    class LiveGateway(NoLMBTech):
        async def payout(self, **kw):
            from app.services.lmbtech_client import GatewayResult
            return GatewayResult(status="PENDING")

    svc._gateway = LiveGateway()
    await svc.create_disbursement(body, LIVE_KEY)
    assert repo.balance_asked == [True, False]  # live payout: real money only


async def test_sandbox_bank_cashout_is_simulated():
    repo = FakeRepo()
    svc = _svc(repo)
    integ = {**TEST_PORTAL, "bank_name": "BK", "bank_account": "123", "email": "s@x.rw"}
    row = await svc.cashout(integ, "BANK", 800)
    assert row["gateway"] == "SANDBOX" and row["is_test"] is True and repo.balance_asked == [True]
    row["created_at"] = datetime.now() - timedelta(seconds=10)
    assert (await svc.sync(row["reference_id"]))["status"] == "SUCCESS"


async def test_sandbox_card_page_cannot_touch_live_payments():
    repo = FakeRepo()
    svc = _svc(repo)
    repo.rows["SP-LIVE"] = {"reference_id": "SP-LIVE", "gateway": "LMBTECH", "method": "CARD", "status": "PENDING"}
    assert await svc.complete_sandbox_card("SP-LIVE", approve=True, card_number=None) is None
    assert repo.rows["SP-LIVE"]["status"] == "PENDING"


@respx.mock
async def test_webhook_is_retried_until_the_integrator_answers(monkeypatch):
    monkeypatch.setattr(webhook_dispatcher, "RETRY_DELAYS", (0, 0, 0, 0))
    route = respx.post("https://shop.example/hook").mock(
        side_effect=[httpx.Response(500), httpx.ConnectError("down"), httpx.Response(200)]
    )
    payload = webhook_dispatcher._build_payment_payload("payment.success", {"reference_id": "SP-1", "amount_rwf": 100, "is_test": 1})
    assert await webhook_dispatcher._deliver_one("https://shop.example/hook", "secret", "payment.success", payload) is True
    assert route.call_count == 3
    assert route.calls.last.request.headers["X-Soila-Delivery"] == "SP-1:payment.success"


async def test_production_key_respects_ip_whitelist():
    from fastapi import HTTPException

    from app.api.v1.payments import _integrator_from_key

    def request_from(ip, row):
        class Repo:
            async def get_by_api_key(self, key):
                return row

        class Req:
            client = type("C", (), {"host": ip})()
            app = type("A", (), {"state": type("S", (), {"integrator_repo": Repo()})()})()

        return Req()

    live = {**LIVE_KEY, "is_active": True, "ip_whitelist": "203.0.113.10, 203.0.113.11"}
    assert await _integrator_from_key(request_from("203.0.113.11", live), "k") is live
    with pytest.raises(HTTPException) as exc:
        await _integrator_from_key(request_from("198.51.100.7", live), "k")
    assert exc.value.status_code == 403
    # Sandbox keys work from anywhere; no whitelist = no restriction.
    sandbox_key = {**live, "key_mode": "sandbox"}
    assert await _integrator_from_key(request_from("198.51.100.7", sandbox_key), "k") is sandbox_key
    open_live = {**live, "ip_whitelist": None}
    assert await _integrator_from_key(request_from("198.51.100.7", open_live), "k") is open_live
