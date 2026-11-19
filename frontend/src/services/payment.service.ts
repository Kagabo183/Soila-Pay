import { apiClient } from "@/lib/axios";
import { currentMoneyView } from "@/store/money-view-store";
import { currentIntegratorFilter } from "@/store/integrator-filter-store";

/** Everything money-related goes through LMBTech, on the real API only (no
 * mocks): collections (cards first - Visa, Mastercard, other - plus MTN
 * MoMo) and disbursements (payouts to MTN MoMo). Both live in one ledger. */
export type PaymentChannel = "VISA" | "MASTERCARD" | "OTHER_CARD" | "MTN_MOMO" | "AIRTEL_MONEY";
export type PaymentStatus = "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED";
export type Direction = "COLLECTION" | "DISBURSEMENT";

export interface Payment {
  referenceId: string;
  direction: Direction;
  /** The integrator withdrew their own balance (Cashout to MoMo / Bank). */
  isCashout: boolean;
  status: PaymentStatus;
  statusMessage: string | null;
  method: "MOMO" | "CARD" | "BANK";
  channel: string;
  amountRwf: number;
  feePercentage: number | null;
  feeAmountRwf: number | null;
  /** Admin only - null for integrators. */
  gatewayCostPercentage: number | null;
  gatewayCostAmountRwf: number | null;
  marginAmountRwf: number | null;
  /** Admin only: the amount LMBTech reports (includes LMBTech's own fee). */
  gatewayAmountRwf: number | null;
  /** A check against LMBTech corrected this row. */
  reconciled: boolean;
  /** Added from LMBTech because it was made outside Soila Pay. */
  imported: boolean;
  /** Collections: the payer. Disbursements: the recipient. */
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  description: string;
  /** Who moved the money: LMBTECH (cards), KITOVU (mobile money), SANDBOX, MANUAL. */
  gateway: string;
  /** How it was started: API / PORTAL / CONSOLE / TEST_LAB / IMPORT / UNKNOWN. */
  source: string | null;
  /** Who started it (integrator + key type, or the admin). */
  actor: string | null;
  /** Admin only: the IP address it was started from. */
  clientIp: string | null;
  gatewayTransactionId: string | null;
  redirectUrl: string | null;
  isTest: boolean;
  integratorName: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PublicPayment {
  referenceId: string;
  status: PaymentStatus;
  statusMessage: string | null;
  method: "MOMO" | "CARD";
  channel: string;
  amountRwf: number;
  customerName: string;
  description: string;
  isTest: boolean;
  createdAt: string;
  completedAt: string | null;
  returnUrl: string | null;
}

export interface PaymentSummary {
  collectedRwf: number;
  disbursedRwf: number;
  feesRwf: number;
  momoRwf: number;
  cardRwf: number;
  successCount: number;
  pendingCount: number;
  failedCount: number;
  totalCount: number;
  gatewayConfigured: boolean;
  payoutsConfigured: boolean;
  /** Airtel Money can be offered (Kitovu Pay is on, or sandbox). */
  airtelAvailable: boolean;
  /** Admin: Kitovu's TEST gateway is set up (Test Lab "Kitovu test"). */
  kitovuTestAvailable: boolean;
  /** Who handles MoMo collections: KITOVU or LMBTECH. */
  momoGateway: string;
  /** The ledger these numbers come from (the Live/Test money switch). */
  testMode: boolean;
  /** Where NEW payments/payouts from this account go (test or real money). */
  accountTestMode: boolean;
  /** Portal only. */
  feePercentage: number | null;
  payoutFeePercentage: number | null;
  availableBalanceRwf: number | null;
  /** Admin only. */
  gatewayCostPercentage: number | null;
  payoutCostPercentage: number | null;
  gatewayCostRwf: number | null;
  marginRwf: number | null;
  integratorsBelowCost: number | null;
}

export interface Overview {
  days: number;
  series: { date: string; collected: number; disbursed: number; failed: number }[];
  channels: { channel: string; amountRwf: number; count: number }[];
  today: {
    collectedRwf: number;
    disbursedRwf: number;
    marginRwf: number | null;
    successCount: number;
    failedCount: number;
    pendingCount: number;
    /** null when nothing finished today - never a fake 0% / 100%. */
    successRate: number | null;
  };
  recent: Payment[];
}

export interface ReconcileReport {
  checked: number;
  corrected: { referenceId: string; name: string; amountRwf: number; fromStatus: string; toStatus: string }[];
  errors: number;
}

export interface IntegratorPaymentFee {
  id: number;
  name: string;
  paymentFeePercentage: number | null;
  effectiveFeePercentage: number;
  payoutFeePercentage: number | null;
  effectivePayoutFeePercentage: number;
  belowCost: boolean;
}

export interface PaymentPricing {
  /** Cards - LMBTech's cut. */
  gatewayCostPercentage: number;
  /** Mobile money collections - Kitovu Pay's cut. */
  momoCostPercentage: number;
  /** Kitovu Pay's flat fee per mobile money payout (RWF). */
  momoPayoutCostRwf: number;
  defaultFeePercentage: number;
  payoutCostPercentage: number;
  payoutDefaultFeePercentage: number;
  integrators: IntegratorPaymentFee[];
}

export interface PaymentCreatePayload {
  channel: PaymentChannel;
  amountRwf: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  description?: string;
}

export interface DisbursementCreatePayload {
  amountRwf: number;
  recipientName: string;
  recipientPhone: string;
  recipientEmail?: string;
  description?: string;
}

export interface LedgerQuery {
  page?: number;
  pageSize?: number;
  direction?: Direction;
  status?: PaymentStatus;
  method?: "MOMO" | "CARD" | "BANK";
  q?: string;
  /** YYYY-MM-DD, inclusive. */
  dateFrom?: string;
  dateTo?: string;
  cashout?: boolean;
}

/** LMBTech-style header for a date range. */
export interface PeriodSummary {
  availableBalanceRwf: number | null;
  grossRwf: number;
  netRwf: number;
  withdrawnRwf: number;
  remainingRwf: number;
  pendingBankRwf: number;
  transactions: number;
}

export interface PaginatedPayments {
  items: Payment[];
  total: number;
  page: number;
  pageSize: number;
}

/** Who is making the call: the admin console (its token is attached by the
 * shared axios interceptor) or a logged-in integrator (portal session). */
/** `test`: the Test Lab - "sandbox" = Soila Pay's simulator, "kitovu" = MoMo
 * on Kitovu's TEST gateway (admin only; cards still use the simulator). */
export type PaymentTestRun = "sandbox" | "kitovu";
export type PaymentScope = ({ kind: "admin" } | { kind: "portal"; token: string }) & { test?: PaymentTestRun };

function testParams(scope: PaymentScope, momo: boolean): Record<string, boolean> | undefined {
  if (!scope.test) return undefined;
  if (scope.test === "kitovu" && scope.kind === "admin" && momo) return { kitovu_test: true };
  return { sandbox: true };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromApi(row: any): Payment {
  return {
    referenceId: row.reference_id,
    direction: row.direction ?? "COLLECTION",
    isCashout: !!row.is_cashout,
    status: row.status,
    statusMessage: row.status_message,
    method: row.method,
    channel: row.channel,
    amountRwf: row.amount_rwf,
    feePercentage: row.fee_percentage ?? null,
    feeAmountRwf: row.fee_amount_rwf ?? null,
    gatewayCostPercentage: row.gateway_cost_percentage ?? null,
    gatewayCostAmountRwf: row.gateway_cost_amount_rwf ?? null,
    marginAmountRwf: row.margin_amount_rwf ?? null,
    gatewayAmountRwf: row.gateway_amount_rwf ?? null,
    reconciled: !!row.reconciled,
    imported: !!row.imported,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    description: row.description,
    gateway: row.gateway ?? "",
    source: row.source ?? null,
    actor: row.actor ?? null,
    clientIp: row.client_ip ?? null,
    gatewayTransactionId: row.gateway_transaction_id,
    redirectUrl: row.redirect_url,
    isTest: row.is_test,
    integratorName: row.integrator_name,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function pricingFromApi(data: any): PaymentPricing {
  return {
    gatewayCostPercentage: data.gateway_cost_percentage,
    momoCostPercentage: data.momo_cost_percentage ?? 3,
    momoPayoutCostRwf: data.momo_payout_cost_rwf ?? 400,
    defaultFeePercentage: data.default_fee_percentage,
    payoutCostPercentage: data.payout_cost_percentage,
    payoutDefaultFeePercentage: data.payout_default_fee_percentage,
    integrators: data.integrators.map((i: any) => ({
      id: i.id,
      name: i.name,
      paymentFeePercentage: i.payment_fee_percentage,
      effectiveFeePercentage: i.effective_fee_percentage,
      payoutFeePercentage: i.payout_fee_percentage,
      effectivePayoutFeePercentage: i.effective_payout_fee_percentage,
      belowCost: i.below_cost,
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function base(scope: PaymentScope) {
  return scope.kind === "admin" ? "/api/v1/admin/payments" : "/api/v1/integrator-portal/payments";
}

function payoutBase(scope: PaymentScope) {
  return scope.kind === "admin" ? "/api/v1/admin/disbursements" : "/api/v1/integrator-portal/disbursements";
}

/** ?mode=live|test - every read shows exactly one ledger (the switch in the top bar). */
function mode(scope: PaymentScope) {
  return currentMoneyView(scope.kind);
}

/** Admin: the integrator filter in the top bar (undefined = everyone). */
function who(scope: PaymentScope): number | undefined {
  if (scope.kind !== "admin") return undefined;
  return currentIntegratorFilter() ?? undefined;
}

function headers(scope: PaymentScope) {
  return scope.kind === "portal" ? { Authorization: `Bearer ${scope.token}` } : undefined;
}

/** Confirm step before a MoMo charge (like Kitovu's own collection screen). */
export interface MomoLookup {
  phone: string;
  /** The name registered on the wallet; null if it couldn't be checked. */
  accountName: string | null;
  verified: boolean;
  amountRwf: number;
  customerFeeRwf: number;
  totalToPayRwf: number;
  gateway: string;
}

export const paymentService = {
  /** Whose MoMo wallet is this, and what will the customer pay? */
  async momoLookup(scope: PaymentScope, p: { channel: PaymentChannel; phone: string; amountRwf: number }): Promise<MomoLookup> {
    const { data } = await apiClient.post(
      `${base(scope)}/momo-lookup`,
      { channel: p.channel, phone: p.phone, amount_rwf: p.amountRwf },
      { headers: headers(scope), params: testParams(scope, true), timeout: 30000 }
    );
    return {
      phone: data.phone,
      accountName: data.account_name ?? null,
      verified: !!data.verified,
      amountRwf: data.amount_rwf,
      customerFeeRwf: data.customer_fee_rwf ?? 0,
      totalToPayRwf: data.total_to_pay_rwf ?? data.amount_rwf,
      gateway: data.gateway,
    };
  },

  async create(scope: PaymentScope, payload: PaymentCreatePayload): Promise<Payment> {
    const { data } = await apiClient.post(
      base(scope),
      toApiBody(payload),
      // MoMo can take a while at the gateway; the backend caps it at ~20s.
      {
        headers: headers(scope),
        params: testParams(scope, payload.channel === "MTN_MOMO" || payload.channel === "AIRTEL_MONEY"),
        timeout: 45000,
      }
    );
    return fromApi(data);
  },

  /** Send money to an MTN MoMo number (LMBTech payout). */
  async createDisbursement(scope: PaymentScope, payload: DisbursementCreatePayload): Promise<Payment> {
    const { data } = await apiClient.post(
      payoutBase(scope),
      {
        amount_rwf: payload.amountRwf,
        recipient_name: payload.recipientName,
        recipient_phone: payload.recipientPhone,
        recipient_email: payload.recipientEmail || undefined,
        description: payload.description || "payout",
      },
      { headers: headers(scope), timeout: 45000 }
    );
    return fromApi(data);
  },

  async get(scope: PaymentScope, referenceId: string): Promise<Payment> {
    const { data } = await apiClient.get(`${base(scope)}/${encodeURIComponent(referenceId)}`, {
      headers: headers(scope),
    });
    return fromApi(data);
  },

  async list(scope: PaymentScope, query: LedgerQuery = {}): Promise<PaginatedPayments> {
    const { data } = await apiClient.get(base(scope), {
      headers: headers(scope),
      params: {
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        direction: query.direction,
        status: query.status,
        method: query.method,
        q: query.q?.trim() || undefined,
        date_from: query.dateFrom || undefined,
        date_to: query.dateTo || undefined,
        cashout: query.cashout,
        mode: mode(scope),
        integrator_id: who(scope),
      },
    });
    return { items: data.items.map(fromApi), total: data.total, page: data.page, pageSize: data.page_size };
  },

  /** Available Balance / Total Net / Total Withdraw / Remaining for a range. */
  async period(scope: PaymentScope, dateFrom?: string, dateTo?: string): Promise<PeriodSummary> {
    const { data } = await apiClient.get(`${base(scope)}/period`, {
      headers: headers(scope),
      params: { date_from: dateFrom || undefined, date_to: dateTo || undefined, mode: mode(scope), integrator_id: who(scope) },
    });
    return {
      availableBalanceRwf: data.available_balance_rwf ?? null,
      grossRwf: data.gross_rwf,
      netRwf: data.net_rwf,
      withdrawnRwf: data.withdrawn_rwf,
      remainingRwf: data.remaining_rwf,
      pendingBankRwf: data.pending_bank_rwf,
      transactions: data.transactions,
    };
  },

  /** Portal: withdraw your own balance to your MTN MoMo number or bank account. */
  async cashout(token: string, destination: "MOMO" | "BANK", amountRwf: number): Promise<Payment> {
    const { data } = await apiClient.post(
      "/api/v1/integrator-portal/payments/cashout",
      { destination, amount_rwf: amountRwf },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 45000 }
    );
    return fromApi(data);
  },

  /** Admin: mark a bank cash-out paid (note = bank reference) or rejected (note = reason). */
  async settleCashout(referenceId: string, paid: boolean, note: string): Promise<Payment> {
    const { data } = await apiClient.post(`/api/v1/admin/payments/${encodeURIComponent(referenceId)}/settle`, { paid, note });
    return fromApi(data);
  },

  async summary(scope: PaymentScope, direction?: Direction): Promise<PaymentSummary> {
    const { data } = await apiClient.get(`${base(scope)}/summary`, { headers: headers(scope), params: { direction, mode: mode(scope), integrator_id: who(scope) } });
    return {
      collectedRwf: data.collected_rwf,
      disbursedRwf: data.disbursed_rwf,
      feesRwf: data.fees_rwf,
      momoRwf: data.momo_rwf,
      cardRwf: data.card_rwf,
      successCount: data.success_count,
      pendingCount: data.pending_count,
      failedCount: data.failed_count,
      totalCount: data.total_count,
      gatewayConfigured: data.gateway_configured,
      payoutsConfigured: data.payouts_configured,
      airtelAvailable: !!data.airtel_available,
      kitovuTestAvailable: !!data.kitovu_test_available,
      momoGateway: data.momo_gateway ?? "LMBTECH",
      testMode: data.test_mode,
      accountTestMode: data.account_test_mode ?? data.test_mode,
      feePercentage: data.fee_percentage ?? null,
      payoutFeePercentage: data.payout_fee_percentage ?? null,
      availableBalanceRwf: data.available_balance_rwf ?? null,
      gatewayCostPercentage: data.gateway_cost_percentage ?? null,
      payoutCostPercentage: data.payout_cost_percentage ?? null,
      gatewayCostRwf: data.gateway_cost_rwf ?? null,
      marginRwf: data.margin_rwf ?? null,
      integratorsBelowCost: data.integrators_below_cost ?? null,
    };
  },

  async overview(scope: PaymentScope, days = 14): Promise<Overview> {
    const { data } = await apiClient.get(`${base(scope)}/overview`, { headers: headers(scope), params: { days, mode: mode(scope), integrator_id: who(scope) } });
    return {
      days: data.days,
      series: data.series,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channels: data.channels.map((c: any) => ({ channel: c.channel, amountRwf: c.amount_rwf, count: c.count })),
      today: {
        collectedRwf: data.today.collected_rwf,
        disbursedRwf: data.today.disbursed_rwf,
        marginRwf: data.today.margin_rwf ?? null,
        successCount: data.today.success_count,
        failedCount: data.today.failed_count,
        pendingCount: data.today.pending_count,
        successRate: data.today.success_rate ?? null,
      },
      recent: data.recent.map(fromApi),
    };
  },

  /** Admin: LMBTech cost %, default fees, per-integrator fees. */
  async getPricing(): Promise<PaymentPricing> {
    const { data } = await apiClient.get("/api/v1/admin/payments/pricing");
    return pricingFromApi(data);
  },

  async setPricing(p: Omit<PaymentPricing, "integrators">): Promise<PaymentPricing> {
    const { data } = await apiClient.put("/api/v1/admin/payments/pricing", {
      gateway_cost_percentage: p.gatewayCostPercentage,
      momo_cost_percentage: p.momoCostPercentage,
      momo_payout_cost_rwf: p.momoPayoutCostRwf,
      default_fee_percentage: p.defaultFeePercentage,
      payout_cost_percentage: p.payoutCostPercentage,
      payout_default_fee_percentage: p.payoutDefaultFeePercentage,
    });
    return pricingFromApi(data);
  },

  /** Admin: set (or clear with null) one integrator's collection / payout fee. */
  async setIntegratorFees(integratorId: number, fees: { collection: number | null; payout: number | null }): Promise<void> {
    await apiClient.patch(`/api/v1/admin/integrators/${integratorId}`, {
      ...(fees.collection === null ? { clear_payment_fee: true } : { payment_fee_percentage: fees.collection.toFixed(2) }),
      ...(fees.payout === null ? { clear_payout_fee: true } : { payout_fee_percentage: fees.payout.toFixed(2) }),
    });
  },

  /** Admin: compare every transaction from the last `days` days with LMBTech
   * and correct any that disagree. */
  async reconcile(days = 30): Promise<ReconcileReport> {
    const { data } = await apiClient.post("/api/v1/admin/payments/reconcile", null, { params: { days }, timeout: 180000 });
    return {
      checked: data.checked,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      corrected: data.corrected.map((c: any) => ({
        referenceId: c.reference_id,
        name: c.name,
        amountRwf: c.amount_rwf,
        fromStatus: c.from_status,
        toStatus: c.to_status,
      })),
      errors: data.errors.length,
    };
  },

  /** Admin: add a transaction that exists only at LMBTech. */
  async importFromLmbtech(p: {
    referenceId: string;
    amountRwf: number;
    channel: string;
    description?: string;
    /** DISBURSEMENT = a payout sent from LMBTech's dashboard; CASHOUT = money
     * Soila Pay withdrew from its own LMBTech balance ("Cashout"). */
    direction?: "COLLECTION" | "DISBURSEMENT" | "CASHOUT";
    recipientPhone?: string;
    cashoutTo?: "MOMO" | "BANK";
  }): Promise<Payment> {
    const payout = p.direction === "DISBURSEMENT" || p.direction === "CASHOUT";
    const { data } = await apiClient.post("/api/v1/admin/payments/import", {
      reference_id: p.referenceId.trim(),
      amount_rwf: p.amountRwf,
      channel: payout ? "MTN" : p.channel,
      direction: p.direction ?? "COLLECTION",
      ...(p.direction === "CASHOUT" ? { cashout_to: p.cashoutTo ?? "MOMO" } : {}),
      ...(payout && p.recipientPhone?.trim() ? { recipient_phone: p.recipientPhone.trim() } : {}),
      description:
        p.description ||
        (p.direction === "CASHOUT" ? "LMBTech cash-out" : payout ? "Payout imported from LMBTech" : "Imported from LMBTech"),
    });
    return fromApi(data);
  },

  /** Sandbox card page only: approve or cancel a simulated card payment.
   * The server refuses anything that isn't a pending sandbox card row. */
  async completeSandboxCard(referenceId: string, approve: boolean, cardNumber?: string): Promise<PublicPayment> {
    const { data } = await apiClient.post(`/api/v1/payments/sandbox/${encodeURIComponent(referenceId)}/complete`, {
      approve,
      card_number: cardNumber || null,
    });
    return toPublic(data);
  },

  /** No login needed - the receipt page a card payer returns to. */
  async getPublic(referenceId: string): Promise<PublicPayment> {
    const { data } = await apiClient.get(`/api/v1/payments/public/${encodeURIComponent(referenceId)}`);
    return toPublic(data);
  },
};

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function toPublic(data: any): PublicPayment {
  return {
    referenceId: data.reference_id,
    status: data.status,
    statusMessage: data.status_message,
    method: data.method,
    channel: data.channel,
    amountRwf: data.amount_rwf,
    customerName: data.customer_name,
    description: data.description,
    isTest: data.is_test,
    createdAt: data.created_at,
    completedAt: data.completed_at,
    returnUrl: data.return_url,
  };
}

/** The exact JSON body an integrator sends to POST /api/v1/payments. */
export function toApiBody(payload: PaymentCreatePayload) {
  return {
    channel: payload.channel,
    amount_rwf: payload.amountRwf,
    customer_name: payload.customerName,
    customer_email: payload.customerEmail,
    ...(payload.customerPhone ? { customer_phone: payload.customerPhone } : {}),
    description: payload.description || "payment",
  };
}

export interface RawCall {
  ok: boolean;
  httpStatus: number | null;
  ms: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

async function rawCall(fn: () => Promise<{ status: number; data: unknown }>): Promise<RawCall> {
  const t0 = performance.now();
  try {
    const res = await fn();
    return { ok: true, httpStatus: res.status, ms: Math.round(performance.now() - t0), body: res.data };
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = e as any;
    return {
      ok: false,
      httpStatus: err?.response?.status ?? null,
      ms: Math.round(performance.now() - t0),
      body: err?.response?.data ?? { error: paymentErrorMessage(e) },
    };
  }
}

/** Test Lab helpers: same endpoints, but hand back the raw HTTP status + JSON
 * (including validation errors) instead of throwing, so the lab can show
 * exactly what an integrator would see. */
/** Test Lab: every payment is created with ?sandbox=true, so it is simulated
 * by Soila Pay and never charges anyone - even from the live admin console. */
export const paymentLab = {
  create: (scope: PaymentScope, body: Record<string, unknown>) =>
    rawCall(() => apiClient.post(base(scope), body, { headers: headers(scope), params: { sandbox: true }, timeout: 45000 })),
  get: (scope: PaymentScope, referenceId: string) =>
    rawCall(() => apiClient.get(`${base(scope)}/${encodeURIComponent(referenceId)}`, { headers: headers(scope) })),
  /** Admin Kitovu test: real requests to Kitovu's TEST gateway (test money). */
  kitovuLookup: (body: Record<string, unknown>) =>
    rawCall(() => apiClient.post("/api/v1/admin/payments/momo-lookup", body, { params: { kitovu_test: true }, timeout: 45000 })),
  kitovuCollect: (body: Record<string, unknown>) =>
    rawCall(() => apiClient.post("/api/v1/admin/payments", body, { params: { kitovu_test: true }, timeout: 45000 })),
  kitovuPayout: (body: Record<string, unknown>) =>
    rawCall(() => apiClient.post("/api/v1/admin/disbursements", body, { params: { kitovu_test: true }, timeout: 45000 })),
  /** Plays the customer on the sandbox card page (approve with a test card). */
  cardPage: (referenceId: string, cardNumber: string) =>
    rawCall(() =>
      apiClient.post(`/api/v1/payments/sandbox/${encodeURIComponent(referenceId)}/complete`, { approve: true, card_number: cardNumber })
    ),
};

/** Display name of the gateway that handled a transaction (admin views). */
export function gatewayLabel(gateway: string | null | undefined): string {
  switch ((gateway ?? "").toUpperCase()) {
    case "KITOVU":
      return "Kitovu";
    case "LMBTECH":
      return "LMBTech";
    case "SANDBOX":
      return "Sandbox";
    case "MANUAL":
      return "Manual";
    default:
      return "Gateway";
  }
}

/** Pull the human-readable reason out of an API error (FastAPI 422 lists too). */
export function paymentErrorMessage(error: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = error as any;
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (typeof d?.msg === "string" ? d.msg.replace(/^Value error, /, "") : null))
      .filter(Boolean);
    if (msgs.length) return msgs.join(" ");
  }
  if (err?.code === "ECONNABORTED") return "The payment service took too long to answer. Check the list in a moment.";
  if (err?.response) return `Request failed (HTTP ${err.response.status})`;
  return "Could not reach Soila Pay. Is the backend running?";
}
