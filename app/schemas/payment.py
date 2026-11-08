import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

# What the customer picks. MTN_MOMO -> MTN Mobile Money; the card options all
# go to the same hosted card page (Visa, Mastercard, and anything else
# Pesapal accepts) - the choice is recorded so dashboards can show it.
PaymentChannel = Literal["MTN_MOMO", "VISA", "MASTERCARD", "OTHER_CARD"]
PaymentStatus = Literal["PENDING", "SUCCESS", "FAILED", "CANCELLED"]

CARD_CHANNELS = {"VISA", "MASTERCARD", "OTHER_CARD"}
_MTN_PREFIXES = ("78", "79")


def normalize_rw_phone(value: str) -> str:
    """Accepts 0788123456, 788123456, 250788123456, +250 788 123 456 ->
    +250788123456. Raises ValueError with a customer-friendly message."""
    digits = re.sub(r"\D", "", value or "")
    if digits.startswith("250"):
        digits = digits[3:]
    elif digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 9 or not digits.startswith("7"):
        raise ValueError("Enter a Rwandan phone number like 0788 123 456")
    return "+250" + digits


class PaymentCreate(BaseModel):
    channel: PaymentChannel
    amount_rwf: int = Field(..., ge=100, le=5_000_000, description="Whole Rwandan francs")
    customer_name: str = Field(..., min_length=2, max_length=120)
    customer_email: str = Field(..., max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    # Required for MTN_MOMO only.
    customer_phone: Optional[str] = None
    description: str = Field(default="payment", max_length=120)
    # Optional: your own reference (unique). Generated if omitted.
    reference_id: Optional[str] = Field(default=None, min_length=6, max_length=60, pattern=r"^[A-Za-z0-9_-]+$")
    # Optional: where to send a card payer after they finish (your site).
    return_url: Optional[HttpUrl] = None

    @field_validator("customer_name", "description", "customer_email", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _phone_for_momo(self) -> "PaymentCreate":
        if self.channel == "MTN_MOMO":
            if not self.customer_phone:
                raise ValueError("Phone number is required for Mobile Money")
            phone = normalize_rw_phone(self.customer_phone)
            if not phone[4:].startswith(_MTN_PREFIXES):
                raise ValueError("MTN numbers start with 078 or 079")
            self.customer_phone = phone
        elif self.customer_phone:
            self.customer_phone = normalize_rw_phone(self.customer_phone)
        return self


class DisbursementCreate(BaseModel):
    """Send money to a customer's MTN Mobile Money number (LMBTech payout)."""

    amount_rwf: int = Field(..., ge=100, le=5_000_000, description="Whole Rwandan francs")
    recipient_name: str = Field(..., min_length=2, max_length=120)
    recipient_phone: str = Field(..., description="MTN number, e.g. 0788123456")
    recipient_email: Optional[str] = Field(default=None, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    description: str = Field(default="payout", max_length=120)
    reference_id: Optional[str] = Field(default=None, min_length=6, max_length=60, pattern=r"^[A-Za-z0-9_-]+$")

    @field_validator("recipient_name", "description", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("recipient_email", mode="before")
    @classmethod
    def _blank_email_is_none(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("recipient_phone")
    @classmethod
    def _mtn_only(cls, v: str) -> str:
        phone = normalize_rw_phone(v)
        if not phone[4:].startswith(_MTN_PREFIXES):
            raise ValueError("Payouts go to MTN numbers only (078 or 079)")
        return phone


Direction = Literal["COLLECTION", "DISBURSEMENT"]


class PaymentOut(BaseModel):
    reference_id: str
    direction: Direction
    status: PaymentStatus
    status_message: Optional[str] = None
    method: Literal["MOMO", "CARD"]
    channel: str
    amount_rwf: float
    # What the integrator is charged on this transaction.
    fee_percentage: Optional[float] = None
    fee_amount_rwf: Optional[float] = None
    # Admin only (None for integrators): LMBTech's cut and what Soila Pay keeps.
    gateway_cost_percentage: Optional[float] = None
    gateway_cost_amount_rwf: Optional[float] = None
    margin_amount_rwf: Optional[float] = None
    # Collections: the payer. Disbursements: the recipient.
    customer_name: str
    customer_email: str
    customer_phone: Optional[str] = None
    description: str
    gateway: str
    gateway_transaction_id: Optional[str] = None
    # CARD + PENDING: send the customer here to enter card details.
    redirect_url: Optional[str] = None
    is_test: bool
    integrator_id: Optional[int] = None
    integrator_name: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None


class PublicPaymentOut(BaseModel):
    """What the public receipt page (/pay/return) may show - no email/phone."""

    reference_id: str
    status: PaymentStatus
    status_message: Optional[str] = None
    method: Literal["MOMO", "CARD"]
    channel: str
    amount_rwf: float
    customer_name: str
    description: str
    is_test: bool
    created_at: str
    completed_at: Optional[str] = None
    return_url: Optional[str] = None


class PaginatedPayments(BaseModel):
    items: list[PaymentOut]
    total: int
    page: int
    page_size: int


class PaymentSummary(BaseModel):
    collected_rwf: float
    disbursed_rwf: float
    fees_rwf: float
    momo_rwf: float
    card_rwf: float
    # Counts follow the `direction` the summary was asked for.
    success_count: int
    pending_count: int
    failed_count: int
    total_count: int
    gateway_configured: bool
    payouts_configured: bool
    test_mode: bool
    # Portal: this integrator's fees and what it can still pay out.
    fee_percentage: Optional[float] = None
    payout_fee_percentage: Optional[float] = None
    available_balance_rwf: Optional[float] = None
    # Admin only (None in the portal).
    gateway_cost_percentage: Optional[float] = None
    payout_cost_percentage: Optional[float] = None
    gateway_cost_rwf: Optional[float] = None
    margin_rwf: Optional[float] = None
    integrators_below_cost: Optional[int] = None


class PaymentPricing(BaseModel):
    """Admin: LMBTech's cut and the default fees integrators pay."""

    gateway_cost_percentage: float = Field(..., ge=0, lt=100)
    default_fee_percentage: float = Field(..., gt=0, lt=100)
    payout_cost_percentage: float = Field(..., ge=0, lt=100)
    payout_default_fee_percentage: float = Field(..., gt=0, lt=100)


class IntegratorPaymentFee(BaseModel):
    id: int
    name: str
    payment_fee_percentage: Optional[float]  # None = uses the default
    effective_fee_percentage: float
    payout_fee_percentage: Optional[float]
    effective_payout_fee_percentage: float
    below_cost: bool


class PaymentPricingOut(PaymentPricing):
    integrators: list[IntegratorPaymentFee]


class OverviewDay(BaseModel):
    date: str
    collected: float
    disbursed: float
    failed: int


class OverviewChannel(BaseModel):
    channel: str
    amount_rwf: float
    count: int


class OverviewToday(BaseModel):
    collected_rwf: float
    disbursed_rwf: float
    margin_rwf: Optional[float] = None  # admin only
    success_count: int
    failed_count: int
    pending_count: int
    # None when nothing finished yet today - never a fake 0% / 100%.
    success_rate: Optional[float] = None


class Overview(BaseModel):
    days: int
    series: list[OverviewDay]
    channels: list[OverviewChannel]
    today: OverviewToday
    recent: list[PaymentOut]
