"""The LMBTech ledger: collections and disbursements in one `payments` table
(see db_init/012-014). All money columns are frozen at creation time."""
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

import aiomysql

from app.services import origin

if TYPE_CHECKING:  # avoid an import cycle with the service module
    from app.services.payment_service import PaymentMoney

TERMINAL_STATUSES = ("SUCCESS", "FAILED", "CANCELLED")


def _where(
    *,
    integrator_id: Optional[int] = None,
    direction: Optional[str] = None,
    status: Optional[str] = None,
    method: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    cashout: Optional[bool] = None,
    is_test: Optional[bool] = None,
) -> tuple[str, list]:
    clauses, args = [], []
    if is_test is not None:  # test and real money are separate ledgers
        clauses.append("p.is_test = %s")
        args.append(int(is_test))
    if date_from is not None:
        clauses.append("p.created_at >= %s")
        args.append(datetime.combine(date_from, datetime.min.time()))
    if date_to is not None:  # inclusive: the whole end day
        clauses.append("p.created_at < %s")
        args.append(datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    if cashout is not None:
        clauses.append("p.is_cashout = %s")
        args.append(int(cashout))
    if integrator_id is not None:
        clauses.append("p.integrator_id = %s")
        args.append(integrator_id)
    if direction:
        clauses.append("p.direction = %s")
        args.append(direction)
    if status:
        clauses.append("p.status = %s")
        args.append(status)
    if method:
        clauses.append("p.method = %s")
        args.append(method)
    if q:
        like = f"%{q.strip()}%"
        clauses.append(
            "(p.reference_id LIKE %s OR p.customer_name LIKE %s OR p.customer_phone LIKE %s "
            "OR p.customer_email LIKE %s OR p.gateway_transaction_id LIKE %s)"
        )
        args.extend([like] * 5)
    return ("WHERE " + " AND ".join(clauses)) if clauses else "", args


class PaymentRepo:
    def __init__(self, pool: aiomysql.Pool):
        self._pool = pool

    async def create(
        self,
        *,
        reference_id: str,
        direction: str,
        integrator_id: Optional[int],
        method: str,
        channel: str,
        amount_rwf: Decimal,
        money: "PaymentMoney",
        customer_name: str,
        customer_email: str,
        customer_phone: Optional[str],
        description: str,
        return_url: Optional[str],
        is_test: bool,
        imported: bool = False,
        is_cashout: bool = False,
        gateway: str = "LMBTECH",
        gateway_external_id: Optional[str] = None,
    ) -> dict:
        # Who/how/where, set by the API route for this request (see app/services/origin.py).
        o = origin.current()
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    INSERT INTO payments
                        (reference_id, gateway, gateway_external_id, direction, is_cashout, integrator_id, method, channel, amount_rwf,
                         fee_percentage, fee_amount_rwf, gateway_cost_percentage,
                         gateway_cost_amount_rwf, margin_amount_rwf, customer_name,
                         customer_email, customer_phone, description, return_url, is_test, imported,
                         source, actor, client_ip)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        reference_id, gateway, gateway_external_id, direction, int(is_cashout), integrator_id, method, channel, amount_rwf,
                        money.fee_percentage, money.fee_amount_rwf, money.gateway_cost_percentage,
                        money.gateway_cost_amount_rwf, money.margin_amount_rwf, customer_name,
                        customer_email, customer_phone, description, return_url, int(is_test), int(imported),
                        o.get("source") or (origin.IMPORT if imported else None), o.get("actor"), o.get("client_ip"),
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

    async def get_by_external_id(self, gateway: str, external_id: str) -> Optional[dict]:
        """A payment by the id a gateway knows it by (Kitovu's externalId)."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT reference_id FROM payments WHERE gateway = %s AND gateway_external_id = %s",
                    (gateway, external_id),
                )
                row = await cur.fetchone()
        return await self.get_by_reference(row["reference_id"]) if row else None

    async def external_id_taken(self, gateway: str, external_id: str) -> bool:
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT 1 FROM payments WHERE gateway = %s AND gateway_external_id = %s", (gateway, external_id)
                )
                return await cur.fetchone() is not None

    async def set_pending_details(self, reference_id: str, *, status_message: str, redirect_url: Optional[str]) -> None:
        """Message + card page for a row that's still PENDING (sandbox rows,
        which never get a gateway response to carry them)."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "UPDATE payments SET status_message = %s, redirect_url = COALESCE(%s, redirect_url) "
                    "WHERE reference_id = %s AND status = 'PENDING'",
                    (status_message[:255], redirect_url, reference_id),
                )
                await conn.commit()

    async def update_gateway_state(
        self,
        reference_id: str,
        *,
        status: str,
        status_message: Optional[str] = None,
        gateway_transaction_id: Optional[str] = None,
        redirect_url: Optional[str] = None,
        gateway_amount: Optional[Decimal] = None,
    ) -> bool:
        """Applies the gateway's view. Never moves a row OUT of a terminal
        status (a late/duplicate callback can't flip SUCCESS back to PENDING)
        - only reconcile_state() may correct a finished row. Returns True if
        the status actually changed."""
        message = (status_message or None) and status_message[:255]
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE payments SET
                        status = %s,
                        status_message = COALESCE(%s, status_message),
                        gateway_transaction_id = COALESCE(NULLIF(%s, ''), gateway_transaction_id),
                        redirect_url = COALESCE(%s, redirect_url),
                        gateway_amount_rwf = COALESCE(%s, gateway_amount_rwf),
                        completed_at = IF(%s IN ('SUCCESS','FAILED','CANCELLED'), CURRENT_TIMESTAMP(3), completed_at)
                    WHERE reference_id = %s
                      AND status NOT IN ('SUCCESS','FAILED','CANCELLED')
                      AND status <> %s
                    """,
                    (status, message, gateway_transaction_id, redirect_url, gateway_amount, status, reference_id, status),
                )
                changed = cur.rowcount > 0
                if not changed and (gateway_transaction_id or redirect_url or message or gateway_amount is not None):
                    # Same status - still record new details (e.g. redirect_url, LMBTech's amount).
                    await cur.execute(
                        """
                        UPDATE payments SET
                            status_message = IF(status IN ('SUCCESS','FAILED','CANCELLED'), status_message, COALESCE(%s, status_message)),
                            gateway_transaction_id = COALESCE(NULLIF(%s, ''), gateway_transaction_id),
                            redirect_url = COALESCE(%s, redirect_url),
                            gateway_amount_rwf = COALESCE(%s, gateway_amount_rwf)
                        WHERE reference_id = %s
                        """,
                        (message, gateway_transaction_id, redirect_url, gateway_amount, reference_id),
                    )
                await conn.commit()
        return changed

    async def reconcile_state(
        self,
        reference_id: str,
        *,
        status: str,
        status_message: Optional[str],
        gateway_transaction_id: Optional[str],
        gateway_amount: Optional[Decimal],
    ) -> Optional[str]:
        """Make our row agree with LMBTech, INCLUDING correcting a finished row
        (e.g. we recorded FAILED but LMBTech says the money arrived). Only
        ever called with the gateway's own authenticated status. Returns the
        previous status if it changed, else None."""
        message = (status_message or None) and status_message[:255]
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT status FROM payments WHERE reference_id = %s FOR UPDATE", (reference_id,))
                row = await cur.fetchone()
                if row is None:
                    await conn.commit()
                    return None
                previous = row[0]
                if previous != status:
                    await cur.execute(
                        """
                        UPDATE payments SET
                            status = %s,
                            status_message = %s,
                            gateway_transaction_id = COALESCE(NULLIF(%s, ''), gateway_transaction_id),
                            gateway_amount_rwf = COALESCE(%s, gateway_amount_rwf),
                            completed_at = IF(%s IN ('SUCCESS','FAILED','CANCELLED'), COALESCE(completed_at, CURRENT_TIMESTAMP(3)), NULL),
                            reconciled_at = CURRENT_TIMESTAMP(3),
                            corrected_from = IF(imported = 1 AND %s = 'PENDING', corrected_from, %s)
                        WHERE reference_id = %s
                        """,
                        (status, message or f"Corrected from {previous} after checking LMBTech", gateway_transaction_id,
                         gateway_amount, status, previous, previous, reference_id),
                    )
                else:
                    await cur.execute(
                        """
                        UPDATE payments SET
                            gateway_transaction_id = COALESCE(NULLIF(%s, ''), gateway_transaction_id),
                            gateway_amount_rwf = COALESCE(%s, gateway_amount_rwf),
                            reconciled_at = IF(status IN ('SUCCESS','FAILED','CANCELLED'), CURRENT_TIMESTAMP(3), reconciled_at)
                        WHERE reference_id = %s
                        """,
                        (gateway_transaction_id, gateway_amount, reference_id),
                    )
                await conn.commit()
        return previous if previous != status else None

    async def list_references_since(self, days: int, limit: int = 1000, gateway: Optional[str] = None) -> list[str]:
        since = datetime.now() - timedelta(days=days)
        extra = " AND gateway = %s" if gateway else ""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    f"SELECT reference_id FROM payments WHERE created_at >= %s{extra} ORDER BY created_at DESC LIMIT %s",
                    (since, gateway, limit) if gateway else (since, limit),
                )
                return [row[0] for row in await cur.fetchall()]

    async def list_recent_failed_references(self, hours: int) -> list[str]:
        """FAILED rows from the last few hours - a local error (timeout,
        unreadable reply) can mark a row FAILED while LMBTech actually took
        the money, so these get re-checked by the background loop."""
        since = datetime.now() - timedelta(hours=hours)
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT reference_id FROM payments WHERE status = 'FAILED' AND gateway = 'LMBTECH' "
                    "AND created_at >= %s AND reconciled_at IS NULL ORDER BY created_at DESC LIMIT 100",
                    (since,),
                )
                return [row[0] for row in await cur.fetchall()]

    async def list_paginated(
        self,
        page: int,
        page_size: int,
        *,
        integrator_id: Optional[int] = None,
        direction: Optional[str] = None,
        status: Optional[str] = None,
        method: Optional[str] = None,
        q: Optional[str] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        cashout: Optional[bool] = None,
        is_test: Optional[bool] = None,
    ) -> tuple[list[dict], int]:
        clause, args = _where(
            integrator_id=integrator_id, direction=direction, status=status, method=method, q=q,
            date_from=date_from, date_to=date_to, cashout=cashout, is_test=is_test,
        )
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

    async def summary(self, integrator_id: Optional[int] = None, direction: Optional[str] = None, *, is_test: Optional[bool] = None) -> dict:
        """Totals for one integrator (or everyone). Money sums count SUCCESS
        only; the counts follow `direction` if given."""
        clause, args = _where(integrator_id=integrator_id, is_test=is_test)
        dir_filter = "AND p.direction = %s" if direction else ""
        count_args = [direction] * 4 if direction else []
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    f"""
                    SELECT
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' AND p.direction='COLLECTION' THEN p.amount_rwf END), 0) AS collected_rwf,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' AND p.direction='DISBURSEMENT' THEN p.amount_rwf END), 0) AS disbursed_rwf,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' AND p.direction='COLLECTION' AND p.method='MOMO' THEN p.amount_rwf END), 0) AS momo_rwf,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' AND p.direction='COLLECTION' AND p.method='CARD' THEN p.amount_rwf END), 0) AS card_rwf,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN p.fee_amount_rwf END), 0) AS fees_rwf,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN p.gateway_cost_amount_rwf END), 0) AS gateway_cost_rwf,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN p.margin_amount_rwf END), 0) AS margin_rwf,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' {dir_filter} THEN 1 END), 0) AS success_count,
                      COALESCE(SUM(CASE WHEN p.status='PENDING' {dir_filter} THEN 1 END), 0) AS pending_count,
                      COALESCE(SUM(CASE WHEN p.status IN ('FAILED','CANCELLED') {dir_filter} THEN 1 END), 0) AS failed_count,
                      COALESCE(SUM(CASE WHEN 1=1 {dir_filter} THEN 1 END), 0) AS total_count
                    FROM payments p {clause}
                    """,
                    [*count_args, *args],
                )
                return await cur.fetchone()

    async def integrator_balance(self, integrator_id: int, *, is_test: bool = False) -> Decimal:
        """What the integrator can still pay out: successful collections minus
        their fees, minus every payout that isn't failed (pending ones too,
        so in-flight payouts can't be spent twice) plus its fee.

        Test and real money are separate ledgers: a live payout can only spend
        money from real (is_test=0) collections, so simulated sandbox/test
        payments can never be cashed out as real MoMo money."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    SELECT
                      COALESCE(SUM(CASE WHEN direction='COLLECTION' AND status='SUCCESS'
                                        THEN amount_rwf - COALESCE(fee_amount_rwf, 0) END), 0)
                    - COALESCE(SUM(CASE WHEN direction='DISBURSEMENT' AND status IN ('SUCCESS','PENDING')
                                        THEN amount_rwf + COALESCE(fee_amount_rwf, 0) END), 0)
                    FROM payments WHERE integrator_id = %s AND is_test = %s
                    """,
                    (integrator_id, int(is_test)),
                )
                (value,) = await cur.fetchone()
        return Decimal(value or 0).quantize(Decimal("0.01"))

    async def overview(self, days: int, integrator_id: Optional[int] = None, *, is_test: Optional[bool] = None) -> dict:
        """Dashboard data: per-day series (last `days` days, gaps filled with
        zeros), today's totals, and the collection channel split."""
        since = date.today() - timedelta(days=days - 1)
        clause, args = _where(integrator_id=integrator_id, is_test=is_test)
        extra = (" AND " + clause[len("WHERE "):]) if clause else ""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    f"""
                    SELECT DATE(p.created_at) AS d,
                      COALESCE(SUM(CASE WHEN p.direction='COLLECTION' AND p.status='SUCCESS' THEN p.amount_rwf END), 0) AS collected,
                      COALESCE(SUM(CASE WHEN p.direction='DISBURSEMENT' AND p.status='SUCCESS' THEN p.amount_rwf END), 0) AS disbursed,
                      COALESCE(SUM(CASE WHEN p.status IN ('FAILED','CANCELLED') THEN 1 END), 0) AS failed
                    FROM payments p
                    WHERE p.created_at >= %s{extra}
                    GROUP BY DATE(p.created_at)
                    """,
                    [since, *args],
                )
                by_day = {row["d"]: row for row in await cur.fetchall()}

                await cur.execute(
                    f"""
                    SELECT p.channel, COALESCE(SUM(p.amount_rwf), 0) AS amount, COUNT(*) AS n
                    FROM payments p
                    WHERE p.direction='COLLECTION' AND p.status='SUCCESS' AND p.created_at >= %s{extra}
                    GROUP BY p.channel
                    """,
                    [since, *args],
                )
                channels = list(await cur.fetchall())

                today_start = datetime.combine(date.today(), datetime.min.time())
                await cur.execute(
                    f"""
                    SELECT
                      COALESCE(SUM(CASE WHEN p.direction='COLLECTION' AND p.status='SUCCESS' THEN p.amount_rwf END), 0) AS collected,
                      COALESCE(SUM(CASE WHEN p.direction='DISBURSEMENT' AND p.status='SUCCESS' THEN p.amount_rwf END), 0) AS disbursed,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN p.margin_amount_rwf END), 0) AS margin,
                      COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN 1 END), 0) AS success,
                      COALESCE(SUM(CASE WHEN p.status IN ('FAILED','CANCELLED') THEN 1 END), 0) AS failed,
                      COALESCE(SUM(CASE WHEN p.status='PENDING' THEN 1 END), 0) AS pending
                    FROM payments p
                    WHERE p.created_at >= %s{extra}
                    """,
                    [today_start, *args],
                )
                today = await cur.fetchone()

        series = []
        for i in range(days):
            d = since + timedelta(days=i)
            row = by_day.get(d, {})
            series.append(
                {
                    "date": d.isoformat(),
                    "collected": float(row.get("collected", 0) or 0),
                    "disbursed": float(row.get("disbursed", 0) or 0),
                    "failed": int(row.get("failed", 0) or 0),
                }
            )
        return {"series": series, "channels": channels, "today": today}

    async def integrators_below_cost(self, pricing) -> list[dict]:
        """Integrators whose effective collection OR payout fee is under
        LMBTech's cost - each of those transactions would lose money."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT id, name FROM integrators
                    WHERE COALESCE(payment_fee_percentage, %s) < %s
                       OR COALESCE(payout_fee_percentage, %s) < %s
                    ORDER BY name
                    """,
                    (
                        pricing.default_fee_percentage, pricing.collection_cost_floor,
                        pricing.payout_default_fee_percentage, pricing.payout_cost_percentage,
                    ),
                )
                return list(await cur.fetchall())

    async def list_pending_references(self, max_age_hours: int) -> list[str]:
        """Pending rows to poll: LMBTech ones (asks the gateway) and sandbox
        ones (resolved by Soila Pay's simulator). Live bank cash-outs are
        excluded - they're settled by an admin, LMBTech never sees them."""
        since = datetime.now() - timedelta(hours=max_age_hours)
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT reference_id FROM payments WHERE status = 'PENDING' AND gateway IN ('LMBTECH', 'SANDBOX', 'KITOVU') "
                    "AND created_at >= %s ORDER BY created_at DESC LIMIT 200",
                    (since,),
                )
                return [row[0] for row in await cur.fetchall()]

    async def sandbox_successes(self, integrator_id: int) -> dict:
        """Successful sandbox collections by method - the go-live checklist's
        proof that the integration really works end to end."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT method, COUNT(*) FROM payments WHERE integrator_id = %s AND gateway = 'SANDBOX' "
                    "AND direction = 'COLLECTION' AND status = 'SUCCESS' GROUP BY method",
                    (integrator_id,),
                )
                counts = {m: int(n) for m, n in await cur.fetchall()}
        return {"CARD": counts.get("CARD", 0), "MOMO": counts.get("MOMO", 0)}

    async def range_totals(
        self, integrator_id: Optional[int], date_from: Optional[date], date_to: Optional[date], *, is_test: Optional[bool] = None
    ) -> dict:
        """LMBTech-style period totals. Net = successful collections minus
        their fees. Withdrawn = payouts/cash-outs that aren't failed (pending
        ones reserve money) plus their fees."""
        clause, args = _where(integrator_id=integrator_id, date_from=date_from, date_to=date_to, is_test=is_test)
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    f"""
                    SELECT
                      COALESCE(SUM(CASE WHEN p.direction='COLLECTION' AND p.status='SUCCESS'
                                        THEN p.amount_rwf - COALESCE(p.fee_amount_rwf, 0) END), 0) AS net_rwf,
                      COALESCE(SUM(CASE WHEN p.direction='COLLECTION' AND p.status='SUCCESS' THEN p.amount_rwf END), 0) AS gross_rwf,
                      COALESCE(SUM(CASE WHEN p.direction='DISBURSEMENT' AND p.status IN ('SUCCESS','PENDING')
                                        THEN p.amount_rwf + COALESCE(p.fee_amount_rwf, 0) END), 0) AS withdrawn_rwf,
                      COALESCE(SUM(CASE WHEN p.direction='DISBURSEMENT' AND p.method='BANK' AND p.status='PENDING'
                                        THEN p.amount_rwf END), 0) AS pending_bank_rwf,
                      COUNT(*) AS n
                    FROM payments p {clause}
                    """,
                    args,
                )
                return await cur.fetchone()

    async def settle_bank_cashout(
        self, reference_id: str, *, paid: bool, message: str, bank_reference: Optional[str] = None
    ) -> Optional[str]:
        """Admin decision on a PENDING bank cash-out. Returns the new status,
        or None if the row isn't a pending bank cash-out."""
        status = "SUCCESS" if paid else "FAILED"
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE payments SET
                        status = %s,
                        status_message = %s,
                        gateway_transaction_id = COALESCE(%s, gateway_transaction_id),
                        completed_at = CURRENT_TIMESTAMP(3)
                    WHERE reference_id = %s AND method = 'BANK' AND status = 'PENDING'
                    """,
                    (status, message[:255], (bank_reference or None) and bank_reference[:128], reference_id),
                )
                changed = cur.rowcount > 0
                await conn.commit()
        return status if changed else None


# -- Admin reconciliation ------------------------------------------------------

# One set of money columns, reused for every breakdown. Money columns count
# SUCCESS only (what really moved); pending/failed are counted separately.
_RECON_COLUMNS = """
  COUNT(*) AS total_count,
  COALESCE(SUM(p.direction='COLLECTION' AND p.status='SUCCESS'), 0) AS in_count,
  COALESCE(SUM(CASE WHEN p.direction='COLLECTION' AND p.status='SUCCESS' THEN p.amount_rwf END), 0) AS in_amount,
  COALESCE(SUM(p.direction='DISBURSEMENT' AND p.is_cashout=0 AND p.status='SUCCESS'), 0) AS out_count,
  COALESCE(SUM(CASE WHEN p.direction='DISBURSEMENT' AND p.is_cashout=0 AND p.status='SUCCESS' THEN p.amount_rwf END), 0) AS out_amount,
  COALESCE(SUM(p.direction='DISBURSEMENT' AND p.is_cashout=1 AND p.status='SUCCESS'), 0) AS cashout_count,
  COALESCE(SUM(CASE WHEN p.direction='DISBURSEMENT' AND p.is_cashout=1 AND p.status='SUCCESS' THEN p.amount_rwf END), 0) AS cashout_amount,
  COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN p.fee_amount_rwf END), 0) AS fees,
  COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN p.gateway_cost_amount_rwf END), 0) AS gateway_cost,
  COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN p.margin_amount_rwf END), 0) AS margin,
  COALESCE(SUM(p.status='PENDING'), 0) AS pending_count,
  COALESCE(SUM(CASE WHEN p.status='PENDING' THEN p.amount_rwf END), 0) AS pending_amount,
  COALESCE(SUM(p.status IN ('FAILED','CANCELLED')), 0) AS failed_count,
  COALESCE(SUM(CASE WHEN p.status IN ('FAILED','CANCELLED') THEN p.amount_rwf END), 0) AS failed_amount
