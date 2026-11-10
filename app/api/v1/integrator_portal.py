import logging
import secrets
from typing import Literal

import pymysql
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, HttpUrl

from app.config import settings
from app.schemas.integrator import (
    DocumentType,
    IntegratorDocumentOut,
    IntegratorLoginRequest,
    IntegratorOut,
    IntegratorSessionResponse,
    IntegratorSignupRequest,
    PasswordChange,
    ProductionKycSubmitRequest,
    ProfileUpdate,
    RotateKeysRequest,
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
    """Self-signup application (like LMBTech's "Create one"): company, owner,
    contact, login and optional address/bank. Starts in Test Mode with a
    sandbox key; going live requires documents + admin approval."""
    repo = request.app.state.integrator_repo
    integrator = None
    try:
        integrator = await repo.create(
            body.name.strip(), phone_number=body.phone_number, email=body.email.strip().lower(),
            password_hash=hash_password(body.password),
        )
        profile = body.profile_dict()
        profile.pop("phone_number", None)
        if profile:
            await repo.update_profile(integrator["id"], profile, allowed=repo.PROFILE_FIELDS + ("username",))
    except pymysql.err.IntegrityError as exc:
        if exc.args and exc.args[0] == 1062:
            if integrator is not None:
                await repo.delete(integrator["id"])
            text = str(exc.args[1]) if len(exc.args) > 1 else ""
            what = "username" if "username" in text else "phone number" if "phone" in text else "email"
            raise HTTPException(status_code=409, detail=f"An account with this {what} already exists") from exc
        raise

    integrator = await repo.get_by_id(integrator["id"])
    token = create_session_token(integrator["id"], settings.integrator_session_secret)
    return IntegratorSessionResponse(token=token, integrator=integrator)


@router.post("/login", response_model=IntegratorSessionResponse)
async def login(body: IntegratorLoginRequest, request: Request):
    repo = request.app.state.integrator_repo
    identifier = body.email.strip()
    # "Email or username", like LMBTech's own login.
    integrator = await repo.get_by_email(identifier) if "@" in identifier else await repo.get_by_username(identifier)
    if integrator is None or not integrator.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email/username or password")
    if not verify_password(body.password, integrator["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email/username or password")

    token = create_session_token(integrator["id"], settings.integrator_session_secret)
    return IntegratorSessionResponse(token=token, integrator=integrator)


@router.get("/me", response_model=IntegratorOut)
async def me(integrator: dict = Depends(_current_integrator)):
    return integrator


@router.patch("/me", response_model=IntegratorOut)
async def update_my_profile(body: ProfileUpdate, request: Request, integrator: dict = Depends(_current_integrator)):
    """Profile + bank details. Email, phone, username and Account Mode are
    admin-only (the page says "contact an admin")."""
    data = body.model_dump(exclude_unset=True)
    if "company" in data:
        data["name"] = data.pop("company")
    repo = request.app.state.integrator_repo
    return await repo.update_profile(integrator["id"], data, allowed=repo.PROFILE_FIELDS)


@router.post("/me/password", status_code=204)
async def change_my_password(body: PasswordChange, request: Request, integrator: dict = Depends(_current_integrator)):
    if not integrator.get("password_hash") or not verify_password(body.current_password, integrator["password_hash"]):
        raise HTTPException(status_code=400, detail="Your current password is not correct")
    await request.app.state.integrator_repo.set_password_hash(integrator["id"], hash_password(body.new_password))
    return Response(status_code=204)


@router.post("/me/rotate-keys", response_model=IntegratorOut)
async def rotate_my_keys(body: RotateKeysRequest, request: Request, integrator: dict = Depends(_current_integrator)):
    """New sandbox key (and production key, if any). The old keys stop
    working immediately, so the current password is required."""
    if not integrator.get("password_hash") or not verify_password(body.current_password, integrator["password_hash"]):
        raise HTTPException(status_code=400, detail="Your current password is not correct")
    logger.warning("integrator_keys_rotated", extra={"integrator_id": integrator["id"]})
    return await request.app.state.integrator_repo.rotate_keys(integrator["id"])


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}


@router.post("/me/profile-image", status_code=204)
async def upload_profile_image(
    request: Request, file: UploadFile = File(...), integrator: dict = Depends(_current_integrator)
):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Use a JPG or PNG image")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The image is empty")
    if len(data) > MAX_DOCUMENT_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large - max 5MB")
    await request.app.state.integrator_document_repo.upsert(
        integrator["id"], "PROFILE_IMAGE", file.filename or "profile", file.content_type, data
    )
    return Response(status_code=204)


