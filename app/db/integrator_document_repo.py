from typing import Optional

import aiomysql

DOCUMENT_TYPES = ("TAX_CLEARANCE", "RDB_CERTIFICATE")


class IntegratorDocumentRepo:
    def __init__(self, pool: aiomysql.Pool):
        self._pool = pool

    async def upsert(
        self,
        integrator_id: int,
        document_type: str,
        file_name: str,
        content_type: str,
        file_data: bytes,
    ) -> None:
        """Re-uploading the same document_type replaces the previous file -
        see the UNIQUE KEY on (integrator_id, document_type)."""
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    """
                    INSERT INTO integrator_documents
                        (integrator_id, document_type, file_name, content_type, file_size_bytes, file_data)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        file_name = VALUES(file_name),
                        content_type = VALUES(content_type),
                        file_size_bytes = VALUES(file_size_bytes),
                        file_data = VALUES(file_data)
                    """,
                    (integrator_id, document_type, file_name, content_type, len(file_data), file_data),
                )

    async def get(self, integrator_id: int, document_type: str) -> Optional[dict]:
        """Includes file_data - only call when you actually need the bytes
        (downloading). Use list_metadata for anything else."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT * FROM integrator_documents
                    WHERE integrator_id = %s AND document_type = %s
                    """,
                    (integrator_id, document_type),
                )
                return await cur.fetchone()

    async def list_metadata(self, integrator_id: int) -> list[dict]:
        """file_data omitted deliberately - this is for list/status views."""
        async with self._pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """
                    SELECT id, integrator_id, document_type, file_name, content_type,
                           file_size_bytes, uploaded_at
                    FROM integrator_documents
                    WHERE integrator_id = %s
                    ORDER BY document_type
                    """,
                    (integrator_id,),
                )
                return await cur.fetchall()

    async def has_all_required(self, integrator_id: int) -> bool:
        uploaded = await self.list_metadata(integrator_id)
        uploaded_types = {row["document_type"] for row in uploaded}
        return uploaded_types.issuperset(DOCUMENT_TYPES)
