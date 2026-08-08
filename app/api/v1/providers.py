from fastapi import APIRouter, Query, Request

from app.schemas.dashboard import DailyVolumePoint, ProviderOut

router = APIRouter()

# There's no "providers" table - a provider is just a distinct value of
# transaction_logs.provider (MTN, AIRTEL). Everything here is computed from
# real collection history, not tracked separately. See
# TransactionLogRepo.provider_stats/daily_volume.
_DISPLAY_NAMES = {"MTN": "MTN Mobile Money", "AIRTEL": "Airtel Money"}


def _health_from_success_rate(success_rate: float, sample_size: int) -> str:
    # A provider with no transactions yet isn't "unhealthy" - there's simply
    # no data. Only classify DEGRADED/DOWN once there's a meaningful sample.
    if sample_size == 0:
        return "HEALTHY"
    if success_rate >= 95:
        return "HEALTHY"
    if success_rate >= 80:
        return "DEGRADED"
    return "DOWN"


@router.get("", response_model=list[ProviderOut])
async def list_providers(request: Request) -> list[ProviderOut]:
    rows = await request.app.state.transaction_log_repo.provider_stats()
    out = []
    for row in rows:
        resolved = int(row["resolved_count"] or 0)
        success = int(row["success_count"] or 0)
        success_rate = round((success / resolved) * 100, 1) if resolved else 100.0
        out.append(
            ProviderOut(
                id=row["provider"].lower(),
                name=_DISPLAY_NAMES.get(row["provider"], row["provider"]),
                health=_health_from_success_rate(success_rate, resolved),
                success_rate=success_rate,
                collections_today=int(row["collections_today"] or 0),
            )
        )
    return out


@router.get("/volume", response_model=list[DailyVolumePoint])
async def provider_volume(
    request: Request, days: int = Query(default=14, ge=1, le=90)
) -> list[DailyVolumePoint]:
    rows = await request.app.state.transaction_log_repo.daily_volume(days)
    return [
        DailyVolumePoint(
            date=row["day"].strftime("%d %b"),
            collections=int(row["collections"]),
            failed=int(row["failed"] or 0),
        )
        for row in rows
    ]
