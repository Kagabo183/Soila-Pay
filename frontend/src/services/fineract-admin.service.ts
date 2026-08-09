import { apiClient } from "@/lib/axios";

export interface FineractBalance {
  account_id: string;
  balance_rwf: number;
}

export interface FineractTopupResult {
  transaction_id: string;
  account_id: string;
  amount_rwf: number;
}

export const fineractAdminService = {
  /** GET /api/v1/admin/fineract/balance/{accountId} */
  async getBalance(accountId: string): Promise<FineractBalance> {
    const { data } = await apiClient.get(`/api/v1/admin/fineract/balance/${accountId}`);
    return data as FineractBalance;
  },

  /** POST /api/v1/admin/fineract/topup */
  async topup(accountId: string, amountRwf: number): Promise<FineractTopupResult> {
    const { data } = await apiClient.post("/api/v1/admin/fineract/topup", {
      account_id: accountId,
      amount_rwf: amountRwf,
    });
    return data as FineractTopupResult;
  },
};
