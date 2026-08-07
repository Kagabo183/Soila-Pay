import { apiClient } from "@/lib/axios";
import { MOCK_MODE, paginate, simulateLatency } from "@/lib/mock";
import { generateDisbursements } from "@/data/mock/generators";
import type { Disbursement, DisbursementRequest, PaginatedResult } from "@/types/api";

const MOCK_DISBURSEMENTS = generateDisbursements();

export interface ListDisbursementsParams {
  page?: number;
  pageSize?: number;
  status?: string[];
}

/**
 * PLACEHOLDER: the FastAPI middleware only implements the collection
 * (utility purchase) flow today - see app/api/v1/utility.py. This service is
 * shaped to match that same request/response/idempotency contract so that
 * adding a real `POST /api/v1/disbursement/payout` endpoint later (debit an
 * operator float account, credit a recipient via MTN/Airtel/bank rail) is a
 * drop-in swap here, with zero UI changes.
 */
export const disbursementService = {
  async payout(payload: DisbursementRequest, idempotencyKey?: string): Promise<Disbursement> {
    const key = idempotencyKey ?? `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (MOCK_MODE) {
      await simulateLatency(500, 1100);
      return {
        id: `DIS-${Date.now()}`,
        recipientMsisdn: payload.recipient_msisdn,
        channel: payload.channel,
        amountRwf: payload.amount_rwf,
        status: "PROCESSING",
        narration: payload.narration,
        createdAt: new Date().toISOString(),
      };
    }
    const { data } = await apiClient.post<Disbursement>("/api/v1/disbursement/payout", payload, {
      headers: { "Idempotency-Key": key },
    });
    return data;
  },

  async list(params: ListDisbursementsParams = {}): Promise<PaginatedResult<Disbursement>> {
    const { page = 1, pageSize = 10, status = [] } = params;
    if (MOCK_MODE) {
      await simulateLatency();
      const filtered = status.length
        ? MOCK_DISBURSEMENTS.filter((d) => status.includes(d.status))
        : MOCK_DISBURSEMENTS;
      return paginate(filtered, page, pageSize);
    }
    const { data } = await apiClient.get<PaginatedResult<Disbursement>>("/api/v1/disbursement/transactions", {
      params,
    });
    return data;
  },

  summaryToday() {
    const today = new Date().toDateString();
    const todays = MOCK_DISBURSEMENTS.filter((d) => new Date(d.createdAt).toDateString() === today);
    const pool = todays.length ? todays : MOCK_DISBURSEMENTS;
    return {
      count: pool.length,
      totalAmount: pool.reduce((s, d) => s + d.amountRwf, 0),
    };
  },
};
