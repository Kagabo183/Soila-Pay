import { apiClient } from "@/lib/axios";

/** What the customer picks on the checkout screen. All three card options go
 * to the same secure card page (LMBTech / Pesapal) - the choice is recorded so
 * dashboards can show Visa vs Mastercard vs other. */
export type PaymentChannel = "MTN_MOMO" | "VISA" | "MASTERCARD" | "OTHER_CARD";
export type PaymentStatus = "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED";

export interface Payment {
  referenceId: string;
  status: PaymentStatus;
  statusMessage: string | null;
  method: "MOMO" | "CARD";
  channel: string;
  amountRwf: number;
  feeAmountRwf: number | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  description: string;
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
  feesRwf: number;
  momoRwf: number;
  cardRwf: number;
  successCount: number;
  pendingCount: number;
  failedCount: number;
  totalCount: number;
  gatewayConfigured: boolean;
  testMode: boolean;
}

export interface PaymentCreatePayload {
  channel: PaymentChannel;
  amountRwf: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  description?: string;
}

export interface PaginatedPayments {
  items: Payment[];
  total: number;
  page: number;
  pageSize: number;
}

/** Who is making the call: the admin console (its token is attached by the
 * shared axios interceptor) or a logged-in integrator (portal session). */
export type PaymentScope = { kind: "admin" } | { kind: "portal"; token: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromApi(row: any): Payment {
  return {
    referenceId: row.reference_id,
    status: row.status,
    statusMessage: row.status_message,
    method: row.method,
    channel: row.channel,
    amountRwf: row.amount_rwf,
    feeAmountRwf: row.fee_amount_rwf,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    description: row.description,
    gatewayTransactionId: row.gateway_transaction_id,
    redirectUrl: row.redirect_url,
    isTest: row.is_test,
    integratorName: row.integrator_name,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function base(scope: PaymentScope) {
  return scope.kind === "admin" ? "/api/v1/admin/payments" : "/api/v1/integrator-portal/payments";
}

function headers(scope: PaymentScope) {
  return scope.kind === "portal" ? { Authorization: `Bearer ${scope.token}` } : undefined;
}

export const paymentService = {
  async create(scope: PaymentScope, payload: PaymentCreatePayload): Promise<Payment> {
    const { data } = await apiClient.post(
      base(scope),
      toApiBody(payload),
      // MoMo can take a while at the gateway; the backend caps it at ~20s.
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

  async list(
    scope: PaymentScope,
    params: { page?: number; pageSize?: number; status?: PaymentStatus; method?: "MOMO" | "CARD" } = {}
  ): Promise<PaginatedPayments> {
    const { data } = await apiClient.get(base(scope), {
      headers: headers(scope),
      params: { page: params.page ?? 1, pageSize: params.pageSize ?? 20, status: params.status, method: params.method },
    });
    return { items: data.items.map(fromApi), total: data.total, page: data.page, pageSize: data.page_size };
  },

  async summary(scope: PaymentScope): Promise<PaymentSummary> {
    const { data } = await apiClient.get(`${base(scope)}/summary`, { headers: headers(scope) });
    return {
      collectedRwf: data.collected_rwf,
      feesRwf: data.fees_rwf,
      momoRwf: data.momo_rwf,
      cardRwf: data.card_rwf,
      successCount: data.success_count,
      pendingCount: data.pending_count,
      failedCount: data.failed_count,
      totalCount: data.total_count,
      gatewayConfigured: data.gateway_configured,
      testMode: data.test_mode,
    };
  },

  /** No login needed - the receipt page a card payer returns to. */
  async getPublic(referenceId: string): Promise<PublicPayment> {
    const { data } = await apiClient.get(`/api/v1/payments/public/${encodeURIComponent(referenceId)}`, {
      headers: { Authorization: "" },
    });
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
  },
};

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

/** Test Lab helpers: same endpoints, but hand back the raw HTTP status + JSON
 * (including validation errors) instead of throwing, so the lab can show
 * exactly what an integrator would see. */
export const paymentLab = {
  async create(scope: PaymentScope, body: Record<string, unknown>): Promise<RawCall> {
    const t0 = performance.now();
    try {
      const res = await apiClient.post(base(scope), body, { headers: headers(scope), timeout: 45000 });
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
  },

  async get(scope: PaymentScope, referenceId: string): Promise<RawCall> {
    const t0 = performance.now();
    try {
      const res = await apiClient.get(`${base(scope)}/${encodeURIComponent(referenceId)}`, { headers: headers(scope) });
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
  },
};

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
  if (err?.code === "ECONNABORTED") return "The payment service took too long to answer. Check the payment list in a moment.";
  if (err?.response) return `Request failed (HTTP ${err.response.status})`;
  return "Could not reach Soila Pay. Is the backend running?";
}
