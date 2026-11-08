import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.admin import router as admin_router
from app.api.v1.admin_auth import router as admin_auth_router
from app.api.v1.collection import router as collection_router
from app.api.v1.ddin_diagnostics import router as ddin_diagnostics_router
from app.api.v1.deps import require_admin
from app.api.v1.integrator_portal import router as integrator_portal_router
from app.api.v1.payments import admin_router as payments_admin_router
from app.api.v1.payments import portal_router as payments_portal_router
from app.api.v1.payments import router as payments_router
from app.api.v1.providers import router as providers_router
from app.api.v1.webhooks import router as webhooks_router
from app.config import settings
from app.db.database import close_pool, create_pool
from app.db.ddin_diagnostics_repo import DdinDiagnosticsRepo
from app.db.integrator_document_repo import IntegratorDocumentRepo
from app.db.integrator_repo import IntegratorRepo
from app.db.integrator_webhook_repo import IntegratorWebhookRepo
from app.db.payment_repo import PaymentRepo
from app.db.transaction_log_repo import TransactionLogRepo
from app.logging_conf import configure_logging
from app.services.collection_orchestrator import CollectionOrchestrator
from app.services.collection_provider import get_collection_provider
from app.services.fineract_client import FineractClient
from app.services.lmbtech_client import LMBTechClient
from app.services.payment_service import PaymentService

configure_logging()
logger = logging.getLogger(__name__)

DEFAULT_INSECURE_SECRET = "insecure-dev-secret-change-me"


async def _reconciliation_loop(app: FastAPI, interval_seconds: float) -> None:
    """Periodically polls DDIN for every DEBITED (awaiting-outcome) row so a
    collection DDIN already resolved gets reflected locally without anyone
    needing to view or manually sync it - see settings.
    collection_reconciliation_enabled and
    CollectionOrchestrator.sync_with_provider. Runs for the lifetime of the
    app; cancelled on shutdown (see lifespan's finally block)."""
    repo: TransactionLogRepo = app.state.transaction_log_repo
    orchestrator: CollectionOrchestrator = app.state.orchestrator
    while True:
        try:
            keys = await repo.list_debited_idempotency_keys()
            for key in keys:
                try:
                    await orchestrator.sync_with_provider(key)
                except Exception:
                    logger.exception(
                        "reconciliation_sync_failed", extra={"idempotency_key": key}
                    )
            if keys:
                logger.info("reconciliation_sweep_completed", extra={"count": len(keys)})
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("reconciliation_loop_error")
        await asyncio.sleep(interval_seconds)