"""

_BREAKDOWNS = {
    # key -> (SELECT label columns, GROUP BY, ORDER BY)
    "by_gateway": ("p.gateway AS gateway", "p.gateway", "in_amount + out_amount + cashout_amount DESC"),
    "by_channel": ("p.direction AS direction, p.method AS method, p.channel AS channel",
                   "p.direction, p.method, p.channel", "in_amount + out_amount + cashout_amount DESC"),
    "by_route": ("p.gateway AS gateway, p.direction AS direction, p.channel AS channel",
                 "p.gateway, p.direction, p.channel", "in_amount + out_amount + cashout_amount DESC"),
    "by_source": ("COALESCE(p.source, 'UNKNOWN') AS source", "COALESCE(p.source, 'UNKNOWN')", "total_count DESC"),
    "by_integrator": ("p.integrator_id AS integrator_id, COALESCE(i.name, 'Soila Pay console') AS integrator_name",
                      "p.integrator_id, i.name", "in_amount DESC"),
    "by_day": ("DATE(p.created_at) AS day", "DATE(p.created_at)", "day DESC"),
}


async def _rows(cur, sql: str, args) -> list[dict]:
    await cur.execute(sql, args)
    return list(await cur.fetchall())


async def reconciliation(pool, *, date_from: Optional[date], date_to: Optional[date], is_test: bool) -> dict:
    """Every way to slice the money for one ledger (live or test) and period:
    totals, per gateway, per method, per gateway+method, per source, per
    integrator (with what each is owed right now, all time), per day, and the
    transactions that need a look."""
    where, args = _where(date_from=date_from, date_to=date_to, is_test=is_test)
    base = f"FROM payments p LEFT JOIN integrators i ON i.id = p.integrator_id {where}"
    out: dict = {}
    async with pool.acquire() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            out["totals"] = (await _rows(cur, f"SELECT {_RECON_COLUMNS} {base}", args))[0]
            for key, (labels, group, order) in _BREAKDOWNS.items():
                out[key] = await _rows(cur, f"SELECT {labels}, {_RECON_COLUMNS} {base} GROUP BY {group} ORDER BY {order}", args)

            # What each integrator can still withdraw NOW (all time, this ledger) -
            # the same formula as integrator_balance - and what is reserved by
            # pending payouts / bank cash-outs.
            out["balances"] = await _rows(cur, """
                SELECT i.id AS integrator_id, i.name AS integrator_name, i.account_mode,
                  COALESCE(SUM(CASE WHEN p.direction='COLLECTION' AND p.status='SUCCESS'
                                    THEN p.amount_rwf - COALESCE(p.fee_amount_rwf, 0) END), 0) AS earned_net,
                  COALESCE(SUM(CASE WHEN p.direction='DISBURSEMENT' AND p.status='SUCCESS'
                                    THEN p.amount_rwf + COALESCE(p.fee_amount_rwf, 0) END), 0) AS spent,
                  COALESCE(SUM(CASE WHEN p.direction='DISBURSEMENT' AND p.status='PENDING'
                                    THEN p.amount_rwf + COALESCE(p.fee_amount_rwf, 0) END), 0) AS reserved,
                  MAX(p.created_at) AS last_activity
                FROM integrators i
                LEFT JOIN payments p ON p.integrator_id = i.id AND p.is_test = %s
                GROUP BY i.id, i.name, i.account_mode
                HAVING earned_net > 0 OR spent > 0 OR reserved > 0
                ORDER BY earned_net - spent - reserved DESC
                """, (int(is_test),))

            # Needs a look: stuck, corrected by a gateway check, added by hand,
            # or sold below cost.
            out["attention"] = await _rows(cur, f"""
                SELECT p.reference_id, p.created_at, p.direction, p.is_cashout, p.status, p.status_message,
                       p.gateway, p.channel, p.amount_rwf, p.margin_amount_rwf, p.corrected_from, p.imported,
                       COALESCE(i.name, 'Soila Pay console') AS integrator_name, COALESCE(p.source, 'UNKNOWN') AS source,
                       CASE
                         WHEN p.status = 'PENDING' AND p.created_at < NOW() - INTERVAL 30 MINUTE THEN 'STUCK'
                         WHEN p.corrected_from IS NOT NULL THEN 'CORRECTED'
                         WHEN p.imported = 1 THEN 'IMPORTED'
                         ELSE 'BELOW_COST'
                       END AS reason
                {base} {"AND" if where else "WHERE"} (
                   (p.status = 'PENDING' AND p.created_at < NOW() - INTERVAL 30 MINUTE)
                   OR p.corrected_from IS NOT NULL
                   OR p.imported = 1
                   OR (p.status = 'SUCCESS' AND p.margin_amount_rwf < 0))
                ORDER BY p.created_at DESC LIMIT 200
                """, args)
    return out
