import json
from decimal import Decimal
from typing import Any, Optional

import aiomysql
import pymysql

MYSQL_DUPLICATE_ENTRY = 1062

# transaction_logs.status values - keep in sync with db_init/001_schema.sql
STATUS_PENDING = "PENDING"
STATUS_DEBITED = "DEBITED"
STATUS_SUCCESS = "SUCCESS"
STATUS_FAILED_REFUNDED = "FAILED_REFUNDED"
STATUS_FAILED_REFUND_ERROR = "FAILED_REFUND_ERROR"

TERMINAL_STATUSES = {STATUS_SUCCESS, STATUS_FAILED_REFUNDED, STATUS_FAILED_REFUND_ERROR}
MID_FLIGHT_STATUSES = {STATUS_PENDING, STATUS_DEBITED}


class TransactionLogRepo:
    def __init__(self, pool: aiomysql.Pool):
        self._pool = pool

    async def get_by_idempotency_key(self, idempotency_key: str) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT * FROM transaction_logs WHERE idempotency_key = %s",
                    (idempotency_key,),
                )
                return await cur.fetchone()

    async def insert_pending(
        self,
        idempotency_key: str,
        fineract_savings_account_id: str,
        utility_provider: str,
        meter_number: str,
        amount_rwf: Decimal,
        request_payload: dict[str, Any],
    ) -> bool:
        """Returns True if this call created the row, False if the key already exists
        (a concurrent duplicate request lost the race - caller should re-fetch)."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        """
                        INSERT INTO transaction_logs
                            (idempotency_key, fineract_savings_account_id, utility_provider,
                             meter_number, amount_rwf, status, request_payload)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            idempotency_key,
                            fineract_savings_account_id,
                            utility_provider,
                            meter_number,
                            str(amount_rwf),
                            STATUS_PENDING,
                            json.dumps(request_payload),
                        ),
                    )
                    return True
                except pymysql.err.IntegrityError as exc:
                    if exc.args and exc.args[0] == MYSQL_DUPLICATE_ENTRY:
                        return False
                    raise

    async def mark_debited(self, idempotency_key: str, debit_txn_id: str) -> None:
        await self._update(
            idempotency_key,
            status=STATUS_DEBITED,
            fineract_debit_txn_id=debit_txn_id,
        )

    async def mark_success(
        self, idempotency_key: str, utility_token: str, response_payload: dict[str, Any]
    ) -> None:
        await self._update(
            idempotency_key,
            status=STATUS_SUCCESS,
            utility_token=utility_token,
            response_payload=json.dumps(response_payload),
        )

    async def mark_failed_refunded(
        self,
        idempotency_key: str,
        refund_txn_id: str,
        error_detail: str,
        response_payload: dict[str, Any],
    ) -> None:
        await self._update(
            idempotency_key,
            status=STATUS_FAILED_REFUNDED,
            fineract_refund_txn_id=refund_txn_id,
            error_detail=error_detail,
            response_payload=json.dumps(response_payload),
        )

    async def mark_failed_refund_error(
        self,
        idempotency_key: str,
        refund_attempts: int,
        error_detail: str,
        response_payload: dict[str, Any],
    ) -> None:
        await self._update(
            idempotency_key,
            status=STATUS_FAILED_REFUND_ERROR,
            refund_attempts=refund_attempts,
            error_detail=error_detail,
            response_payload=json.dumps(response_payload),
        )

    async def _update(self, idempotency_key: str, **fields: Any) -> None:
        set_clause = ", ".join(f"{col} = %s" for col in fields)
        params = list(fields.values()) + [idempotency_key]
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    f"UPDATE transaction_logs SET {set_clause} WHERE idempotency_key = %s",
                    params,
                )
