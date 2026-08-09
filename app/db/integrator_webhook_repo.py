import json
from typing import Optional

import aiomysql


class IntegratorWebhookRepo:
    def __init__(self, pool: aiomysql.Pool) -> None:
        self._pool = pool

    async def create(
        self,
        integrator_id: int,
        callback_url: str,
        events: list[str],
        secret: str,
    ) -> dict:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    INSERT INTO integrator_webhooks
                        (integrator_id, callback_url, events, secret)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (integrator_id, callback_url, json.dumps(events), secret),
                )
                webhook_id = cur.lastrowid
                await conn.commit()
                await cur.execute(
                    "SELECT * FROM integrator_webhooks WHERE id = %s", (webhook_id,)
                )
                row = await cur.fetchone()
        row["events"] = json.loads(row["events"])
        return row

    async def list_by_integrator(self, integrator_id: int) -> list[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT * FROM integrator_webhooks
                    WHERE integrator_id = %s
                    ORDER BY id DESC
                    """,
                    (integrator_id,),
                )
                rows = await cur.fetchall()
        for row in rows:
            row["events"] = json.loads(row["events"])
        return rows

    async def delete(self, webhook_id: int, integrator_id: int) -> bool:
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM integrator_webhooks WHERE id = %s AND integrator_id = %s",
                    (webhook_id, integrator_id),
                )
                deleted = cur.rowcount > 0
                await conn.commit()
        return deleted

    async def list_active_for_event(
        self, integrator_id: int, event: str
    ) -> list[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT * FROM integrator_webhooks
                    WHERE integrator_id = %s
                      AND is_active = 1
                      AND JSON_CONTAINS(events, JSON_QUOTE(%s))
                    """,
                    (integrator_id, event),
                )
                rows = await cur.fetchall()
        for row in rows:
            row["events"] = json.loads(row["events"])
        return rows
