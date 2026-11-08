from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

import aiomysql

TERMINAL_STATUSES = ("SUCCESS", "FAILED", "CANCELLED")


class PaymentRepo:
    def __init__(self, pool: aiomysql.Pool):
        self._pool = pool

    async def create(
        self,
        *,
        reference_id: str,
        integrator_id: Optional[int],
        method: str,
        channel: str,
        amount_rwf: Decimal,
        fee_percentage: Optional[Decimal],
        fee_amount_rwf: Optional[Decimal],
        customer_name: str,
        customer_email: str,
        customer_phone: Optional[str],
        description: str,
        return_url: Optional[str],
        is_test: bool,
    ) -> dict:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    INSERT INTO payments
                        (reference_id, integrator_id, method, channel, amount_rwf,
                         fee_percentage, fee_amount_rwf, customer_name, customer_email,
                         customer_phone, description, return_url, is_test)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        reference_id, integrator_id, method, channel, amount_rwf,
                        fee_percentage, fee_amount_rwf, customer_name, customer_email,
                        customer_phone, description, return_url, int(is_test),
                    ),
                )
                await conn.commit()
        return await self.get_by_reference(reference_id)

    async def get_by_reference(self, reference_id: str) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT p.*, i.name AS integrator_name
                    FROM payments p LEFT JOIN integrators i ON i.id = p.integrator_id
                    WHERE p.reference_id = %s
                    """,
                    (reference_id,),
                )
                return await cur.fetchone()

    async def update_gateway_state(
        self,
        reference_id: str,
        *,
        status: str,
        status_message: Optional[str] = None,
        gateway_transaction_id: Optional[str] = None,
        redirect_url: Optional[str] = None,
    ) -> bool:
        """Applies the gateway's view. Never moves a payment OUT of a terminal
        status (a late/duplicate callback can't flip SUCCESS back to PENDING).
        Returns True if the status actually changed."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE payments SET
                        status = %s,
                        status_message = COALESCE(%s, status_message),
                        gateway_transaction_id = COALESCE(NULLIF(%s, ''), gateway_transaction_id),
                        redirect_url = COALESCE(%s, redirect_url),
                        completed_at = IF(%s IN ('SUCCESS','FAILED','CANCELLED'), CURRENT_TIMESTAMP(3), completed_at)
                    WHERE reference_id = %s
                      AND status NOT IN ('SUCCESS','FAILED','CANCELLED')
                      AND status <> %s
                    """,
                    (
                        status, (status_message or None) and status_message[:255],
                        gateway_transaction_id, redirect_url, status, reference_id, status,
                    ),
                )
                changed = cur.rowcount > 0
                if not changed and (gateway_transaction_id or redirect_url or status_message):
                    # Same status - still record new details (e.g. redirect_url).
                    await cur.execute(
                        """
                        UPDATE payments SET
                            status_message = COALESCE(%s, status_message),
                            gateway_transaction_id = COALESCE(NULLIF(%s, ''), gateway_transaction_id),
                            redirect_url = COALESCE(%s, redirect_url)
                        WHERE reference_id = %s
                        """,
                        ((status_message or None) and status_message[:255], gateway_transaction_id,
                         redirect_url, reference_id),
                    )
                await conn.commit()
        return changed

    async def list_paginated(
        self,
        page: int,
        page_size: int,
        *,
        integrator_id: Optional[int] = None,
        status: Optional[str] = None,
        method: Optional[str] = None,
    ) -> tuple[list[dict], int]:
        where, args = [], []
        if integrator_id is not None:
            where.append("p.integrator_id = %s")
            args.append(integrator_id)
        if status:
            where.append("p.status = %s")
            args.append(status)
        if method:
            where.append("p.method = %s")
            args.append(method)
        clause = ("WHERE " + " AND ".join(where)) if where else ""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(f"SELECT COUNT(*) AS n FROM payments p {clause}", args)
                total = (await cur.fetchone())["n"]
                await cur.execute(
                    f"""
                    SELECT p.*, i.name AS integrator_name
                    FROM payments p LEFT JOIN integrators i ON i.id = p.integrator_id
                    {clause}
                    ORDER BY p.created_at DESC, p.id DESC
                    LIMIT %s OFFSET %s
                    """,
                    [*args, page_size, (page - 1) * page_size],
                )
                rows = await cur.fetchall()
        return list(rows), int(total)

    async def summary(self, integrator_id: Optional[int] = None) -> dict:
        clause, args = ("WHERE integrator_id = %s", [integrator_id]) if integrator_id is not None else ("", [])
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    f"""
                    SELECT
                      COALESCE(SUM(CASE WHEN status='SUCCESS' THEN amount_rwf END), 0) AS collected_rwf,
                      COALESCE(SUM(CASE WHEN status='SUCCESS' THEN fee_amount_rwf END), 0) AS fees_rwf,
                      COALESCE(SUM(CASE WHEN status='SUCCESS' AND method='MOMO' THEN amount_rwf END), 0) AS momo_rwf,
                      COALESCE(SUM(CASE WHEN status='SUCCESS' AND method='CARD' THEN amount_rwf END), 0) AS card_rwf,
                      SUM(status='SUCCESS') AS success_count,
                      SUM(status='PENDING') AS pending_count,
                      SUM(status IN ('FAILED','CANCELLED')) AS failed_count,
                      COUNT(*) AS total_count
                    FROM payments {clause}
                    """,
                    args,
                )
                return await cur.fetchone()

    async def list_pending_references(self, max_age_hours: int) -> list[str]:
        since = datetime.now() - timedelta(hours=max_age_hours)
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT reference_id FROM payments WHERE status = 'PENDING' AND created_at >= %s "
                    "ORDER BY created_at DESC LIMIT 200",
                    (since,),
                )
                return [row[0] for row in await cur.fetchall()]
