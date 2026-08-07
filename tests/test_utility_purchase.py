import pytest

from app.exceptions import IdempotencyConflictError, ManualReconciliationRequiredError
from app.services.purchase_orchestrator import PurchaseOrchestrator

pytestmark = pytest.mark.asyncio


def make_orchestrator(settings, repo, fineract, utility_provider):
    return PurchaseOrchestrator(
        settings=settings, repo=repo, fineract=fineract, utility_provider=utility_provider
    )


async def test_happy_path_returns_success(settings, repo, fineract, utility_provider, purchase_request):
    orchestrator = make_orchestrator(settings, repo, fineract, utility_provider)

    response = await orchestrator.execute_purchase(purchase_request, "key-success-1")

    assert response.status == "SUCCESS"
    assert response.refunded is False
    assert response.utility_token == "REG-TOKEN-123"
    assert len(fineract.withdraw_calls) == 1
    assert len(fineract.deposit_calls) == 0


async def test_forced_utility_failure_triggers_rollback(
    settings, repo, fineract, utility_provider, purchase_request
):
    orchestrator = make_orchestrator(settings, repo, fineract, utility_provider)
    purchase_request = purchase_request.model_copy(update={"meter_number": "00000000000"})

    response = await orchestrator.execute_purchase(purchase_request, "key-rollback-1")

    assert response.status == "FAILED_REFUNDED"
    assert response.refunded is True
    assert len(fineract.withdraw_calls) == 1
    assert len(fineract.deposit_calls) == 1


async def test_repeated_idempotency_key_does_not_double_debit(
    settings, repo, fineract, utility_provider, purchase_request
):
    orchestrator = make_orchestrator(settings, repo, fineract, utility_provider)

    first = await orchestrator.execute_purchase(purchase_request, "key-replay-1")
    second = await orchestrator.execute_purchase(purchase_request, "key-replay-1")

    assert first.status == second.status == "SUCCESS"
    assert first.debit_transaction_id == second.debit_transaction_id
    assert len(fineract.withdraw_calls) == 1  # not re-debited on replay


async def test_concurrent_key_in_progress_raises_conflict(
    settings, repo, purchase_request
):
    await repo.insert_pending(
        "key-inflight",
        purchase_request.fineract_savings_account_id,
        purchase_request.utility_provider,
        purchase_request.meter_number,
        purchase_request.amount_rwf,
        {},
    )
    orchestrator = make_orchestrator(settings, repo, fineract=None, utility_provider=None)

    with pytest.raises(IdempotencyConflictError):
        await orchestrator.execute_purchase(purchase_request, "key-inflight")


async def test_refund_exhausted_marks_failed_refund_error(
    settings, repo, utility_provider, purchase_request
):
    from tests.conftest import FakeFineractClient

    fineract = FakeFineractClient(deposit_failures=99)  # always fails
    orchestrator = make_orchestrator(settings, repo, fineract, utility_provider)
    purchase_request = purchase_request.model_copy(update={"meter_number": "00000000000"})

    response = await orchestrator.execute_purchase(purchase_request, "key-refund-error-1")

    assert response.status == "FAILED_REFUND_ERROR"
    assert response.refunded is False
    assert len(fineract.deposit_calls) == settings.refund_max_attempts


async def test_previous_refund_error_requires_manual_reconciliation(
    settings, repo, utility_provider, purchase_request
):
    from tests.conftest import FakeFineractClient

    fineract = FakeFineractClient(deposit_failures=99)
    orchestrator = make_orchestrator(settings, repo, fineract, utility_provider)
    purchase_request = purchase_request.model_copy(update={"meter_number": "00000000000"})

    await orchestrator.execute_purchase(purchase_request, "key-manual-1")

    with pytest.raises(ManualReconciliationRequiredError):
        await orchestrator.execute_purchase(purchase_request, "key-manual-1")
