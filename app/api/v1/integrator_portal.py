import logging
import secrets
from typing import Literal

import pymysql
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, HttpUrl

from app.config import settings
from app.schemas.dashboard import CollectionTransactionOut, PaginatedTransactions
from app.schemas.integrator import (
    DocumentType,
    IntegratorDocumentOut,
    IntegratorLoginRequest,
    IntegratorOut,
    IntegratorSessionResponse,
    IntegratorSignupRequest,
    ProductionKycSubmitRequest,
)
from app.services.integrator_auth import (
    create_session_token,
    hash_password,
    verify_password,
    verify_session_token,
)

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024  # 5MB - KYC docs are small PDFs/images
ALLOWED_DOCUMENT_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}


async def _current_integrator(request: Request, authorization: str = Header(...)) -> dict:
    """Bearer <session-token> - see app/services/integrator_auth.py. Distinct
    from Integrator-Key (which authenticates API calls, not portal sessions)."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    integrator_id = verify_session_token(token, settings.integrator_session_secret)
    if integrator_id is None:
        raise HTTPException(status_code=401, detail="Session expired or invalid - log in again")

    integrator = await request.app.state.integrator_repo.get_by_id(integrator_id)
    if integrator is None:
        raise HTTPException(status_code=401, detail="Account no longer exists")
    return integrator


@router.post("/signup", response_model=IntegratorSessionResponse, status_code=201)
async def signup(body: IntegratorSignupRequest, request: Request):
    """Sandbox-only signup - register with email to start testing immediately.
    Going live requires POST /production/submit and admin approval."""
    repo = request.app.state.integrator_repo
    try:
        integrator = await repo.create_self_signup(
            body.name, body.email, hash_password(body.password)
        )
    except pymysql.err.IntegrityError as exc:
        if exc.args and exc.args[0] == 1062:  # duplicate email
            raise HTTPException(
                status_code=409, detail="An account with this email already exists"
            ) from exc
        raise

    token = create_session_token(integrator["id"], settings.integrator_session_secret)
    return IntegratorSessionResponse(token=token, integrator=integrator)


@router.post("/login", response_model=IntegratorSessionResponse)
async def login(body: IntegratorLoginRequest, request: Request):
    repo = request.app.state.integrator_repo
    integrator = await repo.get_by_email(body.email)
    if integrator is None or not integrator.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(body.password, integrator["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_session_token(integrator["id"], settings.integrator_session_secret)
    return IntegratorSessionResponse(token=token, integrator=integrator)


@router.get("/me", response_model=IntegratorOut)
async def me(integrator: dict = Depends(_current_integrator)):
    return integrator


@router.post("/production/documents", response_model=IntegratorDocumentOut, status_code=201)
async def upload_production_document(
    request: Request,
    document_type: DocumentType = Form(...),
    file: UploadFile = File(...),
    integrator: dict = Depends(_current_integrator),
):
    """Real file upload (not a text reference/URL) - re-uploading the same
    document_type replaces the previous file. See the "Known simplification"
    note in the README: stored as a DB blob, no virus scanning or S3."""
    if file.content_type not in ALLOWED_DOCUMENT_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type {file.content_type!r} - upload a PDF, JPEG, or PNG",
        )
    data = await file.read()
    if len(data) > MAX_DOCUMENT_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large - max 5MB")
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")

    document_repo = request.app.state.integrator_document_repo
    await document_repo.upsert(
        integrator["id"],
        document_type,
        file.filename or f"{document_type}.dat",
        file.content_type,
        data,
    )
    doc = await document_repo.get(integrator["id"], document_type)
    return IntegratorDocumentOut(
        document_type=doc["document_type"],
        file_name=doc["file_name"],
        content_type=doc["content_type"],
        file_size_bytes=doc["file_size_bytes"],
        uploaded_at=doc["uploaded_at"],
    )


@router.get("/production/documents", response_model=list[IntegratorDocumentOut])
async def list_production_documents(
    request: Request, integrator: dict = Depends(_current_integrator)
):
    document_repo = request.app.state.integrator_document_repo
    return await document_repo.list_metadata(integrator["id"])


@router.get("/production/documents/{document_type}")
async def download_own_document(
    document_type: DocumentType, request: Request, integrator: dict = Depends(_current_integrator)
):
    document_repo = request.app.state.integrator_document_repo
    doc = await document_repo.get(integrator["id"], document_type)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not uploaded yet")
    return Response(
        content=doc["file_data"],
        media_type=doc["content_type"],
        headers={"Content-Disposition": f'inline; filename="{doc["file_name"]}"'},
    )


@router.post("/production/submit", response_model=IntegratorOut)
async def submit_production_kyc(
    body: ProductionKycSubmitRequest,
    request: Request,
    integrator: dict = Depends(_current_integrator),
):
    document_repo = request.app.state.integrator_document_repo
    if not await document_repo.has_all_required(integrator["id"]):
        raise HTTPException(
            status_code=400,
            detail=(
                "Upload both a tax clearance certificate and an RDB certificate "
                "(POST /production/documents) before submitting for review"
            ),
        )
    tax_doc = await document_repo.get(integrator["id"], "TAX_CLEARANCE")
    rdb_doc = await document_repo.get(integrator["id"], "RDB_CERTIFICATE")

    repo = request.app.state.integrator_repo
    return await repo.submit_production_kyc(
        integrator["id"],
        business_location=body.business_location,
        tax_clearance_file_name=tax_doc["file_name"],
        rdb_certificate_file_name=rdb_doc["file_name"],
        ip_whitelist=body.ip_whitelist,
    )


def _transaction_out(row: dict) -> CollectionTransactionOut:
    return CollectionTransactionOut(
        id=str(row["id"]),
        idempotency_key=row["idempotency_key"],
        fineract_savings_account_id=row["fineract_savings_account_id"],
        provider=row["provider"],
        customer_account_number=row["customer_account_number"],
        customer_name=row["customer_name"],
        amount_rwf=row["amount_rwf"],
        status=row["status"],
        debit_transaction_id=row["fineract_debit_txn_id"],
        refund_transaction_id=row["fineract_refund_txn_id"],
        provider_transaction_reference=row["provider_transaction_reference"],
        created_at=row["created_at"].isoformat(),
    )


@router.get("/transactions", response_model=PaginatedTransactions)
async def list_transactions(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    integrator: dict = Depends(_current_integrator),
) -> PaginatedTransactions:
    """Transaction history scoped to the calling integrator's own collections,
    newest first. Intended for the self-service portal's history tab."""
    repo = request.app.state.transaction_log_repo
    rows, total = await repo.list_by_integrator(integrator["id"], page, page_size)
    return PaginatedTransactions(
        items=[_transaction_out(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# Webhook subscriptions
# ---------------------------------------------------------------------------

class WebhookCreate(BaseModel):
    callback_url: HttpUrl
    events: list[Literal["collection.success", "collection.failed", "collection.pending"]]


class WebhookOut(BaseModel):
    id: int
    callback_url: str
    events: list[str]
    secret_hint: str
    is_active: bool
    created_at: str


class WebhookCreatedOut(WebhookOut):
    secret: str


def _webhook_out(row: dict, full_secret: str | None = None) -> dict:
    secret = row["secret"]
    hint = secret[:8] + "..." if len(secret) > 8 else secret
    base = {
        "id": row["id"],
        "callback_url": row["callback_url"],
        "events": row["events"],
        "secret_hint": hint,
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"].isoformat(),
    }
    if full_secret is not None:
        base["secret"] = full_secret
    return base


@router.post("/webhooks", response_model=WebhookCreatedOut, status_code=201)
async def create_webhook(
    body: WebhookCreate,
    request: Request,
    integrator: dict = Depends(_current_integrator),
) -> WebhookCreatedOut:
    if not body.events:
        raise HTTPException(status_code=400, detail="Select at least one event to subscribe to.")
    secret = secrets.token_hex(32)
    repo = request.app.state.integrator_webhook_repo
    row = await repo.create(
        integrator_id=integrator["id"],
        callback_url=str(body.callback_url),
        events=list(body.events),
        secret=secret,
    )
    return WebhookCreatedOut(**_webhook_out(row, full_secret=secret))


@router.get("/webhooks", response_model=list[WebhookOut])
async def list_webhooks(
    request: Request,
    integrator: dict = Depends(_current_integrator),
) -> list[WebhookOut]:
    repo = request.app.state.integrator_webhook_repo
    rows = await repo.list_by_integrator(integrator["id"])
    return [WebhookOut(**_webhook_out(row)) for row in rows]


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: int,
    request: Request,
    integrator: dict = Depends(_current_integrator),
) -> Response:
    repo = request.app.state.integrator_webhook_repo
    deleted = await repo.delete(webhook_id, integrator["id"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Webhook not found.")
    return Response(status_code=204)
