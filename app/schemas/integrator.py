from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field, condecimal

ProductionStatus = Literal["NOT_SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED"]
AccountMode = Literal["TEST", "PRODUCTION"]
# What can be uploaded through the KYC endpoint...
DocumentType = Literal["TAX_CLEARANCE", "RDB_CERTIFICATE"]
# ...and everything that can be stored/listed (incl. the profile picture).
StoredDocumentType = Literal["TAX_CLEARANCE", "RDB_CERTIFICATE", "PROFILE_IMAGE"]

_Pct = condecimal(gt=0, lt=100, decimal_places=2)


class IntegratorCreate(BaseModel):
    name: str = Field(..., min_length=1)
    # Legacy column kept for the Fineract-based flow planned later; checkout
    # payments and payouts use payment_fee_percentage / payout_fee_percentage
    # (or the platform defaults on the Pricing page).
    fee_percentage: condecimal(gt=0, decimal_places=2) = Decimal("2.20")
    # Optional: set both together to also hand the integrator working
    # self-service portal login credentials (POST /api/v1/integrator-portal/login)
    # instead of making them sign up themselves at /portal/signup.
    phone_number: Optional[str] = Field(default=None, min_length=8, max_length=20)
    email: Optional[str] = Field(default=None, max_length=255)
    password: Optional[str] = Field(default=None, min_length=8)


class IntegratorUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    fee_percentage: Optional[condecimal(gt=0, decimal_places=2)] = None
    # Collections (payments) and payouts fee overrides. Must be >= LMBTech's
    # cost - enforced in the route. clear_* = fall back to the platform default.
    payment_fee_percentage: Optional[_Pct] = None
    clear_payment_fee: bool = False
    payout_fee_percentage: Optional[_Pct] = None
    clear_payout_fee: bool = False
    is_active: Optional[bool] = None
    # Admin-only identity fields (the integrator sees "contact an admin").
    email: Optional[str] = Field(default=None, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone_number: Optional[str] = Field(default=None, min_length=8, max_length=20)
    username: Optional[str] = Field(default=None, min_length=3, max_length=60, pattern=r"^[A-Za-z0-9._-]+$")
    account_mode: Optional[AccountMode] = None


class ProfileUpdate(BaseModel):
    """What an integrator may change themselves (portal Account page)."""

    first_name: Optional[str] = Field(default=None, max_length=80)
    last_name: Optional[str] = Field(default=None, max_length=80)
    company: Optional[str] = Field(default=None, min_length=1, max_length=191)
    address: Optional[str] = Field(default=None, max_length=191)
    location: Optional[str] = Field(default=None, max_length=120)
    city: Optional[str] = Field(default=None, max_length=80)
    country: Optional[str] = Field(default=None, max_length=80)
    bank_name: Optional[str] = Field(default=None, max_length=120)
    bank_account: Optional[str] = Field(default=None, max_length=60, pattern=r"^[0-9A-Za-z -]*$")


class PasswordChange(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=128)


class RotateKeysRequest(BaseModel):
    """Regenerating keys breaks every integration using the old ones, so it
    requires the current password."""

    current_password: str = Field(..., min_length=1)


class IntegratorOut(BaseModel):
    id: int
    name: str
    sandbox_api_key: str
    production_api_key: Optional[str] = None
    production_status: ProductionStatus
    production_rejection_reason: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[str] = None
    business_location: Optional[str] = None
    # Filenames of the uploaded documents (for quick display without a join) -
    # the actual file bytes live in integrator_documents.
    tax_clearance_reference: Optional[str] = None
    rdb_certificate_reference: Optional[str] = None
    ip_whitelist: Optional[str] = None
    # float, not Decimal: Pydantic v2 serializes Decimal to a JSON *string*,
    # which breaks frontend arithmetic. DB + internal math stay Decimal.
    fee_percentage: float
    # None = the platform default (Pricing page) applies.
    payment_fee_percentage: Optional[float] = None
    payout_fee_percentage: Optional[float] = None
    is_active: bool
    # Profile (portal Account page).
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    address: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    account_mode: AccountMode = "TEST"
    keys_rotated_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class IntegratorSummary(BaseModel):
    """Per-integrator totals from the LMBTech ledger (SUCCESS rows only)."""

    integrator_id: int
    integrator_name: str
    successful_transactions: int
    total_collected_rwf: float
    total_disbursed_rwf: float
    total_fee_charged_rwf: float
    total_gateway_cost_rwf: float
    total_margin_rwf: float


# -- Self-service portal (app/api/v1/integrator_portal.py) -------------------


class IntegratorSignupRequest(BaseModel):
    name: str = Field(..., min_length=1, description="Business or contact name")
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=8)


class IntegratorLoginRequest(BaseModel):
    email: str = Field(..., max_length=255)
    password: str = Field(..., min_length=1)


class IntegratorSessionResponse(BaseModel):
    token: str
    integrator: IntegratorOut


class ProductionKycSubmitRequest(BaseModel):
    """Both TAX_CLEARANCE and RDB_CERTIFICATE documents must already be
    uploaded (POST /production/documents) before this is accepted - see the
    has_all_required check in the submit route."""

    business_location: str = Field(..., min_length=1)
    ip_whitelist: Optional[str] = None


class ProductionReviewDecision(BaseModel):
    reason: Optional[str] = None


class IntegratorDocumentOut(BaseModel):
    document_type: StoredDocumentType
    file_name: str
    content_type: str
    file_size_bytes: int
    uploaded_at: datetime
