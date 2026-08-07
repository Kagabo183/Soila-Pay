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
   * POST /api/v1/utility/purchase - the real endpoint implemented in
   * app/api/v1/utility.py. Requires an Idempotency-Key header; auto-generated
   * here if the caller doesn't supply one.
   */
  async purchase(
    payload: CollectionRequest,
    idempotencyKey: string = generateIdempotencyKey()
  ): Promise<CollectionResponse> {
    if (MOCK_MODE) {
      await simulateLatency(500, 1200);
      const forcedFailure = payload.meter_number === "00000000000";
      if (forcedFailure) {
        return {
          status: "FAILED_REFUNDED",
          idempotency_key: idempotencyKey,
          fineract_savings_account_id: payload.fineract_savings_account_id,
          debit_transaction_id: `DBT-${Date.now()}`,
          refund_transaction_id: `RFD-${Date.now()}`,
          utility_token: null,
          amount_rwf: payload.amount_rwf,
          message: `Utility purchase failed (provider ${payload.utility_provider} rejected meter ${payload.meter_number}). Funds were refunded successfully.`,
          refunded: true,
        };
      }
      return {
        status: "SUCCESS",
        idempotency_key: idempotencyKey,
        fineract_savings_account_id: payload.fineract_savings_account_id,
        debit_transaction_id: `DBT-${Date.now()}`,
        refund_transaction_id: null,
        utility_token: `${payload.utility_provider}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        amount_rwf: payload.amount_rwf,
        message: "Purchase completed successfully",
        refunded: false,
      };
    }
    const { data } = await apiClient.post<CollectionResponse>("/api/v1/utility/purchase", payload, {
      headers: { "Idempotency-Key": idempotencyKey },
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
      "/api/v1/utility/transactions",
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
