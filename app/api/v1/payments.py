"""
LMBTech money in and out:
  - collections   (customers pay: cards - Visa/Mastercard/other - and MTN MoMo)
  - disbursements (payouts to an MTN MoMo number)

Three ways in, one service (app/services/payment_service.py):
  - Integrator API     Integrator-Key header   /api/v1/payments, /api/v1/disbursements
  - Integrator portal  Bearer portal session   /api/v1/integrator-portal/{payments,disbursements}
  - Admin console      Bearer admin session    /api/v1/admin/{payments,disbursements}
Plus the public pieces a customer's browser / the gateway needs:
  - GET  /api/v1/payments/public/{ref}       receipt page after a card payment
  - POST /api/v1/payments/callback/lmbtech   gateway notification (untrusted -
                                             only triggers a re-check)
"""
import json
import logging
from decimal import Decimal
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request

from app.api.v1.deps import require_admin
from app.api.v1.integrator_portal import _current_integrator
from app.schemas.payment import (
    DisbursementCreate,
    IntegratorPaymentFee,
    Overview,
    OverviewChannel,
    OverviewDay,
    OverviewToday,
    PaginatedPayments,
    PaymentCreate,
    PaymentOut,
    PaymentPricing,
    PaymentPricingOut,
    PaymentSummary,
    PublicPaymentOut,
)
from app.services.payment_service import (
    DISBURSEMENT,
    DuplicateReferenceError,
    InsufficientBalanceError,
    PaymentService,
)

logger = logging.getLogger(__name__)

router = APIRouter()  # /api/v1/payments
disbursement_router = APIRouter()  # /api/v1/disbursements
portal_router = APIRouter()  # /api/v1/integrator-portal/payments
portal_disbursement_router = APIRouter()  # /api/v1/integrator-portal/disbursements
admin_router = APIRouter(dependencies=[Depends(require_admin)])  # /api/v1/admin/payments
admin_disbursement_router = APIRouter(dependencies=[Depends(require_admin)])  # /api/v1/admin/disbursements

StatusFilter = Optional[Literal["PENDING", "SUCCESS", "FAILED", "CANCELLED"]]
MethodFilter = Optional[Literal["MOMO", "CARD"]]
DirectionFilter = Optional[Literal["COLLECTION", "DISBURSEMENT"]]


