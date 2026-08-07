import aiomysql

from app.config import Settings


async def create_pool(settings: Settings) -> aiomysql.Pool:
    return await aiomysql.create_pool(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        db=settings.mysql_db,
        minsize=settings.mysql_pool_min_size,
        maxsize=settings.mysql_pool_max_size,
        autocommit=True,
    )


async def close_pool(pool: aiomysql.Pool) -> None:
    pool.close()
    await pool.wait_closed()
