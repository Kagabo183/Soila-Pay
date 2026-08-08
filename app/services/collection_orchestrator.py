import logging
from decimal import Decimal
from typing import Optional

from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import Settings
from app.db.integrator_repo import IntegratorRepo
from app.db.transaction_log_repo import (
    STATUS_DEBIT_FAILED,
    STATUS_DEBITED,
    STATUS_FAILED_REFUND_ERROR,
    STATUS_FAILED_REFUNDED,
    STATUS_SUCCESS,
    TransactionLogRepo,
)
from app.exceptions import (
    CollectionError,
    CollectionPending,
    FineractError,
    IdempotencyConflictError,
    ManualReconciliationRequiredError,
)
from app.logging_conf import structured
from app.schemas.collection import CollectionRequest, CollectionResponse
from app.services.collection_provider import CollectionProvider
from app.services.fineract_client import DummyFineractClient, FineractClient

logger = logging.getLogger(__name__)

DEFAULT_DDIN_COST_PERCENTAGE = Decimal("2.00")


class CollectionOrchestrator:
    def __init__(
        self,
        settings: Settings,
        repo: TransactionLogRepo,
        fineract: FineractClient | DummyFineractClient,
        collection_provider: CollectionProvider,
        integrator_repo: Optional[IntegratorRepo] = None,
    ):
        self._settings = settings
        self._repo = repo
        self._fineract = fineract
        self._collection_provider = collection_provider
        # Optional: absent in unit tests that don't exercise fee/margin
        # calculation. When present, drives the per-transaction fee/cost/margin
        # snapshot recorded on success - see _compute_fee_snapshot below.
        self._integrator_repo = integrator_repo

    async def execute_collection(
        self,
        req: CollectionRequest,
        idempotency_key: str,
        integrator: Optional[dict] = None,
    ) -> CollectionResponse:
        existing = await self._repo.get_by_idempotency_key(idempotency_key)
        if existing is not None:
            return self._handle_existing(existing)

        inserted = await self._repo.insert_pending(
            idempotency_key=idempotency_key,
            fineract_savings_account_id=req.fineract_savings_account_id,
            provider=req.provider,
            customer_account_number=req.customer_account_number,
            customer_name=req.customer_name,
            amount_rwf=req.amount_rwf,
            request_payload=req.model_dump(mode="json"),
            integrator_id=integrator["id"] if integrator else None,
        )
        if not inserted:
            # Lost the insert race to a concurrent identical request.
            existing = await self._repo.get_by_idempotency_key(idempotency_key)
            return self._handle_existing(existing)

        return await self._run_sequence(req, idempotency_key, integrator)

    def _handle_existing(self, row: dict) -> CollectionResponse:
        status = row["status"]

        if status in (STATUS_SUCCESS, STATUS_FAILED_REFUNDED):
            logger.info(
                "idempotent_replay",
                extra=structured(
                    "idempotent_replay",
                    idempotency_key=row["idempotency_key"],
                    status=status,
                ),
            )
            return self._response_from_row(row)

        if status == STATUS_FAILED_REFUND_ERROR:
            raise ManualReconciliationRequiredError(
                f"idempotency_key {row['idempotency_key']} previously failed to refund "
                "and requires manual reconciliation"
            )

        if status == STATUS_DEBIT_FAILED:
            # Terminal, but no money ever moved - consistently replay the same
            # clean error rather than a misleading "in progress" conflict.
            # Reusing FineractError here (not raising it fresh) purely so the
            # router's existing `except FineractError -> 502` handling applies
            # the same way it did on the original attempt.
            raise FineractError(
                row["error_detail"] or "Fineract debit failed (no further detail recorded)"
            )

        # PENDING or DEBITED: another request with this key is mid-flight, or a prior
        # process crashed before reaching a terminal state. Never re-execute here -
        # see the README's "known limitation" section on stuck DEBITED rows.
        raise IdempotencyConflictError(
            f"idempotency_key {row['idempotency_key']} is currently in progress "
            f"(status={status})"
        )

    def _response_from_row(self, row: dict) -> CollectionResponse:
        status = row["status"]
        # DEBITED is our own internal "wallet debited, awaiting the
        # provider's async outcome" bookkeeping value - CollectionResponse's
        # status was never meant to expose it (it's not in CollectionStatus's
        # Literal at all). From a caller's perspective this is exactly the
        # same "still waiting" state the initial synchronous response
        # already reports as PENDING - see _mark_pending.
        if status == STATUS_DEBITED:
            return CollectionResponse(
                status="PENDING",
                idempotency_key=row["idempotency_key"],
                fineract_savings_account_id=row["fineract_savings_account_id"],
                debit_transaction_id=row["fineract_debit_txn_id"],
                refund_transaction_id=row["fineract_refund_txn_id"],
                provider_transaction_reference=row["provider_transaction_reference"],
                amount_rwf=Decimal(row["amount_rwf"]),
                message=(
                    "Provider acknowledged the request but has not confirmed the "
                    "outcome yet; it will resolve via webhook."
                ),
                refunded=False,
            )
        return CollectionResponse(
            status=status,
            idempotency_key=row["idempotency_key"],
            fineract_savings_account_id=row["fineract_savings_account_id"],
            debit_transaction_id=row["fineract_debit_txn_id"],
            refund_transaction_id=row["fineract_refund_txn_id"],
            provider_transaction_reference=row["provider_transaction_reference"],
            amount_rwf=Decimal(row["amount_rwf"]),
            message=row["error_detail"] or "Collection already processed",
            refunded=status == STATUS_FAILED_REFUNDED,
        )

    async def _run_sequence(
        self,
        req: CollectionRequest,
        idempotency_key: str,
        integrator: Optional[dict],
    ) -> CollectionResponse:
        note = f"Collection via {req.provider} from {req.customer_account_number}"

        try:
            debit_txn_id = await self._fineract.withdraw(
                req.fineract_savings_account_id, req.amount_rwf, note
            )
        except FineractError as exc:
            logger.error(
                "debit_failed",
                extra=structured(
                    "debit_failed",
                    idempotency_key=idempotency_key,
                    savings_account_id=req.fineract_savings_account_id,
                    error=str(exc),
                ),
            )
            # No money moved - mark this terminal (not left at PENDING, which
            # _handle_existing would otherwise treat as "mid-flight" and
            # permanently block retries with this same key behind a
            # misleading 409). See STATUS_DEBIT_FAILED.
            await self._repo.mark_debit_failed(idempotency_key, str(exc))
            raise

        await self._repo.mark_debited(idempotency_key, debit_txn_id)
        logger.info(
            "debit_succeeded",
            extra=structured(
                "debit_succeeded",
                idempotency_key=idempotency_key,
                savings_account_id=req.fineract_savings_account_id,
                debit_transaction_id=debit_txn_id,
                amount_rwf=str(req.amount_rwf),
            ),
        )

        try:
            provider_transaction_reference = await self._collection_provider.collect(
                req.provider,
                req.customer_account_number,
                req.amount_rwf,
                reference_id=idempotency_key,
                customer_name=req.customer_name,
            )
        except CollectionPending as exc:
            return await self._mark_pending(idempotency_key, req, debit_txn_id, exc)
        except CollectionError as exc:
            return await self._rollback(
                fineract_savings_account_id=req.fineract_savings_account_id,
                amount_rwf=req.amount_rwf,
                idempotency_key=idempotency_key,
                debit_txn_id=debit_txn_id,
                error_detail=str(exc),
            )

        response = CollectionResponse(
            status=STATUS_SUCCESS,
            idempotency_key=idempotency_key,
            fineract_savings_account_id=req.fineract_savings_account_id,
            debit_transaction_id=debit_txn_id,
            provider_transaction_reference=provider_transaction_reference,
            amount_rwf=req.amount_rwf,
            message="Collection completed successfully",
            refunded=False,
        )
        fee_snapshot = await self._compute_fee_snapshot(req.amount_rwf, integrator)
        await self._repo.mark_success(
            idempotency_key,
            provider_transaction_reference,
            response.model_dump(mode="json"),
            **fee_snapshot,
        )
        logger.info(
            "collection_succeeded",
            extra=structured(
                "collection_succeeded",
                idempotency_key=idempotency_key,
                debit_transaction_id=debit_txn_id,
            ),
        )
        return response

    async def _compute_fee_snapshot(
        self, amount_rwf: Decimal, integrator: Optional[dict]
    ) -> dict:
        """Fee Soila Pay charges the integrator, DDIN's cost to us, and the
        resulting margin - snapshotted at transaction time so later rate
        changes (edited via the admin API/UI) don't rewrite history. Returns
        all-None fields when there's no integrator context (e.g. unit tests
        that construct the orchestrator without an integrator_repo)."""
        empty = {
            "integrator_fee_percentage": None,
            "ddin_cost_percentage": None,
            "fee_amount_rwf": None,
            "ddin_cost_amount_rwf": None,
            "margin_amount_rwf": None,
        }
        if integrator is None or self._integrator_repo is None:
            return empty

        ddin_cost_setting = await self._integrator_repo.get_setting("ddin_cost_percentage")
        ddin_cost_percentage = (
            Decimal(ddin_cost_setting) if ddin_cost_setting else DEFAULT_DDIN_COST_PERCENTAGE
        )
        integrator_fee_percentage = Decimal(str(integrator["fee_percentage"]))

        fee_amount_rwf = (amount_rwf * integrator_fee_percentage / Decimal("100")).quantize(
            Decimal("0.01")
        )
        ddin_cost_amount_rwf = (amount_rwf * ddin_cost_percentage / Decimal("100")).quantize(
            Decimal("0.01")
        )
        margin_amount_rwf = fee_amount_rwf - ddin_cost_amount_rwf

        return {
            "integrator_fee_percentage": integrator_fee_percentage,
            "ddin_cost_percentage": ddin_cost_percentage,
            "fee_amount_rwf": fee_amount_rwf,
            "ddin_cost_amount_rwf": ddin_cost_amount_rwf,
            "margin_amount_rwf": margin_amount_rwf,
        }

    async def _mark_pending(
        self,
        idempotency_key: str,
        req: CollectionRequest,
        debit_txn_id: str,
        pending: CollectionPending,
    ) -> CollectionResponse:
        await self._repo.mark_provider_pending(idempotency_key, pending.operation_reference_id)
        logger.info(
            "collection_pending_provider_webhook",
            extra=structured(
                "collection_pending_provider_webhook",
                idempotency_key=idempotency_key,
                debit_transaction_id=debit_txn_id,
                operation_reference_id=pending.operation_reference_id,
            ),
        )
        return CollectionResponse(
            status="PENDING",
            idempotency_key=idempotency_key,
            fineract_savings_account_id=req.fineract_savings_account_id,
            debit_transaction_id=debit_txn_id,
            amount_rwf=req.amount_rwf,
            message=(
                "Provider acknowledged the request but has not confirmed the outcome yet; "
                "it will resolve via webhook."
            ),
            refunded=False,
        )

    async def resolve_provider_success(
        self, idempotency_key: str, provider_transaction_reference: str
    ) -> None:
        """Called from the DDIN webhook handler (app/api/v1/webhooks.py) on a
        collection.success event. No-ops on redelivery or an unknown key -
        webhooks are not guaranteed exactly-once."""
        row = await self._repo.get_by_idempotency_key(idempotency_key)
        if row is None:
            logger.warning(
                "webhook_success_unknown_idempotency_key",
                extra={"idempotency_key": idempotency_key},
            )
            return
        if row["status"] != STATUS_DEBITED:
            logger.info(
                "webhook_success_ignored_not_pending",
                extra={"idempotency_key": idempotency_key, "status": row["status"]},
            )
            return

        amount_rwf = Decimal(row["amount_rwf"])
        integrator = await self._load_integrator(row.get("integrator_id"))
        response = CollectionResponse(
            status=STATUS_SUCCESS,
            idempotency_key=idempotency_key,
            fineract_savings_account_id=row["fineract_savings_account_id"],
            debit_transaction_id=row["fineract_debit_txn_id"],
            provider_transaction_reference=provider_transaction_reference,
            amount_rwf=amount_rwf,
            message="Collection completed successfully (confirmed via provider webhook)",
            refunded=False,
        )
        fee_snapshot = await self._compute_fee_snapshot(amount_rwf, integrator)
        await self._repo.mark_success(
            idempotency_key,
            provider_transaction_reference,
            response.model_dump(mode="json"),
            **fee_snapshot,
        )
        logger.info(
            "collection_succeeded_via_webhook",
            extra=structured("collection_succeeded_via_webhook", idempotency_key=idempotency_key),
        )

    async def resolve_provider_failure(self, idempotency_key: str, error_detail: str) -> None:
        """Called from the DDIN webhook handler on a collection.failed event -
        runs the same Fineract refund rollback a synchronous failure would."""
        row = await self._repo.get_by_idempotency_key(idempotency_key)
        if row is None:
            logger.warning(
                "webhook_failure_unknown_idempotency_key",
                extra={"idempotency_key": idempotency_key},
            )
            return
        if row["status"] != STATUS_DEBITED:
            logger.info(
                "webhook_failure_ignored_not_pending",
                extra={"idempotency_key": idempotency_key, "status": row["status"]},
            )
            return

        await self._rollback(
            fineract_savings_account_id=row["fineract_savings_account_id"],
            amount_rwf=Decimal(row["amount_rwf"]),
            idempotency_key=idempotency_key,
            debit_txn_id=row["fineract_debit_txn_id"],
            error_detail=error_detail,
        )

    async def sync_with_provider(self, idempotency_key: str) -> Optional[CollectionResponse]:
        """Actively asks the provider for this transaction's real, current
        status and reconciles our local record to match - closes the gap
        when the provider's webhook can't reach us (e.g. no public URL in
        local dev) even though the provider itself already resolved the
        collection. Only a DEBITED row is ever polled: PENDING means the
        Fineract debit hasn't even run yet (nothing to ask the provider
        about), and every other status is already terminal. A DEBITED row
        can only exist via a provider that raises CollectionPending (the
        dummy provider never does), so get_status() is always meaningful
        here. No-ops (returns the row as-is) if the provider doesn't support
        status lookups (get_status returns None) or has no record of it yet."""
        row = await self._repo.get_by_idempotency_key(idempotency_key)
        if row is None:
            return None
        if row["status"] != STATUS_DEBITED:
            return self._response_from_row(row)

        provider_status = await self._collection_provider.get_status(idempotency_key)
        if provider_status is None:
            return self._response_from_row(row)

        if provider_status.status == "success":
            reference = provider_status.provider_transaction_reference or idempotency_key
            await self.resolve_provider_success(idempotency_key, reference)
        elif provider_status.status == "failed":
            await self.resolve_provider_failure(
                idempotency_key,
                provider_status.message or "Provider reported this collection as failed",
            )
        # "pending", or any other value: still genuinely in flight - nothing to reconcile.

        row = await self._repo.get_by_idempotency_key(idempotency_key)
        return self._response_from_row(row)

    async def _load_integrator(self, integrator_id) -> Optional[dict]:
        if integrator_id is None or self._integrator_repo is None:
            return None
        return await self._integrator_repo.get_by_id(integrator_id)

    async def _rollback(
        self,
        *,
        fineract_savings_account_id: str,
        amount_rwf: Decimal,
        idempotency_key: str,
        debit_txn_id: str,
        error_detail: str,
    ) -> CollectionResponse:
        note = f"Rollback refund for failed collection (debit txn {debit_txn_id})"
        attempts = 0
        refund_txn_id: str | None = None

        try:
            async for attempt in AsyncRetrying(
                stop=stop_after_attempt(self._settings.refund_max_attempts),
                wait=wait_exponential(
                    multiplier=self._settings.refund_backoff_base_seconds, min=1, max=30
                ),
                retry=retry_if_exception_type(FineractError),
                reraise=True,
            ):
                with attempt:
                    attempts += 1
                    if attempts > 1:
                        logger.warning(
                            "refund_retry",
                            extra=structured(
                                "refund_retry",
                                idempotency_key=idempotency_key,
                                attempt=attempts,
                            ),
                        )
                    refund_txn_id = await self._fineract.deposit(
                        fineract_savings_account_id, amount_rwf, note
                    )
        except FineractError as exc:
            logger.critical(
                "refund_failed_exhausted",
                extra=structured(
                    "refund_failed_exhausted",
                    idempotency_key=idempotency_key,
                    savings_account_id=fineract_savings_account_id,
                    debit_transaction_id=debit_txn_id,
                    attempts=attempts,
                    error=str(exc),
                ),
            )
            response = CollectionResponse(
                status=STATUS_FAILED_REFUND_ERROR,
                idempotency_key=idempotency_key,
                fineract_savings_account_id=fineract_savings_account_id,
                debit_transaction_id=debit_txn_id,
                amount_rwf=amount_rwf,
                message=(
                    f"CRITICAL: collection failed ({error_detail}) AND refund "
                    f"failed after {attempts} attempts ({exc}). Manual reconciliation "
                    "required."
                ),
                refunded=False,
            )
            await self._repo.mark_failed_refund_error(
                idempotency_key,
                attempts,
                f"{error_detail} | refund error: {exc}",
                response.model_dump(mode="json"),
            )
            return response

        response = CollectionResponse(
            status=STATUS_FAILED_REFUNDED,
            idempotency_key=idempotency_key,
            fineract_savings_account_id=fineract_savings_account_id,
            debit_transaction_id=debit_txn_id,
            refund_transaction_id=refund_txn_id,
            amount_rwf=amount_rwf,
            message=f"Collection failed ({error_detail}). Funds were refunded successfully.",
            refunded=True,
        )
        await self._repo.mark_failed_refunded(
            idempotency_key,
            refund_txn_id,
            error_detail,
            response.model_dump(mode="json"),
        )
        logger.warning(
            "collection_rolled_back",
            extra=structured(
                "collection_rolled_back",
                idempotency_key=idempotency_key,
                refund_transaction_id=refund_txn_id,
            ),
        )
        return response
