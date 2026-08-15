import json
from decimal import Decimal
from typing import Any, Optional

import aiomysql
import pymysql

MYSQL_DUPLICATE_ENTRY = 1062

# transaction_logs.status values - keep in sync with db_init/001_schema.sql
# and db_init/009_add_debit_failed_status.sql
STATUS_PENDING = "PENDING"
STATUS_DEBITED = "DEBITED"
STATUS_DEBIT_FAILED = "DEBIT_FAILED"
STATUS_SUCCESS = "SUCCESS"
STATUS_FAILED_REFUNDED = "FAILED_REFUNDED"
STATUS_FAILED_REFUND_ERROR = "FAILED_REFUND_ERROR"

# DEBIT_FAILED is terminal but distinct from the other three: no money moved,
# so there's nothing to reconcile - it just means this exact idempotency key
# will keep returning the same clean error. See _handle_existing in
# collection_orchestrator.py.
TERMINAL_STATUSES = {
    STATUS_DEBIT_FAILED,
    STATUS_SUCCESS,
    STATUS_FAILED_REFUNDED,
    STATUS_FAILED_REFUND_ERROR,
}
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
        provider: str,
        customer_account_number: str,
        customer_name: str,
        amount_rwf: Decimal,
        request_payload: dict[str, Any],
        integrator_id: Optional[int] = None,
    ) -> bool:
        """Returns True if this call created the row, False if the key already exists
        (a concurrent duplicate request lost the race - caller should re-fetch)."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        """
                        INSERT INTO transaction_logs
                            (idempotency_key, fineract_savings_account_id, integrator_id,
                             provider, customer_account_number, customer_name, amount_rwf,
                             status, request_payload)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            idempotency_key,
                            fineract_savings_account_id,
                            integrator_id,
                            provider,
                            customer_account_number,
                            customer_name,
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

    async def mark_debit_failed(self, idempotency_key: str, error_detail: str) -> None:
        """No money moved - a clean, terminal failure (see STATUS_DEBIT_FAILED
        above), not a mid-flight state that blocks retries with this key."""
        await self._update(
            idempotency_key,
            status=STATUS_DEBIT_FAILED,
            error_detail=error_detail,
        )

    async def mark_provider_pending(
        self, idempotency_key: str, operation_reference_id: Optional[str]
    ) -> None:
        """Row stays at DEBITED - this only records DDIN's operationReferenceId
        for tracing until the collection.success/failed webhook resolves it."""
        await self._update(
            idempotency_key,
            provider_operation_reference_id=operation_reference_id,
        )

    async def mark_success(
        self,
        idempotency_key: str,
        provider_transaction_reference: str,
        response_payload: dict[str, Any],
        *,
        integrator_fee_percentage: Optional[Decimal] = None,
        ddin_cost_percentage: Optional[Decimal] = None,
        fee_amount_rwf: Optional[Decimal] = None,
        ddin_cost_amount_rwf: Optional[Decimal] = None,
        margin_amount_rwf: Optional[Decimal] = None,
    ) -> None:
        await self._update(
            idempotency_key,
            status=STATUS_SUCCESS,
            provider_transaction_reference=provider_transaction_reference,
            response_payload=json.dumps(response_payload),
            integrator_fee_percentage=(
                str(integrator_fee_percentage) if integrator_fee_percentage is not None else None
            ),
            ddin_cost_percentage=(
                str(ddin_cost_percentage) if ddin_cost_percentage is not None else None
            ),
            fee_amount_rwf=str(fee_amount_rwf) if fee_amount_rwf is not None else None,
            ddin_cost_amount_rwf=(
                str(ddin_cost_amount_rwf) if ddin_cost_amount_rwf is not None else None
            ),
            margin_amount_rwf=(
                str(margin_amount_rwf) if margin_amount_rwf is not None else None
            ),
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

    async def list_paginated(
        self,
        page: int,
        page_size: int,
        status: Optional[list[str]] = None,
        provider: Optional[list[str]] = None,
    ) -> tuple[list[dict], int]:
        """Newest first. Powers the dashboard's Recent Collections table -
        see app/api/v1/collection.py's GET /transactions."""
        where_clauses = []
        params: list[Any] = []
        if status:
            where_clauses.append(f"status IN ({','.join(['%s'] * len(status))})")
            params.extend(status)
        if provider:
            where_clauses.append(f"provider IN ({','.join(['%s'] * len(provider))})")
            params.extend(provider)
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    f"SELECT COUNT(*) AS total FROM transaction_logs {where_sql}", params
                )
                total = (await cur.fetchone())["total"]

                # t.* keeps every existing column (including the fee/cost/
                # margin ones the admin view needs) while the LEFT JOIN adds
                # the integrator's display name. LEFT, not INNER: integrator_id
                # is nullable, and an INNER join would silently drop those rows
                # from the admin table entirely.
                #
                # Aliased explicitly rather than `SELECT *` across both tables,
                # which would collide on id/name/created_at and let the joined
                # integrator's values overwrite the transaction's own.
                #
                # where_sql's columns (status/provider) need no `t.` prefix:
                # neither exists on `integrators`, so they're unambiguous here
                # and the exact same clause still works for the COUNT above.
                await cur.execute(
                    f"""
                    SELECT t.*, i.name AS integrator_name
                    FROM transaction_logs t
                    LEFT JOIN integrators i ON i.id = t.integrator_id
                    {where_sql}
                    ORDER BY t.id DESC
                    LIMIT %s OFFSET %s
                    """,
                    [*params, page_size, (page - 1) * page_size],
                )
                rows = await cur.fetchall()
        return rows, total

    async def totals_for_filter(
        self,
        status: Optional[list[str]] = None,
        provider: Optional[list[str]] = None,
    ) -> dict:
        """Money totals across EVERY row matching the filter, not just the
        current page -- the admin transactions table shows these as the
        reconciliation figures, and a per-page sum would understate them.

        Only SUCCESS rows are summed: a FAILED_REFUNDED collection is money
        that went back to the customer, so counting its fee/margin would
        overstate revenue. success_count vs counted_rows makes that split
        visible instead of silently dropping rows."""
        where_clauses = []
        params: list[Any] = []
        if status:
            where_clauses.append(f"status IN ({','.join(['%s'] * len(status))})")
            params.extend(status)
        if provider:
            where_clauses.append(f"provider IN ({','.join(['%s'] * len(provider))})")
            params.extend(provider)
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    f"""
                    SELECT
                        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN amount_rwf END), 0)           AS collected_rwf,
                        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN fee_amount_rwf END), 0)       AS fees_rwf,
                        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN ddin_cost_amount_rwf END), 0) AS ddin_cost_rwf,
                        COALESCE(SUM(CASE WHEN status = 'SUCCESS' THEN margin_amount_rwf END), 0)    AS margin_rwf,
                        COALESCE(SUM(status = 'SUCCESS'), 0)                                         AS success_count,
                        COUNT(*)                                                                     AS counted_rows
                    FROM transaction_logs {where_sql}
                    """,
                    params,
                )
                return await cur.fetchone()

    async def list_by_integrator(
        self,
        integrator_id: int,
        page: int,
        page_size: int,
    ) -> tuple[list[dict], int]:
        """Newest first, scoped to one integrator. Powers the portal's
        transaction history view."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT COUNT(*) AS total FROM transaction_logs WHERE integrator_id = %s",
                    (integrator_id,),
                )
                total = (await cur.fetchone())["total"]
                await cur.execute(
                    """
                    SELECT * FROM transaction_logs WHERE integrator_id = %s
                    ORDER BY id DESC
                    LIMIT %s OFFSET %s
                    """,
                    (integrator_id, page_size, (page - 1) * page_size),
                )
                rows = await cur.fetchall()
        return rows, total

    async def provider_stats(self) -> list[dict]:
        """One row per distinct provider ever seen, with today's collection
        count and a success rate. Powers GET /api/v1/providers - there's no
        separate "providers" table; a provider is just a value of
        transaction_logs.provider, so this is computed, not stored.

        resolved_count (the success-rate denominator) deliberately EXCLUDES
        PENDING/DEBITED rows - those haven't concluded yet (DDIN hasn't
        confirmed an outcome, or its webhook hasn't reached us - see
        CollectionOrchestrator.sync_with_provider), so counting them as "not
        successful" would understate a provider's real success rate and can
        misclassify a perfectly healthy provider as DOWN."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT
                        provider,
                        SUM(status NOT IN ('PENDING', 'DEBITED')) AS resolved_count,
                        SUM(status = 'SUCCESS') AS success_count,
                        SUM(created_at >= CURDATE()) AS collections_today
                    FROM transaction_logs
                    GROUP BY provider
                    ORDER BY provider
                    """
                )
                return await cur.fetchall()

    async def daily_volume(self, days: int) -> list[dict]:
        """One row per calendar day (including zero-activity days) for the
        last `days` days, oldest first. Powers GET /api/v1/providers/volume."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT
                        DATE(created_at) AS day,
                        COUNT(*) AS collections,
                        SUM(status IN ('FAILED_REFUNDED', 'FAILED_REFUND_ERROR')) AS failed
                    FROM transaction_logs
                    WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL %s DAY)
                    GROUP BY DATE(created_at)
                    ORDER BY day
                    """,
                    (days - 1,),
                )
                return await cur.fetchall()

    async def list_debited_idempotency_keys(self) -> list[str]:
        """Every row genuinely awaiting the provider's async outcome - polled
        on a timer by the background reconciliation loop (app/main.py) so a
        collection DDIN already resolved gets picked up even if nobody ever
        views or manually syncs it - see
        CollectionOrchestrator.sync_with_provider."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT idempotency_key FROM transaction_logs WHERE status = %s",
                    (STATUS_DEBITED,),
                )
                rows = await cur.fetchall()
                return [row[0] for row in rows]

    async def _update(self, idempotency_key: str, **fields: Any) -> None:
        set_clause = ", ".join(f"{col} = %s" for col in fields)
        params = list(fields.values()) + [idempotency_key]
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    f"UPDATE transaction_logs SET {set_clause} WHERE idempotency_key = %s",
                    params,
                )
