import logging
from decimal import Decimal

import pymysql
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.exceptions import FineractError
from app.schemas.integrator import (
    StoredDocumentType,
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


def _duplicate_detail(exc: pymysql.err.IntegrityError) -> str:
    text = str(exc.args[1]) if len(exc.args) > 1 else ""
    for key, label in (("email", "email"), ("username", "username"), ("phone", "phone number")):
        if key in text:
            return f"Another integrator already uses this {label}"
    return "Another integrator already uses this email, phone or username"


@router.post("/integrators", response_model=IntegratorOut, status_code=201)
async def create_integrator(body: IntegratorCreate, request: Request):
    """New integrator with the full LMBTech-style profile. A password gives
    them a working portal login (by email or username) right away; fee
    overrides are optional (the Pricing defaults apply otherwise)."""
    repo = request.app.state.integrator_repo
    if body.password and not (body.email or body.username):
        raise HTTPException(status_code=400, detail="A password needs an email or username to log in with")
    pricing = await request.app.state.payment_service.pricing()
    for fee, cost, what in (
        (body.payment_fee_percentage, pricing.gateway_cost_percentage, "Collection"),
        (body.payout_fee_percentage, pricing.payout_cost_percentage, "Payout"),
    ):
        if fee is not None and Decimal(fee) < cost:
            raise HTTPException(status_code=400, detail=f"{what} fee {fee}% is below LMBTech's {cost}% cost")
    try:
        created = await repo.create(
            body.name.strip(),
            body.fee_percentage,
            phone_number=body.phone_number,
            email=body.email,
            password_hash=hash_password(body.password) if body.password else None,
        )
        profile = body.profile_dict()
        profile.pop("phone_number", None)  # already set above
        if profile:
            await repo.update_profile(created["id"], profile, allowed=repo.PROFILE_FIELDS + ("username",))
    except pymysql.err.IntegrityError as exc:
        if exc.args and exc.args[0] == 1062:
            # Don't leave a half-created integrator behind if the username clashed.
            if "created" in locals():
                await repo.delete(created["id"])
            raise HTTPException(status_code=409, detail=_duplicate_detail(exc)) from exc
        raise
    if body.payment_fee_percentage is not None or body.payout_fee_percentage is not None:
        await repo.update(
            created["id"],
            payment_fee_percentage=body.payment_fee_percentage,
            payout_fee_percentage=body.payout_fee_percentage,
        )
    return await repo.get_by_id(created["id"])


@router.get("/integrators/summary", response_model=list[IntegratorSummary])
async def integrators_revenue_summary(request: Request):
    """Per-integrator collected/disbursed/fees/LMBTech-cost/margin totals -
    the "where does my margin actually come from" view."""
    return await request.app.state.integrator_repo.revenue_summary()


@router.patch("/integrators/{integrator_id}", response_model=IntegratorOut)
async def update_integrator(integrator_id: int, body: IntegratorUpdate, request: Request):
    repo = request.app.state.integrator_repo
    existing = await repo.get_by_id(integrator_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Integrator not found")
    pricing = await request.app.state.payment_service.pricing()
    checks = [
        (body.payment_fee_percentage, body.clear_payment_fee, pricing.gateway_cost_percentage, "Collection", "payment"),
        (body.payout_fee_percentage, body.clear_payout_fee, pricing.payout_cost_percentage, "Payout", "payout"),
    ]
    for fee, clearing, cost, label, noun in checks:
        if fee is not None and not clearing and Decimal(fee) < cost:
            raise HTTPException(
                status_code=400,
                detail=f"{label} fee {fee}% is below LMBTech's {cost}% cost - every {noun} would lose money.",
            )
    await repo.update(
        integrator_id,
        name=body.name,
        fee_percentage=body.fee_percentage,
        is_active=body.is_active,
        payment_fee_percentage=body.payment_fee_percentage,
        clear_payment_fee=body.clear_payment_fee,
        payout_fee_percentage=body.payout_fee_percentage,
        clear_payout_fee=body.clear_payout_fee,
    )
    if body.new_password:
        await repo.set_password_hash(integrator_id, hash_password(body.new_password))
        logger.warning("integrator_password_reset_by_admin", extra={"integrator_id": integrator_id})
    # Admin-only identity fields + Account Mode (Test / Production).
    admin_fields = body.model_dump(include={"email", "phone_number", "username", "account_mode"}, exclude_unset=True)
    if admin_fields.get("phone_number"):
        from app.schemas.payment import normalize_rw_phone

        try:
            admin_fields["phone_number"] = normalize_rw_phone(admin_fields["phone_number"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if admin_fields:
        try:
            await repo.update_profile(integrator_id, admin_fields, allowed=repo.ADMIN_FIELDS)
        except pymysql.err.IntegrityError as exc:
            if exc.args and exc.args[0] == 1062:
                raise HTTPException(status_code=409, detail="That email, phone or username is already used by another integrator") from exc
            raise
    return await repo.get_by_id(integrator_id)


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
    integrator_id: int, document_type: StoredDocumentType, request: Request
):
    doc = await request.app.state.integrator_document_repo.get(integrator_id, document_type)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return Response(
        content=doc["file_data"],
        media_type=doc["content_type"],
        headers={"Content-Disposition": f'inline; filename="{doc["file_name"]}"'},
    )


# -- Fineract (kept for a planned future flow; no console page uses it now) --


class FineractTopupRequest(BaseModel):
    account_id: str = Field(..., min_length=1)
    amount_rwf: Decimal = Field(..., gt=0)


@router.get("/fineract/balance/{account_id}")
async def fineract_get_balance(account_id: str, request: Request):
    """Get the current balance of a Fineract savings account (the float/ledger account)."""
    try:
        balance = await request.app.state.fineract_client.get_account_balance(account_id)
        return {"account_id": account_id, "balance_rwf": float(balance)}
    except FineractError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/fineract/topup")
async def fineract_topup(body: FineractTopupRequest, request: Request):
    """Deposit funds into a Fineract savings account to top up the collection float."""
    try:
        tx_id = await request.app.state.fineract_client.deposit(
            body.account_id, body.amount_rwf, "Admin top-up via console"
        )
        return {"transaction_id": tx_id, "account_id": body.account_id, "amount_rwf": float(body.amount_rwf)}
    except FineractError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
