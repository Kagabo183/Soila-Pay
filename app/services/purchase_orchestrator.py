import logging
from decimal import Decimal

from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import Settings
from app.db.transaction_log_repo import (
    STATUS_FAILED_REFUND_ERROR,
    STATUS_FAILED_REFUNDED,
    STATUS_SUCCESS,
    TransactionLogRepo,
)
from app.exceptions import (
    FineractError,
    IdempotencyConflictError,
    ManualReconciliationRequiredError,
    UtilityPurchaseError,
)
from app.logging_conf import structured
from app.schemas.utility import UtilityPurchaseRequest, UtilityPurchaseResponse
from app.services.fineract_client import FineractClient
from app.services.utility_provider import UtilityProvider

logger = logging.getLogger(__name__)


class PurchaseOrchestrator:
    def __init__(
        self,
        settings: Settings,
        repo: TransactionLogRepo,
        fineract: FineractClient,
        utility_provider: UtilityProvider,
    ):
        self._settings = settings
        self._repo = repo
        self._fineract = fineract
        self._utility_provider = utility_provider

    async def execute_purchase(
        self, req: UtilityPurchaseRequest, idempotency_key: str
    ) -> UtilityPurchaseResponse:
        existing = await self._repo.get_by_idempotency_key(idempotency_key)
        if existing is not None:
            return self._handle_existing(existing)

        inserted = await self._repo.insert_pending(
            idempotency_key=idempotency_key,
            fineract_savings_account_id=req.fineract_savings_account_id,
            utility_provider=req.utility_provider,
            meter_number=req.meter_number,
            amount_rwf=req.amount_rwf,
            request_payload=req.model_dump(mode="json"),
        )
        if not inserted:
            # Lost the insert race to a concurrent identical request.
            existing = await self._repo.get_by_idempotency_key(idempotency_key)
            return self._handle_existing(existing)

        return await self._run_sequence(req, idempotency_key)

    def _handle_existing(self, row: dict) -> UtilityPurchaseResponse:
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

        # PENDING or DEBITED: another request with this key is mid-flight, or a prior
        # process crashed before reaching a terminal state. Never re-execute here -
        # see the README's "known limitation" section on stuck DEBITED rows.
        raise IdempotencyConflictError(
            f"idempotency_key {row['idempotency_key']} is currently in progress "
            f"(status={status})"
        )

    def _response_from_row(self, row: dict) -> UtilityPurchaseResponse:
        return UtilityPurchaseResponse(
            status=row["status"],
            idempotency_key=row["idempotency_key"],
            fineract_savings_account_id=row["fineract_savings_account_id"],
            debit_transaction_id=row["fineract_debit_txn_id"],
            refund_transaction_id=row["fineract_refund_txn_id"],
            utility_token=row["utility_token"],
            amount_rwf=Decimal(row["amount_rwf"]),
            message=row["error_detail"] or "Purchase already processed",
            refunded=row["status"] == STATUS_FAILED_REFUNDED,
        )

    async def _run_sequence(
        self, req: UtilityPurchaseRequest, idempotency_key: str
    ) -> UtilityPurchaseResponse:
        note = f"Utility purchase {req.utility_provider} meter {req.meter_number}"

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
            utility_token = await self._utility_provider.purchase(
                req.utility_provider,
                req.meter_number,
                req.amount_rwf,
                reference_id=idempotency_key,
            )
        except UtilityPurchaseError as exc:
            return await self._rollback(req, idempotency_key, debit_txn_id, str(exc))

        response = UtilityPurchaseResponse(
            status=STATUS_SUCCESS,
            idempotency_key=idempotency_key,
            fineract_savings_account_id=req.fineract_savings_account_id,
            debit_transaction_id=debit_txn_id,
            utility_token=utility_token,
            amount_rwf=req.amount_rwf,
            message="Purchase completed successfully",
            refunded=False,
        )
        await self._repo.mark_success(
            idempotency_key, utility_token, response.model_dump(mode="json")
        )
        logger.info(
            "purchase_succeeded",
            extra=structured(
                "purchase_succeeded",
                idempotency_key=idempotency_key,
                debit_transaction_id=debit_txn_id,
            ),
        )
        return response

    async def _rollback(
        self,
        req: UtilityPurchaseRequest,
        idempotency_key: str,
        debit_txn_id: str,
        error_detail: str,
    ) -> UtilityPurchaseResponse:
        note = f"Rollback refund for failed utility purchase (debit txn {debit_txn_id})"
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
                        req.fineract_savings_account_id, req.amount_rwf, note
                    )
        except FineractError as exc:
            logger.critical(
                "refund_failed_exhausted",
                extra=structured(
                    "refund_failed_exhausted",
                    idempotency_key=idempotency_key,
                    savings_account_id=req.fineract_savings_account_id,
                    debit_transaction_id=debit_txn_id,
                    attempts=attempts,
                    error=str(exc),
                ),
            )
            response = UtilityPurchaseResponse(
                status=STATUS_FAILED_REFUND_ERROR,
                idempotency_key=idempotency_key,
                fineract_savings_account_id=req.fineract_savings_account_id,
                debit_transaction_id=debit_txn_id,
                amount_rwf=req.amount_rwf,
                message=(
                    f"CRITICAL: utility purchase failed ({error_detail}) AND refund "
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

        response = UtilityPurchaseResponse(
            status=STATUS_FAILED_REFUNDED,
            idempotency_key=idempotency_key,
            fineract_savings_account_id=req.fineract_savings_account_id,
            debit_transaction_id=debit_txn_id,
            refund_transaction_id=refund_txn_id,
            amount_rwf=req.amount_rwf,
            message=f"Utility purchase failed ({error_detail}). Funds were refunded successfully.",
            refunded=True,
        )
        await self._repo.mark_failed_refunded(
            idempotency_key,
            refund_txn_id,
            error_detail,
            response.model_dump(mode="json"),
        )
        logger.warning(
            "purchase_rolled_back",
            extra=structured(
                "purchase_rolled_back",
                idempotency_key=idempotency_key,
                refund_transaction_id=refund_txn_id,
            ),
        )
        return response