async def _payment_reconciliation_loop(app: FastAPI, interval_seconds: float, max_age_hours: int) -> None:
    """Polls the gateway for PENDING checkout payments - LMBTech's callback
    can't reach localhost, and callbacks can be lost in production too."""
    while True:
        try:
            refs = await app.state.payment_repo.list_pending_references(max_age_hours)
            for ref in refs:
                try:
                    await app.state.payment_service.sync(ref)
                except Exception:
                    logger.exception("payment_reconciliation_failed", extra={"reference_id": ref})
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("payment_reconciliation_loop_error")
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await create_pool(settings)
    fineract_client = FineractClient(settings)
    repo = TransactionLogRepo(pool)
    integrator_repo = IntegratorRepo(pool)
    integrator_document_repo = IntegratorDocumentRepo(pool)
    collection_provider = get_collection_provider(settings)

    integrator_webhook_repo = IntegratorWebhookRepo(pool)

    app.state.db_pool = pool
    app.state.fineract_client = fineract_client
    app.state.transaction_log_repo = repo
    app.state.integrator_repo = integrator_repo
    app.state.integrator_document_repo = integrator_document_repo
    app.state.integrator_webhook_repo = integrator_webhook_repo
    app.state.ddin_diagnostics_repo = DdinDiagnosticsRepo(pool)
    app.state.settings = settings
    lmbtech_client = LMBTechClient(settings)
    app.state.payment_repo = PaymentRepo(pool)
    app.state.payment_service = PaymentService(
        settings=settings,
        repo=app.state.payment_repo,
        gateway=lmbtech_client,
        webhook_repo=integrator_webhook_repo,
    )
    if not lmbtech_client.configured:
        logger.warning(
            "LMBTECH_APP_KEY / LMBTECH_SECRET_KEY are not set - card and MoMo "
            "checkout payments are disabled until they are."
        )
    app.state.orchestrator = CollectionOrchestrator(
        settings=settings,
        repo=repo,
        fineract=fineract_client,
        collection_provider=collection_provider,
        integrator_repo=integrator_repo,
        webhook_repo=integrator_webhook_repo,
    )

    if settings.app_env == "prod" and not settings.fineract_ssl_verify:
        logger.warning(
            "FINERACT_SSL_VERIFY is false while APP_ENV=prod - Fineract TLS "
            "certificate validation is disabled. This should only be true for a "
            "local self-signed Fineract instance."
        )
    if settings.app_env == "prod" and settings.integrator_session_secret == DEFAULT_INSECURE_SECRET:
        logger.warning(
            "INTEGRATOR_SESSION_SECRET is unset while APP_ENV=prod - integrator "
            "portal session tokens are signed with a publicly-known default "
            "secret. Set a real secret before allowing real signups."
        )
    if not settings.admin_username or not settings.admin_password:
        logger.warning(
            "ADMIN_USERNAME / ADMIN_PASSWORD are not set - /api/v1/admin/* is "
            "reachable but no one can log in (admin auth fails closed, not "
            "open). Set both in .env to use the admin console / DDIN diagnostics."
        )
    if settings.app_env == "prod" and settings.admin_session_secret == DEFAULT_INSECURE_SECRET:
        logger.warning(
            "ADMIN_SESSION_SECRET is unset while APP_ENV=prod - admin session "
            "tokens are signed with a publicly-known default secret. Set a "
            "real secret before relying on admin auth in production."
        )

    reconciliation_task = None
    if settings.collection_reconciliation_enabled:
        reconciliation_task = asyncio.create_task(
            _reconciliation_loop(app, settings.collection_reconciliation_interval_seconds)
        )

    payment_task = None
    if settings.payment_reconciliation_enabled and lmbtech_client.configured:
        payment_task = asyncio.create_task(
            _payment_reconciliation_loop(
                app,
                settings.payment_reconciliation_interval_seconds,
                settings.payment_reconciliation_max_age_hours,
            )
        )

    logger.info("startup_complete", extra={"app_env": settings.app_env})
    try:
        yield
    finally:
        for task in (reconciliation_task, payment_task):
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        await lmbtech_client.aclose()
        await fineract_client.aclose()
        await collection_provider.aclose()
        await close_pool(pool)
        logger.info("shutdown_complete")


app = FastAPI(title="Soila Pay - Collection Middleware", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(collection_router, prefix="/api/v1/collection", tags=["collection"])
app.include_router(payments_router, prefix="/api/v1/payments", tags=["payments"])
app.include_router(
    payments_portal_router, prefix="/api/v1/integrator-portal/payments", tags=["payments-portal"]
)
app.include_router(payments_admin_router, prefix="/api/v1/admin/payments", tags=["payments-admin"])
app.include_router(admin_auth_router, prefix="/api/v1/admin/auth", tags=["admin-auth"])
app.include_router(
    admin_router, prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_admin)]
)
app.include_router(webhooks_router, prefix="/api/v1/webhooks", tags=["webhooks"])
app.include_router(
    providers_router, prefix="/api/v1/providers", tags=["providers"], dependencies=[Depends(require_admin)]
)
app.include_router(
    integrator_portal_router, prefix="/api/v1/integrator-portal", tags=["integrator-portal"]
)
app.include_router(
    ddin_diagnostics_router,
    prefix="/api/v1/admin/ddin",
    tags=["ddin-diagnostics"],
    dependencies=[Depends(require_admin)],
)


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