@router.get("/me/profile-image")
async def get_profile_image(request: Request, integrator: dict = Depends(_current_integrator)):
    doc = await request.app.state.integrator_document_repo.get(integrator["id"], "PROFILE_IMAGE")
    if doc is None:
        raise HTTPException(status_code=404, detail="No profile image")
    return Response(content=doc["file_data"], media_type=doc["content_type"], headers={"Cache-Control": "private, max-age=60"})


@router.delete("/me/profile-image", status_code=204)
async def delete_profile_image(request: Request, integrator: dict = Depends(_current_integrator)):
    await request.app.state.integrator_document_repo.delete(integrator["id"], "PROFILE_IMAGE")
    return Response(status_code=204)


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


async def _go_live_checklist(request: Request, integrator: dict) -> dict:
    """What an integrator must finish before its live key works. The sandbox
    items prove the integration end to end (card redirect + MoMo approval +
    status/webhook handling) before any real customer pays."""
    tested = await request.app.state.payment_repo.sandbox_successes(integrator["id"])
    docs = request.app.state.integrator_document_repo
    has_docs = await docs.has_all_required(integrator["id"])
    items = [
        {"key": "sandbox_card", "label": "A successful test card payment in the sandbox", "done": tested["CARD"] > 0},
        {"key": "sandbox_momo", "label": "A successful test MTN MoMo payment in the sandbox", "done": tested["MOMO"] > 0},
        {"key": "documents", "label": "Tax clearance and RDB certificates uploaded", "done": has_docs},
    ]
    return {
        "items": items,
        "ready": all(i["done"] for i in items),
        "auto_go_live": request.app.state.settings.integrator_auto_go_live,
    }


@router.get("/production/checklist")
async def production_checklist(request: Request, integrator: dict = Depends(_current_integrator)):
    return await _go_live_checklist(request, integrator)


@router.post("/production/submit", response_model=IntegratorOut)
async def submit_production_kyc(
    body: ProductionKycSubmitRequest,
    request: Request,
    integrator: dict = Depends(_current_integrator),
):
    """Go live. With INTEGRATOR_AUTO_GO_LIVE (default) an integrator whose
    checklist is complete is switched to Production at once - like LMBTech,
    no waiting. Otherwise it's queued for an admin to review."""
    checklist = await _go_live_checklist(request, integrator)
    if not checklist["ready"]:
        missing = "; ".join(i["label"] for i in checklist["items"] if not i["done"])
        raise HTTPException(status_code=400, detail=f"Not ready to go live yet - still needed: {missing}")
    document_repo = request.app.state.integrator_document_repo
    tax_doc = await document_repo.get(integrator["id"], "TAX_CLEARANCE")
    rdb_doc = await document_repo.get(integrator["id"], "RDB_CERTIFICATE")

    repo = request.app.state.integrator_repo
    row = await repo.submit_production_kyc(
        integrator["id"],
        business_location=body.business_location,
        tax_clearance_file_name=tax_doc["file_name"],
        rdb_certificate_file_name=rdb_doc["file_name"],
        ip_whitelist=body.ip_whitelist,
    )
    if checklist["auto_go_live"]:
        row = await repo.approve_production(integrator["id"])
        logger.info("integrator_auto_go_live", extra={"integrator_id": integrator["id"]})
    return row


# Transaction history now lives in the LMBTech ledger:
# GET /api/v1/integrator-portal/payments (app/api/v1/payments.py).


# ---------------------------------------------------------------------------
# Webhook subscriptions
# ---------------------------------------------------------------------------

class WebhookCreate(BaseModel):
    callback_url: HttpUrl
    events: list[
        Literal[
            "payment.success",
            "payment.failed",
            "disbursement.success",
            "disbursement.failed",
        ]
    ]


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
