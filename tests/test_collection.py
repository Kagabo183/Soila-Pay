from decimal import Decimal

import pytest

from app.exceptions import IdempotencyConflictError, ManualReconciliationRequiredError
from app.services.collection_orchestrator import CollectionOrchestrator

pytestmark = pytest.mark.asyncio


def make_orchestrator(settings, repo, fineract, collection_provider, integrator_repo=None):
    return CollectionOrchestrator(
        settings=settings,
        repo=repo,
        fineract=fineract,
        collection_provider=collection_provider,
        integrator_repo=integrator_repo,
    )


async def test_happy_path_returns_success(settings, repo, fineract, collection_provider, collection_request):
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)

    response = await orchestrator.execute_collection(collection_request, "key-success-1")

    assert response.status == "SUCCESS"
    assert response.refunded is False
    assert response.provider_transaction_reference == "MTN-REF-123"
    assert len(fineract.withdraw_calls) == 1
    assert len(fineract.deposit_calls) == 0


async def test_forced_collection_failure_triggers_rollback(
    settings, repo, fineract, collection_provider, collection_request
):
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    collection_request = collection_request.model_copy(
        update={"customer_account_number": "00000000000"}
    )

    response = await orchestrator.execute_collection(collection_request, "key-rollback-1")

    assert response.status == "FAILED_REFUNDED"
    assert response.refunded is True
    assert len(fineract.withdraw_calls) == 1
    assert len(fineract.deposit_calls) == 1


async def test_repeated_idempotency_key_does_not_double_debit(
    settings, repo, fineract, collection_provider, collection_request
):
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)

    first = await orchestrator.execute_collection(collection_request, "key-replay-1")
    second = await orchestrator.execute_collection(collection_request, "key-replay-1")

    assert first.status == second.status == "SUCCESS"
    assert first.debit_transaction_id == second.debit_transaction_id
    assert len(fineract.withdraw_calls) == 1  # not re-debited on replay


async def test_concurrent_key_in_progress_raises_conflict(
    settings, repo, collection_request
):
    await repo.insert_pending(
        "key-inflight",
        collection_request.fineract_savings_account_id,
        collection_request.provider,
        collection_request.customer_account_number,
        collection_request.customer_name,
        collection_request.amount_rwf,
        {},
    )
    orchestrator = make_orchestrator(settings, repo, fineract=None, collection_provider=None)

    with pytest.raises(IdempotencyConflictError):
        await orchestrator.execute_collection(collection_request, "key-inflight")


async def test_refund_exhausted_marks_failed_refund_error(
    settings, repo, collection_provider, collection_request
):
    from tests.conftest import FakeFineractClient

    fineract = FakeFineractClient(deposit_failures=99)  # always fails
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    collection_request = collection_request.model_copy(
        update={"customer_account_number": "00000000000"}
    )

    response = await orchestrator.execute_collection(collection_request, "key-refund-error-1")

    assert response.status == "FAILED_REFUND_ERROR"
    assert response.refunded is False


async def test_sync_with_provider_resolves_success_when_provider_confirms(
    settings, repo, fineract, collection_provider, collection_request
):
    from app.services.collection_provider import ProviderCollectionStatus

    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    pending_request = collection_request.model_copy(
        update={"customer_account_number": collection_provider.PENDING_ACCOUNT_NUMBER}
    )
    pending = await orchestrator.execute_collection(pending_request, "key-sync-success")
    assert pending.status == "PENDING"

    collection_provider.status_responses["key-sync-success"] = ProviderCollectionStatus(
        status="success",
        message="Mock MTN payment completed successfully",
        provider_transaction_reference="MTN-REAL-REF",
        customer_name=pending_request.customer_name,
    )

    synced = await orchestrator.sync_with_provider("key-sync-success")

    assert synced.status == "SUCCESS"
    assert synced.provider_transaction_reference == "MTN-REAL-REF"
    row = await repo.get_by_idempotency_key("key-sync-success")
    assert row["status"] == "SUCCESS"