def _num(value) -> Optional[float]:
    return None if value is None else float(value)


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def payment_out(row: dict, *, admin: bool = False) -> PaymentOut:
    """Integrators see the fee they pay; only admins see LMBTech's cost and
    Soila Pay's margin."""
    return PaymentOut(
        reference_id=row["reference_id"],
        direction=row.get("direction") or "COLLECTION",
        status=row["status"],
        status_message=row.get("status_message"),
        method=row["method"],
        channel=row["channel"],
        amount_rwf=float(row["amount_rwf"]),
        fee_percentage=_num(row.get("fee_percentage")),
        fee_amount_rwf=_num(row.get("fee_amount_rwf")),
        gateway_cost_percentage=_num(row.get("gateway_cost_percentage")) if admin else None,
        gateway_cost_amount_rwf=_num(row.get("gateway_cost_amount_rwf")) if admin else None,
        margin_amount_rwf=_num(row.get("margin_amount_rwf")) if admin else None,
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


# ---------------------------------------------------------------- shared logic

async def _create(request: Request, body: PaymentCreate, integrator: Optional[dict], *, admin: bool = False) -> PaymentOut:
    service = _service(request)
    if not service.gateway_configured:
        raise HTTPException(status_code=503, detail="Payments are not set up yet - add the LMBTech keys in .env")
    try:
        row = await service.create(body, integrator)
    except DuplicateReferenceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return payment_out(row, admin=admin)


async def _create_disbursement(
    request: Request, body: DisbursementCreate, integrator: Optional[dict], *, admin: bool = False
) -> PaymentOut:
    service = _service(request)
    if not service.payouts_configured:
        raise HTTPException(
            status_code=503,
            detail="Payouts are not set up yet - add LMBTECH_ACCOUNT_EMAIL (and the LMBTech keys) in .env",
        )
    try:
        row = await service.create_disbursement(body, integrator)
    except DuplicateReferenceError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InsufficientBalanceError as exc:
        raise HTTPException(status_code=402, detail=str(exc)) from exc
    return payment_out(row, admin=admin)


async def _get(request: Request, reference_id: str, integrator_id: Optional[int], *, scoped: bool) -> PaymentOut:
    row = await request.app.state.payment_repo.get_by_reference(reference_id)
    # 404 (not 403) for someone else's row - can't probe which refs exist.
    if row is None or (scoped and row["integrator_id"] != integrator_id):
        raise HTTPException(status_code=404, detail="Transaction not found")
    if row["status"] == "PENDING":
        row = await _service(request).sync(reference_id)
    return payment_out(row, admin=not scoped)


async def _list(
    request: Request,
    page: int,
    page_size: int,
    integrator_id: Optional[int],
    *,
    direction: Optional[str] = None,
    status: Optional[str] = None,
    method: Optional[str] = None,
    q: Optional[str] = None,
    admin: bool = False,
) -> PaginatedPayments:
    rows, total = await request.app.state.payment_repo.list_paginated(
        page, page_size, integrator_id=integrator_id, direction=direction, status=status, method=method, q=q
    )
    return PaginatedPayments(
        items=[payment_out(r, admin=admin) for r in rows], total=total, page=page, page_size=page_size
    )


async def _summary(request: Request, integrator: Optional[dict], direction: Optional[str] = None) -> PaymentSummary:
    """integrator=None -> admin view across everyone, with cost + margin."""
    service = _service(request)
    repo = request.app.state.payment_repo
    row = await repo.summary(integrator["id"] if integrator else None, direction)
    pricing = await service.pricing()
    summary = PaymentSummary(
        collected_rwf=float(row["collected_rwf"]),
        disbursed_rwf=float(row["disbursed_rwf"]),
        fees_rwf=float(row["fees_rwf"]),
        momo_rwf=float(row["momo_rwf"]),
        card_rwf=float(row["card_rwf"]),
        success_count=int(row["success_count"]),
        pending_count=int(row["pending_count"]),
        failed_count=int(row["failed_count"]),
        total_count=int(row["total_count"]),
        gateway_configured=service.gateway_configured,
        payouts_configured=service.payouts_configured,
        test_mode=request.app.state.settings.lmbtech_test_mode,
    )
    if integrator is not None:
        summary.fee_percentage = float(service.fee_for(integrator, pricing))
        summary.payout_fee_percentage = float(service.fee_for(integrator, pricing, DISBURSEMENT))
        summary.available_balance_rwf = float(await service.available_balance(integrator["id"]))
    else:
        summary.gateway_cost_percentage = float(pricing.gateway_cost_percentage)
        summary.payout_cost_percentage = float(pricing.payout_cost_percentage)
        summary.gateway_cost_rwf = float(row["gateway_cost_rwf"])
        summary.margin_rwf = float(row["margin_rwf"])
        summary.integrators_below_cost = len(await repo.integrators_below_cost(pricing))
    return summary


async def _overview(request: Request, integrator: Optional[dict], days: int) -> Overview:
    repo = request.app.state.payment_repo
    integrator_id = integrator["id"] if integrator else None
    data = await repo.overview(days, integrator_id)
    today = data["today"]
    finished = int(today["success"]) + int(today["failed"])
    rows, _ = await repo.list_paginated(1, 8, integrator_id=integrator_id)
    return Overview(
        days=days,
        series=[OverviewDay(**d) for d in data["series"]],
        channels=[
            OverviewChannel(channel=c["channel"], amount_rwf=float(c["amount"]), count=int(c["n"]))
            for c in data["channels"]
        ],
        today=OverviewToday(
            collected_rwf=float(today["collected"]),
            disbursed_rwf=float(today["disbursed"]),
            margin_rwf=float(today["margin"]) if integrator is None else None,
            success_count=int(today["success"]),
            failed_count=int(today["failed"]),
            pending_count=int(today["pending"]),
            success_rate=round(100 * int(today["success"]) / finished, 1) if finished else None,
        ),
        recent=[payment_out(r, admin=integrator is None) for r in rows],
    )


async def _pricing_out(request: Request) -> PaymentPricingOut:
    service = _service(request)
    pricing = await service.pricing()
    rows = await request.app.state.integrator_repo.list_integrators()
    integrators = []
    for r in rows:
        pay_fee = service.fee_for(r, pricing)
        payout_fee = service.fee_for(r, pricing, DISBURSEMENT)
        integrators.append(
            IntegratorPaymentFee(
                id=r["id"],
                name=r["name"],
                payment_fee_percentage=_num(r.get("payment_fee_percentage")),
                effective_fee_percentage=float(pay_fee),
                payout_fee_percentage=_num(r.get("payout_fee_percentage")),
                effective_payout_fee_percentage=float(payout_fee),
                below_cost=pay_fee < pricing.gateway_cost_percentage or payout_fee < pricing.payout_cost_percentage,
            )
        )
    return PaymentPricingOut(
        gateway_cost_percentage=float(pricing.gateway_cost_percentage),
        default_fee_percentage=float(pricing.default_fee_percentage),
        payout_cost_percentage=float(pricing.payout_cost_percentage),
        payout_default_fee_percentage=float(pricing.payout_default_fee_percentage),
        integrators=integrators,
    )


# ---------------------------------------------------------------- Integrator API

async def _integrator_from_key(
    request: Request, integrator_key: str = Header(..., alias="Integrator-Key", min_length=1)
) -> dict:
    integrator = await request.app.state.integrator_repo.get_by_api_key(integrator_key)
    if integrator is None:
        raise HTTPException(status_code=401, detail="Unknown Integrator-Key")
    if not integrator["is_active"]:
        raise HTTPException(status_code=403, detail="Integrator account is disabled")
    return integrator


@router.post("", response_model=PaymentOut, status_code=201)
async def api_create_payment(body: PaymentCreate, request: Request, integrator: dict = Depends(_integrator_from_key)):
    """Collect a payment. VISA / MASTERCARD / OTHER_CARD: send the customer
    to `redirect_url`. MTN_MOMO: the customer approves on their phone. Poll
    GET /payments/{reference_id} or subscribe to payment.* webhooks."""
    return await _create(request, body, integrator)


@router.get("/public/{reference_id}", response_model=PublicPaymentOut)
async def public_payment(reference_id: str, request: Request):
    """Receipt for the customer's browser after the card page sends them back.
    Exposes no contact details; references are random and unguessable."""
    row = await request.app.state.payment_repo.get_by_reference(reference_id)
    if row is None or row.get("direction") == DISBURSEMENT:
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
    """LMBTech posts JSON (MoMo, payouts) or form data (card). The body is NOT
    signed, so it is only used to find the row; the real status is fetched
    from the gateway's authenticated status API before anything changes."""
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
    direction: DirectionFilter = None,
    status: StatusFilter = None,
    method: MethodFilter = None,
    integrator: dict = Depends(_integrator_from_key),
):
    return await _list(request, page, page_size, integrator["id"], direction=direction, status=status, method=method)


