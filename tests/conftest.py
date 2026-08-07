from decimal import Decimal

import pytest

from app.config import Settings
from app.exceptions import FineractError, UtilityPurchaseError
from app.schemas.utility import UtilityPurchaseRequest


class FakeTransactionLogRepo:
    """In-memory stand-in for TransactionLogRepo, mirroring its public interface."""

    def __init__(self):
        self._rows: dict[str, dict] = {}

    async def get_by_idempotency_key(self, idempotency_key):
        return self._rows.get(idempotency_key)

    async def insert_pending(
        self,
        idempotency_key,
        fineract_savings_account_id,
        utility_provider,
        meter_number,
        amount_rwf,
        request_payload,
    ):
        if idempotency_key in self._rows:
            return False
        self._rows[idempotency_key] = {
            "idempotency_key": idempotency_key,
            "fineract_savings_account_id": fineract_savings_account_id,
            "utility_provider": utility_provider,
            "meter_number": meter_number,
            "amount_rwf": amount_rwf,
            "status": "PENDING",
            "fineract_debit_txn_id": None,
            "fineract_refund_txn_id": None,
            "utility_token": None,
            "error_detail": None,
            "refund_attempts": 0,
        }
        return True

    async def mark_debited(self, idempotency_key, debit_txn_id):
        row = self._rows[idempotency_key]
        row["status"] = "DEBITED"
        row["fineract_debit_txn_id"] = debit_txn_id

    async def mark_success(self, idempotency_key, utility_token, response_payload):
        row = self._rows[idempotency_key]
        row["status"] = "SUCCESS"
        row["utility_token"] = utility_token

    async def mark_failed_refunded(
        self, idempotency_key, refund_txn_id, error_detail, response_payload
    ):
        row = self._rows[idempotency_key]
        row["status"] = "FAILED_REFUNDED"
        row["fineract_refund_txn_id"] = refund_txn_id
        row["error_detail"] = error_detail

    async def mark_failed_refund_error(
        self, idempotency_key, refund_attempts, error_detail, response_payload
    ):
        row = self._rows[idempotency_key]
        row["status"] = "FAILED_REFUND_ERROR"
        row["refund_attempts"] = refund_attempts
        row["error_detail"] = error_detail


class FakeFineractClient:
    """Configurable stand-in for FineractClient."""

    def __init__(self, deposit_failures: int = 0):
        self.withdraw_calls = []
        self.deposit_calls = []
        self._deposit_failures_remaining = deposit_failures
        self.next_txn_id = 9000

    async def withdraw(self, account_id, amount, note):
        self.withdraw_calls.append((account_id, amount, note))
        self.next_txn_id += 1
        return str(self.next_txn_id)

    async def deposit(self, account_id, amount, note):
        self.deposit_calls.append((account_id, amount, note))
        if self._deposit_failures_remaining > 0:
            self._deposit_failures_remaining -= 1
            raise FineractError("simulated Fineract deposit failure")
        self.next_txn_id += 1
        return str(self.next_txn_id)


class FakeUtilityProvider:
    FORCE_FAIL_METER = "00000000000"

    async def purchase(self, provider, meter_number, amount, *, reference_id=None, customer_name=None):
        if meter_number == self.FORCE_FAIL_METER:
            raise UtilityPurchaseError(f"provider {provider} rejected meter {meter_number}")
        return f"{provider}-TOKEN-123"


@pytest.fixture
def settings() -> Settings:
    return Settings(refund_max_attempts=3, refund_backoff_base_seconds=0.01)


@pytest.fixture
def repo() -> FakeTransactionLogRepo:
    return FakeTransactionLogRepo()


@pytest.fixture
def fineract() -> FakeFineractClient:
    return FakeFineractClient()


@pytest.fixture
def utility_provider() -> FakeUtilityProvider:
    return FakeUtilityProvider()


@pytest.fixture
def purchase_request() -> UtilityPurchaseRequest:
    return UtilityPurchaseRequest(
        fineract_savings_account_id="12345",
        utility_provider="REG",
        meter_number="04212345678",
        amount_rwf=Decimal("5000"),
    )
