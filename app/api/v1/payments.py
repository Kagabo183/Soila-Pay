"""
Checkout payments: MTN MoMo + cards (Visa / Mastercard / other) via LMBTech.

Three ways in, one service:
  - Integrator API      Integrator-Key header      POST/GET /api/v1/payments...
  - Integrator portal   Bearer portal session      /api/v1/integrator-portal/payments...
  - Admin console       Bearer admin session       /api/v1/admin/payments...
Plus the public pieces a customer's browser / the gateway needs:
  - GET  /api/v1/payments/public/{ref}       receipt page after a card payment
  - POST /api/v1/payments/callback/lmbtech   gateway notification (untrusted -
                                             only triggers a re-check)
"""
import json
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from app.api.v1.deps import require_admin
from app.api.v1.integrator_portal import _current_integrator
from app.schemas.payment import (
    PaginatedPayments,
    PaymentCreate,
    PaymentOut,
    PaymentSummary,
    PublicPaymentOut,
)
from app.services.payment_service import DuplicateReferenceError, PaymentService

logger = logging.getLogger(__name__)

router = APIRouter()  # /api/v1/payments
portal_router = APIRouter()  # /api/v1/integrator-portal/payments
admin_router = APIRouter(dependencies=[Depends(require_admin)])  # /api/v1/admin/payments


def _num(value) -> Optional[float]:
    return None if value is None else float(value)


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def payment_out(row: dict) -> PaymentOut:
    return PaymentOut(
        reference_id=row["reference_id"],
        status=row["status"],
        status_message=row.get("status_message"),
        method=row["method"],
        channel=row["channel"],
        amount_rwf=float(row["amount_rwf"]),
        fee_amount_rwf=_num(row.get("fee_amount_rwf")),
        customer_name=row["customer_name"],
        customer_email=row["customer_email"],
        customer_phone=row.get("customer_phone"),
        description=row["description"],
        gateway=row["gateway"],
        gateway_transaction_id=row.get("gateway_transaction_id"),
        redirect_url=row.get("redirect_url") if row["status"] == "PENDING" else None,
        is_test=bool(row["is_test"]),
        integrator_id=row.get("integrator_id"),
        integrator_name=row.get("integrator_name"),
        created_at=_iso(row["created_at"]),
        completed_at=_iso(row.get("completed_at")),
    )


def _service(request: Request) -> PaymentService:
    return request.app.state.payment_service


async def _create(request: Request, body: PaymentCreate, integrator: Optional[dict]) -> PaymentOut:
    service = _service(request)
    if not service.gateway_configured:
        raise HTTPException(status_code=503, detail="Card/MoMo payments are not set up yet - add LMBTech keys in .env")
    try:
        row = await service.create(body, integrator)
    except DuplicateReferenceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return payment_out(row)


async def _get(request: Request, reference_id: str, integrator_id: Optional[int], *, scoped: bool) -> PaymentOut:
    service = _service(request)
    row = await request.app.state.payment_repo.get_by_reference(reference_id)
    # 404 (not 403) for someone else's payment - can't probe which refs exist.
    if row is None or (scoped and row["integrator_id"] != integrator_id):
        raise HTTPException(status_code=404, detail="Payment not found")
    if row["status"] == "PENDING":
        row = await service.sync(reference_id)
    return payment_out(row)


async def _list(request, page, page_size, integrator_id, status, method) -> PaginatedPayments:
    rows, total = await request.app.state.payment_repo.list_paginated(
        page, page_size, integrator_id=integrator_id, status=status, method=method
    )
    return PaginatedPayments(items=[payment_out(r) for r in rows], total=total, page=page, page_size=page_size)


async def _summary(request: Request, integrator_id: Optional[int]) -> PaymentSummary:
    row = await request.app.state.payment_repo.summary(integrator_id)
    settings = request.app.state.settings
    return PaymentSummary(
        collected_rwf=float(row["collected_rwf"] or 0),
        fees_rwf=float(row["fees_rwf"] or 0),
        momo_rwf=float(row["momo_rwf"] or 0),
        card_rwf=float(row["card_rwf"] or 0),
        success_count=int(row["success_count"] or 0),
        pending_count=int(row["pending_count"] or 0),
        failed_count=int(row["failed_count"] or 0),
        total_count=int(row["total_count"] or 0),
        gateway_configured=_service(request).gateway_configured,
        test_mode=settings.lmbtech_test_mode,
    )


StatusFilter = Optional[Literal["PENDING", "SUCCESS", "FAILED", "CANCELLED"]]
MethodFilter = Optional[Literal["MOMO", "CARD"]]


# ---------------------------------------------------------------- Integrator API

async def _integrator_from_key(request: Request, integrator_key: str = Header(..., alias="Integrator-Key", min_length=1)) -> dict:
    integrator = await request.app.state.integrator_repo.get_by_api_key(integrator_key)
    if integrator is None:
        raise HTTPException(status_code=401, detail="Unknown Integrator-Key")
    if not integrator["is_active"]:
        raise HTTPException(status_code=403, detail="Integrator account is disabled")
    return integrator