async def test_sync_with_provider_resolves_failure_and_refunds(
    settings, repo, fineract, collection_provider, collection_request
):
    from app.services.collection_provider import ProviderCollectionStatus

    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    pending_request = collection_request.model_copy(
        update={"customer_account_number": collection_provider.PENDING_ACCOUNT_NUMBER}
    )
    await orchestrator.execute_collection(pending_request, "key-sync-failed")

    collection_provider.status_responses["key-sync-failed"] = ProviderCollectionStatus(
        status="failed",
        message="Invalid Vendor",
        provider_transaction_reference=None,
        customer_name=pending_request.customer_name,
    )

    synced = await orchestrator.sync_with_provider("key-sync-failed")

    assert synced.status == "FAILED_REFUNDED"
    assert synced.refunded is True
    assert len(fineract.deposit_calls) == 1


async def test_sync_with_provider_noop_when_still_pending(
    settings, repo, fineract, collection_provider, collection_request
):
    from app.services.collection_provider import ProviderCollectionStatus

    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    pending_request = collection_request.model_copy(
        update={"customer_account_number": collection_provider.PENDING_ACCOUNT_NUMBER}
    )
    await orchestrator.execute_collection(pending_request, "key-sync-still-pending")
    collection_provider.status_responses["key-sync-still-pending"] = ProviderCollectionStatus(
        status="pending", message=None, provider_transaction_reference=None, customer_name=None
    )

    synced = await orchestrator.sync_with_provider("key-sync-still-pending")

    assert synced.status == "PENDING"
    row = await repo.get_by_idempotency_key("key-sync-still-pending")
    assert row["status"] == "DEBITED"  # local bookkeeping state unchanged


async def test_sync_with_provider_noop_when_provider_has_no_record(
    settings, repo, fineract, collection_provider, collection_request
):
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    pending_request = collection_request.model_copy(
        update={"customer_account_number": collection_provider.PENDING_ACCOUNT_NUMBER}
    )
    await orchestrator.execute_collection(pending_request, "key-sync-unknown")
    # No entry set in status_responses -> get_status() returns None, like a
    # genuine DDIN 404 "Transaction not found".

    synced = await orchestrator.sync_with_provider("key-sync-unknown")

    assert synced.status == "PENDING"


async def test_sync_with_provider_noop_when_already_terminal(
    settings, repo, fineract, collection_provider, collection_request
):
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    success = await orchestrator.execute_collection(collection_request, "key-sync-terminal")
    assert success.status == "SUCCESS"

    synced = await orchestrator.sync_with_provider("key-sync-terminal")

    assert synced.status == "SUCCESS"
    # Never even asked the provider - a terminal row has nothing to reconcile.
    assert "key-sync-terminal" not in collection_provider.get_status_calls
    assert len(fineract.deposit_calls) == 0


async def test_previous_refund_error_requires_manual_reconciliation(
    settings, repo, collection_provider, collection_request
):
    from tests.conftest import FakeFineractClient

    fineract = FakeFineractClient(deposit_failures=99)
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    collection_request = collection_request.model_copy(
        update={"customer_account_number": "00000000000"}
    )

    await orchestrator.execute_collection(collection_request, "key-manual-1")

    with pytest.raises(ManualReconciliationRequiredError):
        await orchestrator.execute_collection(collection_request, "key-manual-1")


async def test_success_with_integrator_records_fee_and_margin_snapshot(
    settings, repo, fineract, collection_provider, integrator_repo, integrator, collection_request
):
    orchestrator = make_orchestrator(
        settings, repo, fineract, collection_provider, integrator_repo=integrator_repo
    )

    response = await orchestrator.execute_collection(
        collection_request, "key-fee-1", integrator=integrator
    )

    assert response.status == "SUCCESS"
    row = repo._rows["key-fee-1"]
    assert row["integrator_id"] == integrator["id"]
    # amount 5000, integrator fee 2.30% = 115.00, DDIN cost 2.00% = 100.00, margin = 15.00
    assert row["fee_amount_rwf"] == Decimal("115.00")
    assert row["ddin_cost_amount_rwf"] == Decimal("100.00")
    assert row["margin_amount_rwf"] == Decimal("15.00")
    assert row["integrator_fee_percentage"] == Decimal("2.30")
    assert row["ddin_cost_percentage"] == Decimal("2.00")


