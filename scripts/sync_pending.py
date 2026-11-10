"""
Settle pending payments once and exit - run from cron every minute on shared
hosting, where the web app's own background checker stops when Passenger
puts the app to sleep.

Same work as the app's background loop (app/main.py): ask LMBTech about
pending payments, settle due sandbox payments (which also fires webhooks),
and re-check payments that failed in the last 2 hours.

    * * * * * cd ~/soila-pay && .venv/bin/python scripts/sync_pending.py >> ~/logs/soila-sync.log 2>&1
"""
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.db.database import close_pool, create_pool  # noqa: E402
from app.db.integrator_repo import IntegratorRepo  # noqa: E402
from app.db.integrator_webhook_repo import IntegratorWebhookRepo  # noqa: E402
from app.db.payment_repo import PaymentRepo  # noqa: E402
from app.services import webhook_dispatcher  # noqa: E402
from app.services.lmbtech_client import LMBTechClient  # noqa: E402
from app.services.payment_service import PaymentService  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("sync_pending")


async def main() -> None:
    pool = await create_pool(settings)
    gateway = LMBTechClient(settings)
    repo = PaymentRepo(pool)
    service = PaymentService(settings, repo, gateway, IntegratorWebhookRepo(pool), IntegratorRepo(pool))
    try:
        pending = await repo.list_pending_references(settings.payment_reconciliation_max_age_hours)
        for ref in pending:
            try:
                await service.sync(ref)
            except Exception:
                log.exception("sync failed for %s", ref)
        failed = await repo.list_recent_failed_references(hours=2)
        for ref in failed:
            try:
                await service.reconcile(ref)
            except Exception:
                log.exception("recheck failed for %s", ref)
        # Webhook deliveries (with retries) run as tasks - let them finish
        # before the process exits.
        if webhook_dispatcher._tasks:
            await asyncio.wait(set(webhook_dispatcher._tasks), timeout=240)
        log.info("checked %d pending, %d recently failed", len(pending), len(failed))
    finally:
        await gateway.aclose()
        await close_pool(pool)


if __name__ == "__main__":
    asyncio.run(main())
