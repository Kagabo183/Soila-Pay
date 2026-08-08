from datetime import datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field, condecimal

ProductionStatus = Literal["NOT_SUBMITTED", "PENDING_REVIEW", "APPROVED", "REJECTED"]
DocumentType = Literal["TAX_CLEARANCE", "RDB_CERTIFICATE"]


class IntegratorCreate(BaseModel):
    name: str = Field(..., min_length=1)
    # "2.20 for start" per the founder's brief (DDIN charges Soila Pay 2%,
    # target margin 0.2%) - a sane default, not a hardcode: it's still a
    # per-row DB value, editable later via IntegratorUpdate.
    fee_percentage: condecimal(gt=0, decimal_places=2) = Decimal("2.20")
    # Optional: set both together to also hand the integrator working
    # self-service portal login credentials (POST /api/v1/integrator-portal/login)
    # instead of making them sign up themselves at /portal/signup.
    phone_number: Optional[str] = Field(default=None, min_length=8, max_length=20)
    password: Optional[str] = Field(default=None, min_length=8)


class IntegratorUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    fee_percentage: Optional[condecimal(gt=0, decimal_places=2)] = None
    is_active: Optional[bool] = None
    # See IntegratorOut.sandbox_uses_real_provider - a per-integrator,
    # admin-toggled override, off by default for everyone.
    sandbox_uses_real_provider: Optional[bool] = None


class IntegratorOut(BaseModel):
    id: int
    name: str
    sandbox_api_key: str
    production_api_key: Optional[str] = None
    production_status: ProductionStatus
    production_rejection_reason: Optional[str] = None
    phone_number: Optional[str] = None
    business_location: Optional[str] = None
    # Filenames of the uploaded documents (for quick display without a join) -
    # the actual file bytes live in integrator_documents, fetched via
    # GET /api/v1/admin/integrators/{id}/documents/{document_type} or
    # GET /api/v1/integrator-portal/production/documents.
    tax_clearance_reference: Optional[str] = None
    rdb_certificate_reference: Optional[str] = None
    ip_whitelist: Optional[str] = None
    # float, not Decimal: this is an output-only field, and Pydantic v2
    # serializes Decimal to a JSON *string* (to preserve precision) rather
    # than a number - which silently breaks any frontend code expecting a
    # number (e.g. `.toFixed()`). The database column and every internal
    # calculation still use Decimal (see IntegratorCreate/IntegratorUpdate,
    # and collection_orchestrator.py) - this only affects the API response.
    fee_percentage: float
    is_active: bool
    # When true, THIS integrator's sandbox key also routes through the real
    # Fineract + real DDIN collection provider, not the safe internal
    # simulator - a per-row DB flag (see db_init/008_*.sql), never hardcoded
    # by name or ID. Off by default; intended for Soila Pay's own house
    # account so its own test transactions are visible on DDIN's dashboard,
    # while every other (especially self-signed-up) integrator keeps a
    # sandbox that never touches DDIN or spends real quota.
    sandbox_uses_real_provider: bool
    created_at: datetime
    updated_at: datetime


class IntegratorSummary(BaseModel):
    integrator_id: int
    integrator_name: str
    # float, not Decimal - see the comment on IntegratorOut.fee_percentage.
    current_fee_percentage: float
    successful_transactions: int
    total_collected_rwf: float
    total_fee_charged_rwf: float
    total_ddin_cost_rwf: float
    total_margin_rwf: float


class DdinCostSetting(BaseModel):
    # float, not condecimal - see the comment on IntegratorOut.fee_percentage.
    # This model doubles as the PATCH request body, so this does trade away
    # exact decimal_places=2 input validation - acceptable here since it's a
    # percentage config knob, not a monetary amount.
    ddin_cost_percentage: float = Field(gt=0)


# -- Self-service portal (app/api/v1/integrator_portal.py) -------------------


class IntegratorSignupRequest(BaseModel):
    name: str = Field(..., min_length=1, description="Business or contact name")
    phone_number: str = Field(..., min_length=8, max_length=20)
    password: str = Field(..., min_length=8)


class IntegratorLoginRequest(BaseModel):
    phone_number: str = Field(..., min_length=8, max_length=20)
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
    document_type: DocumentType
    file_name: str
    content_type: str
    file_size_bytes: int
    uploaded_at: datetime
