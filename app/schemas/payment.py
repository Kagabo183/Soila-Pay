import re
from typing import Literal, Optional

from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

# What the customer picks. MTN_MOMO / AIRTEL_MONEY -> mobile money (Kitovu
# Pay; MTN can also fall back to LMBTech); the card options all go to
# LMBTech's hosted card page (Visa, Mastercard, and anything else Pesapal
# accepts) - the choice is recorded so dashboards can show it.
PaymentChannel = Literal["MTN_MOMO", "AIRTEL_MONEY", "VISA", "MASTERCARD", "OTHER_CARD"]
PaymentStatus = Literal["PENDING", "SUCCESS", "FAILED", "CANCELLED"]

CARD_CHANNELS = {"VISA", "MASTERCARD", "OTHER_CARD"}
MOMO_CHANNELS = {"MTN_MOMO", "AIRTEL_MONEY"}
_MTN_PREFIXES = ("78", "79")
_AIRTEL_PREFIXES = ("72", "73")


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
    # Required for MTN_MOMO / AIRTEL_MONEY.
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
        if self.channel in MOMO_CHANNELS:
            if not self.customer_phone:
                raise ValueError("Phone number is required for Mobile Money")
            phone = normalize_rw_phone(self.customer_phone)
            # Refuse a number on the other network now, instead of sending a
            # prompt that never reaches the customer's phone.
            if self.channel == "MTN_MOMO" and not phone[4:].startswith(_MTN_PREFIXES):
                raise ValueError("MTN numbers start with 078 or 079")
            if self.channel == "AIRTEL_MONEY" and not phone[4:].startswith(_AIRTEL_PREFIXES):
                raise ValueError("Airtel numbers start with 072 or 073")
            self.customer_phone = phone
        elif self.customer_phone:
            self.customer_phone = normalize_rw_phone(self.customer_phone)
        return self


class DisbursementCreate(BaseModel):
    """Send money to a customer's mobile money number: MTN (078/079) or
    Airtel (072/073, Kitovu Pay only)."""

    amount_rwf: int = Field(..., ge=100, le=5_000_000, description="Whole Rwandan francs")
    recipient_name: str = Field(..., min_length=2, max_length=120)
    recipient_phone: str = Field(..., description="MTN or Airtel number, e.g. 0788123456")
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
    def _momo_number(cls, v: str) -> str:
        phone = normalize_rw_phone(v)
        if not phone[4:].startswith(_MTN_PREFIXES + _AIRTEL_PREFIXES):
            raise ValueError("Payouts go to MTN (078/079) or Airtel (072/073) numbers")
        return phone


Direction = Literal["COLLECTION", "DISBURSEMENT"]


class PaymentOut(BaseModel):
    reference_id: str
    direction: Direction
    # True when an integrator withdrew their own balance (Cashout to MoMo/Bank).
    is_cashout: bool = False
    status: PaymentStatus
    status_message: Optional[str] = None
    method: Literal["MOMO", "CARD", "BANK"]
    channel: str
    amount_rwf: float
    # What the integrator is charged on this transaction.
    fee_percentage: Optional[float] = None
    fee_amount_rwf: Optional[float] = None
    # Admin only (None for integrators): LMBTech's cut and what Soila Pay keeps.
    gateway_cost_percentage: Optional[float] = None
    gateway_cost_amount_rwf: Optional[float] = None
    margin_amount_rwf: Optional[float] = None
    # Admin only: the amount LMBTech reports for this transaction (observed to
    # include LMBTech's own fee on top), whether a reconciliation corrected
    # this row, and whether it was imported from LMBTech.
    gateway_amount_rwf: Optional[float] = None
    reconciled: bool = False
    imported: bool = False
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
    # Airtel Money can be offered (Kitovu is on, or this is the sandbox).
    airtel_available: bool = False
    # Who handles MoMo collections right now: KITOVU or LMBTECH.
    momo_gateway: str = "LMBTECH"
    # Admin: Kitovu's TEST gateway is set up (Test Lab "Kitovu test").
    kitovu_test_available: bool = False
    # Which ledger these numbers are from (the screen's Live/Test choice).
    test_mode: bool
    # Where NEW payments/payouts from this account go right now (test or
    # real money) - independent of which ledger is being viewed.
    account_test_mode: bool = False
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
    """Admin: what each gateway takes and the default fees integrators pay.
    gateway_cost_percentage = cards (LMBTech); momo_cost_percentage = mobile
    money collections (Kitovu Pay)."""

    gateway_cost_percentage: float = Field(..., ge=0, lt=100)
    momo_cost_percentage: float = Field(default=3.0, ge=0, lt=100)
    # Kitovu charges a flat amount per payout (400 RWF on UAT), not a %.
    momo_payout_cost_rwf: float = Field(default=400.0, ge=0, le=100_000)
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


