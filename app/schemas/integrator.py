from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field, condecimal, field_validator

ProductionStatus = Literal["NOT_SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED"]
AccountMode = Literal["TEST", "PRODUCTION"]
# What can be uploaded through the KYC endpoint...
DocumentType = Literal["TAX_CLEARANCE", "RDB_CERTIFICATE"]
# ...and everything that can be stored/listed (incl. the profile picture).
StoredDocumentType = Literal["TAX_CLEARANCE", "RDB_CERTIFICATE", "PROFILE_IMAGE"]

_Pct = condecimal(gt=0, lt=100, decimal_places=2)


_EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
_USERNAME = r"^[A-Za-z0-9._-]+$"


class ProfileFields(BaseModel):
    """The LMBTech-style profile, shared by admin create and self-signup."""

    first_name: Optional[str] = Field(default=None, max_length=80)
    last_name: Optional[str] = Field(default=None, max_length=80)
    phone_number: Optional[str] = Field(default=None, max_length=20)
    username: Optional[str] = Field(default=None, min_length=3, max_length=60, pattern=_USERNAME)
    address: Optional[str] = Field(default=None, max_length=191)
    location: Optional[str] = Field(default=None, max_length=120)
    city: Optional[str] = Field(default=None, max_length=80)
    country: Optional[str] = Field(default="Rwanda", max_length=80)
    bank_name: Optional[str] = Field(default=None, max_length=120)
    bank_account: Optional[str] = Field(default=None, max_length=60, pattern=r"^[0-9A-Za-z -]*$")

    @field_validator("*", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("phone_number")
    @classmethod
    def _rwandan_phone(cls, v: Optional[str]) -> Optional[str]:
        # Stored as +2507XXXXXXXX so MoMo cash-outs can use it directly.
        if v is None:
            return v
        from app.schemas.payment import normalize_rw_phone

        return normalize_rw_phone(v)

    def profile_dict(self) -> dict:
        return {k: v for k, v in self.model_dump(include=set(ProfileFields.model_fields)).items() if v is not None}


class IntegratorCreate(ProfileFields):
    """Admin "New Integrator": company + full profile, optional portal login
    (email or username + password) and optional fee overrides."""

    name: str = Field(..., min_length=1, max_length=191, description="Company / business name")
    email: Optional[str] = Field(default=None, max_length=255, pattern=_EMAIL)
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    # Legacy column kept for the Fineract-based flow planned later.
    fee_percentage: condecimal(gt=0, decimal_places=2) = Decimal("2.20")
    # Optional overrides of the platform default fees (must be >= LMBTech cost).
    payment_fee_percentage: Optional[_Pct] = None
    payout_fee_percentage: Optional[_Pct] = None


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
    # Admin reset for an integrator who forgot their password.
    new_password: Optional[str] = Field(default=None, min_length=8, max_length=128)


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


class IntegratorSignupRequest(ProfileFields):
    """Self-signup application (like LMBTech's "Create one"): company, owner,
    contact and login are required; address and bank can be added later."""

    name: str = Field(..., min_length=1, max_length=191, description="Company / business name")
    email: str = Field(..., max_length=255, pattern=_EMAIL)
    password: str = Field(..., min_length=8, max_length=128)
    first_name: str = Field(..., min_length=1, max_length=80)
    last_name: str = Field(..., min_length=1, max_length=80)
    phone_number: str = Field(..., max_length=20)


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
