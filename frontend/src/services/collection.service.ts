import { apiClient } from "@/lib/axios";
import { MOCK_MODE, paginate, simulateLatency } from "@/lib/mock";
import { generateCollections } from "@/data/mock/generators";
import type {
  CollectionRequest,
  CollectionResponse,
  CollectionTransaction,
  PaginatedResult,
} from "@/types/api";

const MOCK_COLLECTIONS = generateCollections();

export interface ListCollectionsParams {
  page?: number;
  pageSize?: number;
  status?: string[];
  channel?: string[];
}

function generateIdempotencyKey() {
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// snake_case (backend) <-> camelCase (frontend) at the edge, matching
// app/schemas/dashboard.py's CollectionTransactionOut. "channel" is this
// app's pre-existing name for what the backend just calls "provider" - there
// is no separate channel concept on the backend, so it's mapped 1:1 here.
function transactionFromApi(row: {
  id: string;
  idempotency_key: string;
  fineract_savings_account_id: string;
  provider: string;
  customer_account_number: string;
  customer_name: string;
  amount_rwf: number;
  status: CollectionTransaction["status"];
  debit_transaction_id: string | null;
  refund_transaction_id: string | null;
  provider_transaction_reference: string | null;
  created_at: string;
}): CollectionTransaction {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    fineractSavingsAccountId: row.fineract_savings_account_id,
    provider: row.provider,
    customerAccountNumber: row.customer_account_number,
    customerName: row.customer_name,
    amountRwf: Number(row.amount_rwf),
    status: row.status,
    debitTransactionId: row.debit_transaction_id,
    refundTransactionId: row.refund_transaction_id,
    providerTransactionReference: row.provider_transaction_reference,
    channel: (row.provider as CollectionTransaction["channel"]) ?? "MTN",
    createdAt: row.created_at,
  };
}

