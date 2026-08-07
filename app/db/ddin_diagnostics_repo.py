import json

import aiomysql

from app.schemas.ddin_diagnostics import DdinDiagnosticsResult


class DdinDiagnosticsRepo:
    def __init__(self, pool: aiomysql.Pool):
        self._pool = pool

    async def insert_run(self, result: DdinDiagnosticsResult) -> None:
        steps_json = json.dumps([step.model_dump(mode="json") for step in result.steps])
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO ddin_diagnostics_runs
                        (correlation_id, overall_status, base_url, total_duration_ms, steps_json, ran_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        result.correlation_id,
                        result.overall_status,
                        result.base_url,
                        result.total_duration_ms,
                        steps_json,
                        result.ran_at,
                    ),
                )

    async def list_runs(self, limit: int = 20) -> list[dict]:
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT correlation_id, overall_status, base_url, total_duration_ms, steps_json, ran_at
                    FROM ddin_diagnostics_runs
                    ORDER BY ran_at DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = await cur.fetchall()
        for row in rows:
            row["steps"] = json.loads(row.pop("steps_json"))
        return rows