@router.post("", response_model=PaymentOut, status_code=201)
async def api_create_payment(body: PaymentCreate, request: Request, integrator: dict = Depends(_integrator_from_key)):
    """Start a payment. MTN_MOMO: the customer gets a prompt on their phone;
    poll GET /payments/{reference_id} or subscribe to payment.* webhooks.
    VISA / MASTERCARD / OTHER_CARD: send the customer to `redirect_url`."""
    return await _create(request, body, integrator)


@router.get("/public/{reference_id}", response_model=PublicPaymentOut)
async def public_payment(reference_id: str, request: Request):
    """Receipt for the customer's browser after the card page sends them back.
    Exposes no contact details; references are random and unguessable."""
    row = await request.app.state.payment_repo.get_by_reference(reference_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    if row["status"] == "PENDING":
        row = await _service(request).sync(reference_id)
    return PublicPaymentOut(
        reference_id=row["reference_id"],
        status=row["status"],
        status_message=row.get("status_message"),
        method=row["method"],
        channel=row["channel"],
        amount_rwf=float(row["amount_rwf"]),
        customer_name=row["customer_name"],
        description=row["description"],
        is_test=bool(row["is_test"]),
        created_at=_iso(row["created_at"]),
        completed_at=_iso(row.get("completed_at")),
        return_url=row.get("return_url"),
    )


@router.api_route("/callback/lmbtech", methods=["POST", "GET"])
async def lmbtech_callback(request: Request):
    """LMBTech posts JSON (MoMo) or form data (card). The body is NOT signed,
    so it is only used to find the payment; the real status is fetched from
    the gateway's authenticated status API before anything changes."""
    reference_id: Optional[str] = request.query_params.get("reference_id")
    if not reference_id and request.method == "POST":
        raw = await request.body()
        content_type = request.headers.get("content-type", "")
        try:
            if "json" in content_type:
                reference_id = json.loads(raw or b"{}").get("reference_id")
            else:
                reference_id = (await request.form()).get("reference_id")
        except Exception:
            reference_id = None
    if not reference_id:
        return {"status": False, "message": "Invalid callback data"}

    row = await _service(request).sync(str(reference_id))
    logger.info("lmbtech_callback", extra={"reference_id": reference_id, "found": row is not None})
    return {
        "status": row is not None,
        "message": "Callback received and processed" if row else "Unknown reference",
        "site_url": request.app.state.settings.frontend_base_url,
    }


@router.get("/{reference_id}", response_model=PaymentOut)
async def api_get_payment(reference_id: str, request: Request, integrator: dict = Depends(_integrator_from_key)):
    return await _get(request, reference_id, integrator["id"], scoped=True)


@router.get("", response_model=PaginatedPayments)
async def api_list_payments(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    status: StatusFilter = None,
    method: MethodFilter = None,
    integrator: dict = Depends(_integrator_from_key),
):
    return await _list(request, page, page_size, integrator["id"], status, method)


# ---------------------------------------------------------------- Integrator portal

@portal_router.post("", response_model=PaymentOut, status_code=201)
async def portal_create_payment(body: PaymentCreate, request: Request, integrator: dict = Depends(_current_integrator)):
    return await _create(request, body, integrator)


@portal_router.get("/summary", response_model=PaymentSummary)
async def portal_summary(request: Request, integrator: dict = Depends(_current_integrator)):
    return await _summary(request, integrator["id"])


@portal_router.get("/{reference_id}", response_model=PaymentOut)
async def portal_get_payment(reference_id: str, request: Request, integrator: dict = Depends(_current_integrator)):
    return await _get(request, reference_id, integrator["id"], scoped=True)


@portal_router.get("", response_model=PaginatedPayments)
async def portal_list_payments(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    status: StatusFilter = None,
    method: MethodFilter = None,
    integrator: dict = Depends(_current_integrator),
):
    return await _list(request, page, page_size, integrator["id"], status, method)


# ---------------------------------------------------------------- Admin console

@admin_router.post("", response_model=PaymentOut, status_code=201)
async def admin_create_payment(body: PaymentCreate, request: Request):
    return await _create(request, body, None)


@admin_router.get("/summary", response_model=PaymentSummary)
async def admin_summary(request: Request):
    return await _summary(request, None)


@admin_router.get("/{reference_id}", response_model=PaymentOut)
async def admin_get_payment(reference_id: str, request: Request):
    return await _get(request, reference_id, None, scoped=False)


@admin_router.get("", response_model=PaginatedPayments)
async def admin_list_payments(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200, alias="pageSize"),
    status: StatusFilter = None,
    method: MethodFilter = None,
):
    return await _list(request, page, page_size, None, status, method)
