import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import payments
from app.api.v1.admin import router as admin_router
from app.api.v1.admin_auth import router as admin_auth_router
from app.api.v1.deps import require_admin
from app.api.v1.integrator_portal import router as integrator_portal_router
from app.config import settings
from app.db.database import close_pool, create_pool
from app.db.integrator_document_repo import IntegratorDocumentRepo
from app.db.integrator_repo import IntegratorRepo
from app.db.integrator_webhook_repo import IntegratorWebhookRepo
from app.db.payment_repo import PaymentRepo
from app.logging_conf import configure_logging
from app.services.fineract_client import FineractClient
from app.services.lmbtech_client import LMBTechClient
from app.services.payment_service import PaymentService

configure_logging()
logger = logging.getLogger(__name__)

DEFAULT_INSECURE_SECRET = "insecure-dev-secret-change-me"


async def _payment_reconciliation_loop(app: FastAPI, interval_seconds: float, max_age_hours: int) -> None:
    """Polls LMBTech for PENDING collections and payouts - its callback can't
    reach localhost, and callbacks can be lost in production too. Also
    re-checks rows that FAILED in the last 2 hours: a local error (timeout,
    unreadable reply) can mark a row FAILED while LMBTech actually took the
    money, and that must be corrected, not left to drift."""
    while True:
        try:
            refs = await app.state.payment_repo.list_pending_references(max_age_hours)
            for ref in refs:
                try:
                    await app.state.payment_service.sync(ref)
                except Exception:
                    logger.exception("payment_reconciliation_failed", extra={"reference_id": ref})
            for ref in await app.state.payment_repo.list_recent_failed_references(hours=2):
                try:
                    await app.state.payment_service.reconcile(ref)
                except Exception:
                    logger.exception("payment_failed_recheck_error", extra={"reference_id": ref})
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("payment_reconciliation_loop_error")
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await create_pool(settings)
    # Fineract is kept for a planned future flow; only the admin endpoints in
    # app/api/v1/admin.py use it today.
    fineract_client = FineractClient(settings)
    integrator_repo = IntegratorRepo(pool)
    integrator_webhook_repo = IntegratorWebhookRepo(pool)
    lmbtech_client = LMBTechClient(settings)

    app.state.settings = settings
    app.state.db_pool = pool
    app.state.fineract_client = fineract_client
    app.state.integrator_repo = integrator_repo
    app.state.integrator_document_repo = IntegratorDocumentRepo(pool)
    app.state.integrator_webhook_repo = integrator_webhook_repo
    app.state.payment_repo = PaymentRepo(pool)
    app.state.payment_service = PaymentService(
        settings=settings,
        repo=app.state.payment_repo,
        gateway=lmbtech_client,
        webhook_repo=integrator_webhook_repo,
        integrator_repo=integrator_repo,
    )

    if not lmbtech_client.configured:
        logger.warning("LMBTECH_APP_KEY / LMBTECH_SECRET_KEY are not set - collections and payouts are disabled.")
    elif not settings.lmbtech_account_email:
        logger.warning("LMBTECH_ACCOUNT_EMAIL is not set - payouts (disbursements) are disabled.")
    if settings.app_env == "prod" and settings.lmbtech_test_mode:
        logger.warning("LMBTECH_TEST_MODE is true while APP_ENV=prod - transactions are labelled TEST.")
    if settings.app_env == "prod" and settings.integrator_session_secret == DEFAULT_INSECURE_SECRET:
        logger.warning(
            "INTEGRATOR_SESSION_SECRET is unset while APP_ENV=prod - portal session tokens are "
            "signed with a publicly-known default secret. Set a real secret before real signups."
        )
    if not settings.admin_username or not settings.admin_password:
        logger.warning(
            "ADMIN_USERNAME / ADMIN_PASSWORD are not set - nobody can log in to the admin "
            "console (admin auth fails closed, not open)."
        )
    if settings.app_env == "prod" and settings.admin_session_secret == DEFAULT_INSECURE_SECRET:
        logger.warning(
            "ADMIN_SESSION_SECRET is unset while APP_ENV=prod - admin session tokens are signed "
            "with a publicly-known default secret."
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
        if payment_task is not None:
            payment_task.cancel()
            with suppress(asyncio.CancelledError):
                await payment_task
        await lmbtech_client.aclose()
        await fineract_client.aclose()
        await close_pool(pool)
        logger.info("shutdown_complete")


app = FastAPI(title="Soila Pay - Collections & Disbursements API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_allowed_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Integrator API (Integrator-Key) + public receipt/callback
app.include_router(payments.router, prefix="/api/v1/payments", tags=["collections"])
app.include_router(payments.disbursement_router, prefix="/api/v1/disbursements", tags=["disbursements"])
# Integrator portal (session)
app.include_router(
    payments.portal_router, prefix="/api/v1/integrator-portal/payments", tags=["portal-collections"]
)
app.include_router(
    payments.portal_disbursement_router,
    prefix="/api/v1/integrator-portal/disbursements",
    tags=["portal-disbursements"],
)
app.include_router(integrator_portal_router, prefix="/api/v1/integrator-portal", tags=["integrator-portal"])
# Admin console
app.include_router(admin_auth_router, prefix="/api/v1/admin/auth", tags=["admin-auth"])
app.include_router(payments.admin_router, prefix="/api/v1/admin/payments", tags=["admin-collections"])
app.include_router(
    payments.admin_disbursement_router, prefix="/api/v1/admin/disbursements", tags=["admin-disbursements"]
)
app.include_router(admin_router, prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(require_admin)])


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