export const collectionService = {
  /**
   * POST /api/v1/collection/collect - the real endpoint implemented in
   * app/api/v1/collection.py. Requires Idempotency-Key (auto-generated here if
   * the caller doesn't supply one) and Integrator-Key headers. integratorApiKey
   * is optional only because mock mode never reaches the network - a real,
   * non-mock call without it is rejected by the backend with 401 Unknown
   * Integrator-Key, exactly like calling the real API without a key would be.
   */
  async collect(
    payload: CollectionRequest,
    integratorApiKey?: string,
    idempotencyKey: string = generateIdempotencyKey()
  ): Promise<CollectionResponse> {
    if (MOCK_MODE) {
      await simulateLatency(500, 1200);
      const forcedFailure = payload.customer_account_number === "00000000000";
      if (forcedFailure) {
        return {
          status: "FAILED_REFUNDED",
          idempotency_key: idempotencyKey,
          fineract_savings_account_id: payload.fineract_savings_account_id,
          debit_transaction_id: `DBT-${Date.now()}`,
          refund_transaction_id: `RFD-${Date.now()}`,
          provider_transaction_reference: null,
          amount_rwf: payload.amount_rwf,
          message: `Collection failed (provider ${payload.provider} rejected account ${payload.customer_account_number}). Funds were refunded successfully.`,
          refunded: true,
        };
      }
      return {
        status: "SUCCESS",
        idempotency_key: idempotencyKey,
        fineract_savings_account_id: payload.fineract_savings_account_id,
        debit_transaction_id: `DBT-${Date.now()}`,
        refund_transaction_id: null,
        provider_transaction_reference: `${payload.provider}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        amount_rwf: payload.amount_rwf,
        message: "Collection completed successfully",
        refunded: false,
      };
    }
    const { data } = await apiClient.post<CollectionResponse>("/api/v1/collection/collect", payload, {
      headers: {
        "Idempotency-Key": idempotencyKey,
        ...(integratorApiKey ? { "Integrator-Key": integratorApiKey } : {}),
      },
    });
    return data;
  },

  /** GET /api/v1/collection/transactions (admin-only) - real history, newest first. */
  async list(params: ListCollectionsParams = {}): Promise<PaginatedResult<CollectionTransaction>> {
    const { page = 1, pageSize = 10, status = [], channel = [] } = params;
    if (MOCK_MODE) {
      await simulateLatency();
      let filtered = MOCK_COLLECTIONS;
      if (status.length) filtered = filtered.filter((c) => status.includes(c.status));
      if (channel.length) filtered = filtered.filter((c) => channel.includes(c.channel));
      return paginate(filtered, page, pageSize);
    }
    const { data } = await apiClient.get<{
      items: Parameters<typeof transactionFromApi>[0][];
      total: number;
      page: number;
      page_size: number;
    }>("/api/v1/collection/transactions", { params: { page, pageSize, status, channel } });
    return {
      items: data.items.map(transactionFromApi),
      total: data.total,
      page: data.page,
      pageSize: data.page_size,
    };
  },

  /**
   * GET /api/v1/collection/transactions/{idempotency_key} - lets an
   * integrator poll their own PENDING collection's status (the primary
   * resolution path is DDIN's webhook - see webhookService.testDdinReceiver -
   * this is the fallback for callers without a reachable webhook endpoint
   * yet). Requires Integrator-Key; scoped server-side to that integrator's
   * own transactions only.
   */
  async getByIdempotencyKey(
    idempotencyKey: string,
    integratorApiKey: string
  ): Promise<CollectionTransaction> {
    if (MOCK_MODE) {
      await simulateLatency();
      const found = MOCK_COLLECTIONS.find((c) => c.idempotencyKey === idempotencyKey);
      if (!found) throw new Error(`Transaction not found for idempotency key ${idempotencyKey}`);
      return found;
    }
    const { data } = await apiClient.get<Parameters<typeof transactionFromApi>[0]>(
      `/api/v1/collection/transactions/${encodeURIComponent(idempotencyKey)}`,
      { headers: { "Integrator-Key": integratorApiKey } }
    );
    return transactionFromApi(data);
  },

  /**
   * POST /api/v1/collection/transactions/{idempotency_key}/sync - actively
   * asks DDIN for this transaction's real, current status right now and
   * reconciles our local record to match, rather than waiting for a webhook
   * that (in local dev, with no public URL) will never arrive. Same
   * reconciliation getByIdempotencyKey already triggers automatically for a
   * DEBITED row - this is for an explicit "Check DDIN status" action.
   */
  async syncTransaction(
    idempotencyKey: string,
    integratorApiKey: string
  ): Promise<CollectionTransaction> {
    if (MOCK_MODE) {
      await simulateLatency();
      const found = MOCK_COLLECTIONS.find((c) => c.idempotencyKey === idempotencyKey);
      if (!found) throw new Error(`Transaction not found for idempotency key ${idempotencyKey}`);
      return found;
    }
    const { data } = await apiClient.post<Parameters<typeof transactionFromApi>[0]>(
      `/api/v1/collection/transactions/${encodeURIComponent(idempotencyKey)}/sync`,
      {},
      { headers: { "Integrator-Key": integratorApiKey } }
    );
    return transactionFromApi(data);
  },

  /**
   * Not a dedicated backend endpoint - computed client-side from a recent
   * batch of real transactions (this system's volume is low enough that
   * pageSize: 200 comfortably covers "today"). Swap for a real
   * GET /api/v1/collection/summary if volume ever outgrows that.
   */
  async summaryToday() {
    if (MOCK_MODE) {
      await simulateLatency();
      const today = new Date().toDateString();
      const todays = MOCK_COLLECTIONS.filter((c) => new Date(c.createdAt).toDateString() === today);
      const successful = todays.filter((c) => c.status === "SUCCESS");
      return {
        count: todays.length || MOCK_COLLECTIONS.length,
        totalAmount:
          (todays.length ? todays : MOCK_COLLECTIONS).reduce((s, c) => s + c.amountRwf, 0) || 0,
        successRate: todays.length
          ? Math.round((successful.length / todays.length) * 1000) / 10
          : 96.4,
      };
    }
    const { items } = await this.list({ pageSize: 200 });
    const today = new Date().toDateString();
    const todays = items.filter((c) => new Date(c.createdAt).toDateString() === today);
    const successful = todays.filter((c) => c.status === "SUCCESS");
    return {
      count: todays.length,
      totalAmount: todays.reduce((s, c) => s + c.amountRwf, 0),
      successRate: todays.length ? Math.round((successful.length / todays.length) * 1000) / 10 : 0,
    };
  },
};
