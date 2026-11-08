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


class PaymentOut(BaseModel):
    reference_id: str
    status: PaymentStatus
    status_message: Optional[str] = None
    method: Literal["MOMO", "CARD"]
    channel: str
    amount_rwf: float
    fee_amount_rwf: Optional[float] = None
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
    fees_rwf: float
    momo_rwf: float
    card_rwf: float
    success_count: int
    pending_count: int
    failed_count: int
    total_count: int
    gateway_configured: bool
    test_mode: bool