@disbursement_router.post("", response_model=PaymentOut, status_code=201)
async def api_create_disbursement(
    body: DisbursementCreate, request: Request, integrator: dict = Depends(_integrator_from_key)
):
    """Send money to an MTN MoMo number from your available balance
    (collections minus fees minus earlier payouts). 402 if it's not enough."""
    return await _create_disbursement(request, body, integrator)


@disbursement_router.get("/balance")
async def api_balance(request: Request, integrator: dict = Depends(_integrator_from_key)):
    balance = await _service(request).available_balance(integrator["id"])
    return {"available_balance_rwf": float(balance)}


@disbursement_router.get("/{reference_id}", response_model=PaymentOut)
async def api_get_disbursement(reference_id: str, request: Request, integrator: dict = Depends(_integrator_from_key)):
    return await _get(request, reference_id, integrator["id"], scoped=True)


# ---------------------------------------------------------------- Integrator portal

@portal_router.post("", response_model=PaymentOut, status_code=201)
async def portal_create_payment(body: PaymentCreate, request: Request, integrator: dict = Depends(_current_integrator)):
    return await _create(request, body, integrator)


@portal_router.get("/summary", response_model=PaymentSummary)
async def portal_summary(
    request: Request, direction: DirectionFilter = None, integrator: dict = Depends(_current_integrator)
):
    return await _summary(request, integrator, direction)


