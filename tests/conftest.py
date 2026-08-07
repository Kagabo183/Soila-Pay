from decimal import Decimal

import pytest

from app.config import Settings
from app.exceptions import CollectionError, CollectionPending, FineractError
from app.schemas.collection import CollectionRequest


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
        provider,
        customer_account_number,
        customer_name,
        amount_rwf,
        request_payload,
        integrator_id=None,
    ):
        if idempotency_key in self._rows:
            return False
        self._rows[idempotency_key] = {
            "idempotency_key": idempotency_key,
            "fineract_savings_account_id": fineract_savings_account_id,
            "integrator_id": integrator_id,
            "provider": provider,
            "customer_account_number": customer_account_number,
            "customer_name": customer_name,
            "amount_rwf": amount_rwf,
            "status": "PENDING",
            "fineract_debit_txn_id": None,
            "fineract_refund_txn_id": None,
            "provider_transaction_reference": None,
            "error_detail": None,
            "refund_attempts": 0,
            "integrator_fee_percentage": None,
            "ddin_cost_percentage": None,
            "fee_amount_rwf": None,
            "ddin_cost_amount_rwf": None,
            "margin_amount_rwf": None,
            "provider_operation_reference_id": None,
        }
        return True

    async def mark_debited(self, idempotency_key, debit_txn_id):
        row = self._rows[idempotency_key]
        row["status"] = "DEBITED"
        row["fineract_debit_txn_id"] = debit_txn_id

    async def mark_provider_pending(self, idempotency_key, operation_reference_id):
        self._rows[idempotency_key]["provider_operation_reference_id"] = operation_reference_id

    async def mark_success(
        self,
        idempotency_key,
        provider_transaction_reference,
        response_payload,
        *,
        integrator_fee_percentage=None,
        ddin_cost_percentage=None,
        fee_amount_rwf=None,
        ddin_cost_amount_rwf=None,
        margin_amount_rwf=None,
    ):
        row = self._rows[idempotency_key]
        row["status"] = "SUCCESS"
        row["provider_transaction_reference"] = provider_transaction_reference
        row["integrator_fee_percentage"] = integrator_fee_percentage
        row["ddin_cost_percentage"] = ddin_cost_percentage
        row["fee_amount_rwf"] = fee_amount_rwf
        row["ddin_cost_amount_rwf"] = ddin_cost_amount_rwf
        row["margin_amount_rwf"] = margin_amount_rwf

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


class FakeCollectionProvider:
    FORCE_FAIL_ACCOUNT_NUMBER = "00000000000"
    PENDING_ACCOUNT_NUMBER = "99999999999"

    async def collect(
        self, provider, customer_account_number, amount, *, reference_id=None, customer_name=None
    ):
        if customer_account_number == self.FORCE_FAIL_ACCOUNT_NUMBER:
            raise CollectionError(
                f"provider {provider} rejected account {customer_account_number}"
            )
        if customer_account_number == self.PENDING_ACCOUNT_NUMBER:
            raise CollectionPending(operation_reference_id="OP-REF-123")
        return f"{provider}-REF-123"


class FakeIntegratorRepo:
    """In-memory stand-in for IntegratorRepo - just enough for fee/margin tests."""

    def __init__(self, ddin_cost_percentage: str = "2.00"):
        self._settings = {"ddin_cost_percentage": ddin_cost_percentage}
        self._integrators: dict[int, dict] = {}

    async def get_setting(self, key):
        return self._settings.get(key)

    async def set_setting(self, key, value):
        self._settings[key] = value

    def register(self, integrator: dict) -> None:
        self._integrators[integrator["id"]] = integrator

    async def get_by_id(self, integrator_id):
        return self._integrators.get(integrator_id)


@pytest.fixture
def settings() -> Settings:
    return Settings(refund_max_attempts=3, refund_backoff_base_seconds=0.01)


@pytest.fixture
def repo() -> FakeTransactionLogRepo:
    return FakeTransactionLogRepo()


@pytest.fixture
def integrator() -> dict:
    return {"id": 1, "name": "Acme Aggregator", "fee_percentage": "2.30", "is_active": 1}


@pytest.fixture
def integrator_repo(integrator) -> FakeIntegratorRepo:
    repo = FakeIntegratorRepo()
    repo.register(integrator)
    return repo


@pytest.fixture
def fineract() -> FakeFineractClient:
    return FakeFineractClient()


@pytest.fixture
def collection_provider() -> FakeCollectionProvider:
    return FakeCollectionProvider()


@pytest.fixture
def collection_request() -> CollectionRequest:
    return CollectionRequest(
        fineract_savings_account_id="12345",
        provider="MTN",
        customer_account_number="0788123456",
        customer_name="Jean Uwimana",
        amount_rwf=Decimal("5000"),
    )
