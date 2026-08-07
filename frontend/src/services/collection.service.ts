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

  async list(params: ListCollectionsParams = {}): Promise<PaginatedResult<CollectionTransaction>> {
    const { page = 1, pageSize = 10, status = [], channel = [] } = params;
    if (MOCK_MODE) {
      await simulateLatency();
      let filtered = MOCK_COLLECTIONS;
      if (status.length) filtered = filtered.filter((c) => status.includes(c.status));
      if (channel.length) filtered = filtered.filter((c) => channel.includes(c.channel));
      return paginate(filtered, page, pageSize);
    }
    const { data } = await apiClient.get<PaginatedResult<CollectionTransaction>>(
      "/api/v1/collection/transactions",
      { params }
    );
    return data;
  },

  summaryToday() {
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
  },
};