async def test_success_without_integrator_leaves_fee_fields_none(
    settings, repo, fineract, collection_provider, collection_request
):
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)

    response = await orchestrator.execute_collection(collection_request, "key-no-integrator-1")

    assert response.status == "SUCCESS"
    row = repo._rows["key-no-integrator-1"]
    assert row["integrator_id"] is None
    assert row["fee_amount_rwf"] is None
    assert row["margin_amount_rwf"] is None


async def test_provider_pending_leaves_transaction_debited_awaiting_webhook(
    settings, repo, fineract, collection_provider, collection_request
):
    from tests.conftest import FakeCollectionProvider

    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    pending_request = collection_request.model_copy(
        update={"customer_account_number": FakeCollectionProvider.PENDING_ACCOUNT_NUMBER}
    )

    response = await orchestrator.execute_collection(pending_request, "key-pending-1")

    assert response.status == "PENDING"
    assert response.refunded is False
    row = repo._rows["key-pending-1"]
    assert row["status"] == "DEBITED"
    assert row["provider_operation_reference_id"] == "OP-REF-123"
    assert len(fineract.deposit_calls) == 0  # no rollback while pending


async def test_webhook_success_resolves_pending_transaction_with_fee_snapshot(
    settings, repo, fineract, collection_provider, integrator_repo, integrator, collection_request
):
    from tests.conftest import FakeCollectionProvider

    orchestrator = make_orchestrator(
        settings, repo, fineract, collection_provider, integrator_repo=integrator_repo
    )
    pending_request = collection_request.model_copy(
        update={"customer_account_number": FakeCollectionProvider.PENDING_ACCOUNT_NUMBER}
    )
    await orchestrator.execute_collection(
        pending_request, "key-webhook-success-1", integrator=integrator
    )

    await orchestrator.resolve_provider_success("key-webhook-success-1", "CYC-559013")

    row = repo._rows["key-webhook-success-1"]
    assert row["status"] == "SUCCESS"
    assert row["provider_transaction_reference"] == "CYC-559013"
    assert row["fee_amount_rwf"] == Decimal("115.00")
    assert row["margin_amount_rwf"] == Decimal("15.00")


async def test_webhook_failure_rolls_back_pending_transaction(
    settings, repo, fineract, collection_provider, collection_request
):
    from tests.conftest import FakeCollectionProvider

    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    pending_request = collection_request.model_copy(
        update={"customer_account_number": FakeCollectionProvider.PENDING_ACCOUNT_NUMBER}
    )
    await orchestrator.execute_collection(pending_request, "key-webhook-fail-1")

    await orchestrator.resolve_provider_failure("key-webhook-fail-1", "insufficient float balance")

    row = repo._rows["key-webhook-fail-1"]
    assert row["status"] == "FAILED_REFUNDED"
    assert len(fineract.deposit_calls) == 1


async def test_webhook_resolution_is_a_noop_for_already_resolved_transaction(
    settings, repo, fineract, collection_provider, collection_request
):
    """Webhooks aren't guaranteed exactly-once - a redelivered event for an
    already-terminal transaction must not re-debit, re-refund, or overwrite it."""
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)
    await orchestrator.execute_collection(collection_request, "key-already-success-1")
    assert repo._rows["key-already-success-1"]["status"] == "SUCCESS"

    await orchestrator.resolve_provider_success("key-already-success-1", "SOME-OTHER-REF")

    # Untouched - the real reference from the synchronous path is preserved.
    assert repo._rows["key-already-success-1"]["provider_transaction_reference"] == "MTN-REF-123"
    assert len(fineract.deposit_calls) == 0


async def test_webhook_resolution_is_a_noop_for_unknown_idempotency_key(
    settings, repo, fineract, collection_provider
):
    orchestrator = make_orchestrator(settings, repo, fineract, collection_provider)

    # Should not raise - just log and return.
    await orchestrator.resolve_provider_success("no-such-key", "REF")
    await orchestrator.resolve_provider_failure("no-such-key", "some error")
