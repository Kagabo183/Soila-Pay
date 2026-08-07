import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.api.v1.utility import router as utility_router
from app.config import settings
from app.db.database import close_pool, create_pool
from app.db.transaction_log_repo import TransactionLogRepo
from app.logging_conf import configure_logging
from app.services.fineract_client import FineractClient
from app.services.purchase_orchestrator import PurchaseOrchestrator
from app.services.utility_provider import get_utility_provider

configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await create_pool(settings)
    fineract_client = FineractClient(settings)
    repo = TransactionLogRepo(pool)
    utility_provider = get_utility_provider(settings)

    app.state.db_pool = pool
    app.state.orchestrator = PurchaseOrchestrator(
        settings=settings,
        repo=repo,
        fineract=fineract_client,
        utility_provider=utility_provider,
    )

    if settings.app_env == "prod" and not settings.fineract_ssl_verify:
        logger.warning(
            "FINERACT_SSL_VERIFY is false while APP_ENV=prod - Fineract TLS "
            "certificate validation is disabled. This should only be true for a "
            "local self-signed Fineract instance."
        )

    logger.info("startup_complete", extra={"app_env": settings.app_env})
    try:
        yield
    finally:
        await fineract_client.aclose()
        await utility_provider.aclose()
        await close_pool(pool)
        logger.info("shutdown_complete")


app = FastAPI(title="Soila Pay - Utility Purchase Middleware", lifespan=lifespan)

app.include_router(utility_router, prefix="/api/v1/utility", tags=["utility"])


@app.get("/healthz")
async def healthz(request: Request):
    return {"status": "ok"}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("unhandled_exception", extra={"path": request.url.path})
    return JSONResponse(
        status_code=500,
        content={"status": "ERROR", "message": "Internal server error"},
    )