class CashoutRequest(BaseModel):
    """Integrator withdrawing their own balance, like LMBTech's Cashout buttons."""

    destination: Literal["MOMO", "BANK"]
    amount_rwf: int = Field(..., ge=100, le=5_000_000)


class SettleCashout(BaseModel):
    """Admin decision on a bank cash-out: paid (note = bank transfer
    reference) or rejected (note = reason; money returns to the balance)."""

    paid: bool
    note: str = Field(..., min_length=2, max_length=120)


class PeriodSummary(BaseModel):
    """LMBTech-style header for a date range: Available Balance, Total Net,
    Total Withdraw, Remaining Balance."""

    date_from: Optional[str] = None
    date_to: Optional[str] = None
    # All-time money the integrator can withdraw now (portal only).
    available_balance_rwf: Optional[float] = None
    gross_rwf: float  # successful collections in the period
    net_rwf: float  # ...minus their fees
    withdrawn_rwf: float  # payouts + cash-outs in the period (incl. pending) + fees
    remaining_rwf: float  # net - withdrawn, for the period
    pending_bank_rwf: float  # bank cash-outs waiting for Soila Pay
    transactions: int


class ReconcileChange(BaseModel):
    reference_id: str
    name: str
    amount_rwf: float
    from_status: str
    to_status: str


class ReconcileReport(BaseModel):
    checked: int
    corrected: list[ReconcileChange]
    errors: list[dict]


class MomoLookupRequest(BaseModel):
    """Before charging: whose MoMo wallet is this, and what will it cost?"""

    channel: Literal["MTN_MOMO", "AIRTEL_MONEY"] = "MTN_MOMO"
    phone: str
    amount_rwf: int = Field(..., ge=100, le=5_000_000)

    @model_validator(mode="after")
    def _network(self) -> "MomoLookupRequest":
        phone = normalize_rw_phone(self.phone)
        if self.channel == "MTN_MOMO" and not phone[4:].startswith(_MTN_PREFIXES):
            raise ValueError("MTN numbers start with 078 or 079")
        if self.channel == "AIRTEL_MONEY" and not phone[4:].startswith(_AIRTEL_PREFIXES):
            raise ValueError("Airtel numbers start with 072 or 073")
        self.phone = phone
        return self


class MomoLookupOut(BaseModel):
    phone: str
    # The name registered on the wallet (None = couldn't be checked).
    account_name: Optional[str] = None
    verified: bool = False
    amount_rwf: int
    # What the customer pays on top of the amount (Kitovu's subscriber charges).
    customer_fee_rwf: float = 0
    total_to_pay_rwf: float
    gateway: str


class ImportRequest(BaseModel):
    """Add a transaction that exists only at LMBTech (made outside Soila Pay)."""

    reference_id: str = Field(..., min_length=3, max_length=64)
    # The NET amount from LMBTech's dashboard (their status API reports a
    # different, fee-inclusive number).
    amount_rwf: int = Field(..., ge=1, le=5_000_000)
    channel: Literal["VISA", "MASTERCARD", "OTHER_CARD", "MTN"] = "OTHER_CARD"
    description: str = Field(default="Imported from LMBTech", max_length=120)
    # DISBURSEMENT = a payout sent from LMBTech's dashboard (MTN MoMo only).
    # CASHOUT = money Soila Pay withdrew from its own LMBTech balance using
    # LMBTech's "Cashout" (to MoMo or to a bank account).
    direction: Literal["COLLECTION", "DISBURSEMENT", "CASHOUT"] = "COLLECTION"
    # Payouts / MoMo cash-outs: who received it (optional - LMBTech's status gives the name).
    recipient_phone: Optional[str] = None
    # Cash-outs only: where the money went.
    cashout_to: Literal["MOMO", "BANK"] = "MOMO"

    @field_validator("recipient_phone", mode="before")
    @classmethod
    def _phone(cls, v):
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return normalize_rw_phone(v)

    @model_validator(mode="after")
    def _payout_is_momo(self) -> "ImportRequest":
        if self.direction == "DISBURSEMENT" or (self.direction == "CASHOUT" and self.cashout_to == "MOMO"):
            self.channel = "MTN"  # LMBTech payouts / MoMo cash-outs only go to MTN MoMo
        elif self.direction == "CASHOUT":
            self.channel = "BANK"
        return self


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
