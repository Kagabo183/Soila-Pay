import secrets
from decimal import Decimal
from typing import Any, Optional

import aiomysql

DEFAULT_INTEGRATOR_FEE_PERCENTAGE = Decimal("2.20")


class IntegratorRepo:
    def __init__(self, pool: aiomysql.Pool):
        self._pool = pool

    async def list_integrators(self) -> list[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT * FROM integrators ORDER BY created_at DESC")
                return await cur.fetchall()

    async def get_by_id(self, integrator_id: int) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute("SELECT * FROM integrators WHERE id = %s", (integrator_id,))
                return await cur.fetchone()

    async def get_by_phone_number(self, phone_number: str) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT * FROM integrators WHERE phone_number = %s", (phone_number,)
                )
                return await cur.fetchone()

    async def get_by_api_key(self, api_key: str) -> Optional[dict]:
        """Matches either sandbox_api_key or production_api_key. The returned
        dict carries a synthetic `key_mode` ("sandbox"|"production") so the
        caller (see app/api/v1/collection.py) can route the request to the
        matching environment - sandbox keys run against the safe dummy
        provider UNLESS this integrator's sandbox_uses_real_provider is set
        (a per-row DB flag, not a hardcoded check - see
        008_integrator_sandbox_real_provider.sql)."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    "SELECT * FROM integrators WHERE sandbox_api_key = %s", (api_key,)
                )
                row = await cur.fetchone()
                if row:
                    row["key_mode"] = "sandbox"
                    return row

                await cur.execute(
                    "SELECT * FROM integrators WHERE production_api_key = %s", (api_key,)
                )
                row = await cur.fetchone()
                if row:
                    row["key_mode"] = "production"
                    return row
                return None

    async def create(
        self,
        name: str,
        fee_percentage: Decimal = DEFAULT_INTEGRATOR_FEE_PERCENTAGE,
        *,
        phone_number: Optional[str] = None,
        password_hash: Optional[str] = None,
    ) -> dict:
        """Admin-created integrator. phone_number/password_hash are optional -
        set both together to also hand the integrator working self-service
        portal login credentials (app/api/v1/integrator_portal.py) instead of
        making them sign up themselves."""
        sandbox_api_key = _generate_api_key()
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO integrators
                        (name, phone_number, password_hash, sandbox_api_key, fee_percentage)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (name, phone_number, password_hash, sandbox_api_key, str(fee_percentage)),
                )
                new_id = cur.lastrowid
        return await self.get_by_id(new_id)

    async def create_self_signup(
        self,
        name: str,
        phone_number: str,
        password_hash: str,
        fee_percentage: Decimal = DEFAULT_INTEGRATOR_FEE_PERCENTAGE,
    ) -> dict:
        """Integrator self-registration: just enough to start testing in
        sandbox immediately (mirrors how DDIN itself onboarded us). Production
        access requires a separate KYC submission - see submit_production_kyc."""
        return await self.create(
            name, fee_percentage, phone_number=phone_number, password_hash=password_hash
        )

    async def update(
        self,
        integrator_id: int,
        *,
        name: Optional[str] = None,
        fee_percentage: Optional[Decimal] = None,
        is_active: Optional[bool] = None,
        sandbox_uses_real_provider: Optional[bool] = None,
    ) -> Optional[dict]:
        fields: dict[str, Any] = {}
        if name is not None:
            fields["name"] = name
        if fee_percentage is not None:
            fields["fee_percentage"] = str(fee_percentage)
        if is_active is not None:
            fields["is_active"] = int(is_active)
        if sandbox_uses_real_provider is not None:
            fields["sandbox_uses_real_provider"] = int(sandbox_uses_real_provider)

        if fields:
            set_clause = ", ".join(f"{col} = %s" for col in fields)
            params = list(fields.values()) + [integrator_id]
            async with self._pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        f"UPDATE integrators SET {set_clause} WHERE id = %s", params
                    )
        return await self.get_by_id(integrator_id)

    # -- Production KYC / onboarding -------------------------------------------

    async def submit_production_kyc(
        self,
        integrator_id: int,
        *,
        business_location: str,
        tax_clearance_file_name: str,
        rdb_certificate_file_name: str,
        ip_whitelist: Optional[str] = None,
    ) -> Optional[dict]:
        """tax_clearance_file_name / rdb_certificate_file_name are the
        filenames of the already-uploaded documents (integrator_documents) -
        stored here purely for display without a join; the actual bytes live
        in integrator_documents, fetched separately."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE integrators
                    SET business_location = %s,
                        tax_clearance_reference = %s,
                        rdb_certificate_reference = %s,
                        ip_whitelist = %s,
                        production_status = 'PENDING_REVIEW',
                        production_rejection_reason = NULL
                    WHERE id = %s
                    """,
                    (
                        business_location,
                        tax_clearance_file_name,
                        rdb_certificate_file_name,
                        ip_whitelist,
                        integrator_id,
                    ),
                )
        return await self.get_by_id(integrator_id)

    async def approve_production(self, integrator_id: int) -> Optional[dict]:
        production_api_key = _generate_api_key()
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE integrators
                    SET production_status = 'APPROVED',
                        production_api_key = %s,
                        production_rejection_reason = NULL
                    WHERE id = %s
                    """,
                    (production_api_key, integrator_id),
                )
        return await self.get_by_id(integrator_id)

    async def reject_production(self, integrator_id: int, reason: str) -> Optional[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    UPDATE integrators
                    SET production_status = 'REJECTED',
                        production_rejection_reason = %s
                    WHERE id = %s
                    """,
                    (reason, integrator_id),
                )
        return await self.get_by_id(integrator_id)

    # -- Platform-wide settings (e.g. DDIN's cost %) --------------------------

    async def get_setting(self, key: str) -> Optional[str]:
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT setting_value FROM platform_settings WHERE setting_key = %s",
                    (key,),
                )
                row = await cur.fetchone()
                return row[0] if row else None

    async def set_setting(self, key: str, value: str) -> None:
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO platform_settings (setting_key, setting_value)
                    VALUES (%s, %s)
                    ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
                    """,
                    (key, value),
                )

    # -- Revenue reporting -----------------------------------------------------

    async def revenue_summary(self) -> list[dict]:
        """Per-integrator totals: what we collected, what we charged, what DDIN
        cost us, and the resulting margin - the "where does my 0.3% come from"
        view. Uses the fee/cost/margin snapshotted on each SUCCESS row, not the
        integrator's *current* fee_percentage, so past rate changes don't
        retroactively distort historical totals."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT
                        i.id AS integrator_id,
                        i.name AS integrator_name,
                        i.fee_percentage AS current_fee_percentage,
                        COUNT(t.id) AS successful_transactions,
                        COALESCE(SUM(t.amount_rwf), 0) AS total_collected_rwf,
                        COALESCE(SUM(t.fee_amount_rwf), 0) AS total_fee_charged_rwf,
                        COALESCE(SUM(t.ddin_cost_amount_rwf), 0) AS total_ddin_cost_rwf,
                        COALESCE(SUM(t.margin_amount_rwf), 0) AS total_margin_rwf
                    FROM integrators i
                    LEFT JOIN transaction_logs t
                        ON t.integrator_id = i.id AND t.status = 'SUCCESS'
                    GROUP BY i.id, i.name, i.fee_percentage
                    ORDER BY i.id
                    """
                )
                return await cur.fetchall()


def _generate_api_key() -> str:
    return "sk_" + secrets.token_hex(24)
