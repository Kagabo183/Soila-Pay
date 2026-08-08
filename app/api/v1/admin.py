import logging
from decimal import Decimal

import pymysql
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from app.schemas.integrator import (
    DdinCostSetting,
    DocumentType,
    IntegratorCreate,
    IntegratorDocumentOut,
    IntegratorOut,
    IntegratorSummary,
    IntegratorUpdate,
    ProductionReviewDecision,
)
from app.services.integrator_auth import hash_password

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/integrators", response_model=list[IntegratorOut])
async def list_integrators(request: Request):
    return await request.app.state.integrator_repo.list_integrators()


@router.post("/integrators", response_model=IntegratorOut, status_code=201)
async def create_integrator(body: IntegratorCreate, request: Request):
    """phone_number + password are optional - set both to also hand the
    integrator working self-service portal login credentials (they can then
    log in at /portal/login) instead of requiring them to sign up themselves."""
    if bool(body.phone_number) != bool(body.password):
        raise HTTPException(
            status_code=400,
            detail="Set both phone_number and password together, or neither",
        )
    try:
        return await request.app.state.integrator_repo.create(
            body.name,
            body.fee_percentage,
            phone_number=body.phone_number,
            password_hash=hash_password(body.password) if body.password else None,
        )
    except pymysql.err.IntegrityError as exc:
        if exc.args and exc.args[0] == 1062:  # duplicate phone_number
            raise HTTPException(
                status_code=409, detail="An integrator with this phone number already exists"
            ) from exc
        raise


@router.get("/integrators/summary", response_model=list[IntegratorSummary])
async def integrators_revenue_summary(request: Request):
    """Per-integrator collected/charged/DDIN-cost/margin totals - the
    "where does my margin actually come from" view."""
    return await request.app.state.integrator_repo.revenue_summary()


@router.patch("/integrators/{integrator_id}", response_model=IntegratorOut)
async def update_integrator(integrator_id: int, body: IntegratorUpdate, request: Request):
    repo = request.app.state.integrator_repo
    existing = await repo.get_by_id(integrator_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Integrator not found")
    return await repo.update(
        integrator_id,
        name=body.name,
        fee_percentage=body.fee_percentage,
        is_active=body.is_active,
        sandbox_uses_real_provider=body.sandbox_uses_real_provider,
    )


@router.post("/integrators/{integrator_id}/approve-production", response_model=IntegratorOut)
async def approve_integrator_production(integrator_id: int, request: Request):
    """Generates and activates production_api_key. Callable regardless of
    whether the integrator went through the self-service KYC submission
    (app/api/v1/integrator_portal.py) or was created directly by an admin -
    an operator can vouch for an integrator without requiring the form."""
    repo = request.app.state.integrator_repo
    existing = await repo.get_by_id(integrator_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Integrator not found")
    return await repo.approve_production(integrator_id)


@router.post("/integrators/{integrator_id}/reject-production", response_model=IntegratorOut)
async def reject_integrator_production(
    integrator_id: int, body: ProductionReviewDecision, request: Request
):
    repo = request.app.state.integrator_repo
    existing = await repo.get_by_id(integrator_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Integrator not found")
    return await repo.reject_production(integrator_id, body.reason or "Rejected by operator")


@router.get("/integrators/{integrator_id}/documents", response_model=list[IntegratorDocumentOut])
async def list_integrator_documents(integrator_id: int, request: Request):
    """Metadata only (name/type/size) - use the per-document endpoint below to
    actually view/download a file for KYC review."""
    repo = request.app.state.integrator_repo
    if await repo.get_by_id(integrator_id) is None:
        raise HTTPException(status_code=404, detail="Integrator not found")
    return await request.app.state.integrator_document_repo.list_metadata(integrator_id)


@router.get("/integrators/{integrator_id}/documents/{document_type}")
async def download_integrator_document(
    integrator_id: int, document_type: DocumentType, request: Request
):
    doc = await request.app.state.integrator_document_repo.get(integrator_id, document_type)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return Response(
        content=doc["file_data"],
        media_type=doc["content_type"],
        headers={"Content-Disposition": f'inline; filename="{doc["file_name"]}"'},
    )


@router.get("/settings/ddin-cost-percentage", response_model=DdinCostSetting)
async def get_ddin_cost_percentage(request: Request):
    value = await request.app.state.integrator_repo.get_setting("ddin_cost_percentage")
    return DdinCostSetting(ddin_cost_percentage=Decimal(value) if value else Decimal("2.00"))


@router.patch("/settings/ddin-cost-percentage", response_model=DdinCostSetting)
async def update_ddin_cost_percentage(body: DdinCostSetting, request: Request):
    await request.app.state.integrator_repo.set_setting(
        "ddin_cost_percentage", str(body.ddin_cost_percentage)
    )
    return body