@portal_router.get("/overview", response_model=Overview)
async def portal_overview(
    request: Request, days: int = Query(default=14, ge=1, le=90), integrator: dict = Depends(_current_integrator)
):
    return await _overview(request, integrator, days)


@portal_router.get("/{reference_id}", response_model=PaymentOut)
async def portal_get_payment(reference_id: str, request: Request, integrator: dict = Depends(_current_integrator)):
    return await _get(request, reference_id, integrator["id"], scoped=True)


@portal_router.get("", response_model=PaginatedPayments)
async def portal_list_payments(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    direction: DirectionFilter = None,
    status: StatusFilter = None,
    method: MethodFilter = None,
    q: Optional[str] = Query(default=None, max_length=80),
    integrator: dict = Depends(_current_integrator),
):
    return await _list(
        request, page, page_size, integrator["id"], direction=direction, status=status, method=method, q=q
    )


@portal_disbursement_router.post("", response_model=PaymentOut, status_code=201)
async def portal_create_disbursement(
    body: DisbursementCreate, request: Request, integrator: dict = Depends(_current_integrator)
):
    return await _create_disbursement(request, body, integrator)


# ---------------------------------------------------------------- Admin console

@admin_router.post("", response_model=PaymentOut, status_code=201)
async def admin_create_payment(body: PaymentCreate, request: Request):
    return await _create(request, body, None, admin=True)


@admin_router.get("/summary", response_model=PaymentSummary)
async def admin_summary(request: Request, direction: DirectionFilter = None):
    return await _summary(request, None, direction)


@admin_router.get("/overview", response_model=Overview)
async def admin_overview(request: Request, days: int = Query(default=14, ge=1, le=90)):
    return await _overview(request, None, days)


@admin_router.get("/pricing", response_model=PaymentPricingOut)
async def admin_get_pricing(request: Request):
    """LMBTech's cuts, the default fees, and each integrator's effective fees
    (flagged when below the cost)."""
    return await _pricing_out(request)


@admin_router.put("/pricing", response_model=PaymentPricingOut)
async def admin_set_pricing(body: PaymentPricing, request: Request):
    for fee, cost, what in (
        (body.default_fee_percentage, body.gateway_cost_percentage, "collection"),
        (body.payout_default_fee_percentage, body.payout_cost_percentage, "payout"),
    ):
        if fee < cost:
            raise HTTPException(
                status_code=400,
                detail=f"Default {what} fee {fee}% is below LMBTech's {cost}% cost - every {what} would lose money.",
            )
    await _service(request).set_pricing(
        gateway_cost_percentage=Decimal(str(body.gateway_cost_percentage)),
        default_fee_percentage=Decimal(str(body.default_fee_percentage)),
        payout_cost_percentage=Decimal(str(body.payout_cost_percentage)),
        payout_default_fee_percentage=Decimal(str(body.payout_default_fee_percentage)),
    )
    return await _pricing_out(request)


@admin_router.get("/{reference_id}", response_model=PaymentOut)
async def admin_get_payment(reference_id: str, request: Request):
    return await _get(request, reference_id, None, scoped=False)


@admin_router.get("", response_model=PaginatedPayments)
async def admin_list_payments(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200, alias="pageSize"),
    direction: DirectionFilter = None,
    status: StatusFilter = None,
    method: MethodFilter = None,
    q: Optional[str] = Query(default=None, max_length=80),
):
    return await _list(
        request, page, page_size, None, direction=direction, status=status, method=method, q=q, admin=True
    )


@admin_disbursement_router.post("", response_model=PaymentOut, status_code=201)
async def admin_create_disbursement(body: DisbursementCreate, request: Request):
    """Payout from Soila Pay's own LMBTech balance (no integrator balance check;
    LMBTech refuses with 402 if the account balance is too low)."""
    return await _create_disbursement(request, body, None, admin=True)
