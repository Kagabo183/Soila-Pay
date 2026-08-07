import { apiClient } from "@/lib/axios";
import { MOCK_MODE, paginate, simulateLatency } from "@/lib/mock";
import { generateClients, generateSavingsAccounts, generateSavingsTransactions } from "@/data/mock/generators";
import type { PaginatedResult, SavingsAccount, SavingsTransaction } from "@/types/api";

const MOCK_CLIENTS = generateClients();
const MOCK_SAVINGS = generateSavingsAccounts(MOCK_CLIENTS);

export interface ListSavingsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string[];
}

export const savingsService = {
  /** GET /fineract-provider/api/v1/savingsaccounts (proxied through our middleware). */
  async list(params: ListSavingsParams = {}): Promise<PaginatedResult<SavingsAccount>> {
    const { page = 1, pageSize = 10, search = "", status = [] } = params;
    if (MOCK_MODE) {
      await simulateLatency();
      let filtered = MOCK_SAVINGS;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (s) => s.clientName.toLowerCase().includes(q) || s.accountNo.includes(q)
        );
      }
      if (status.length) filtered = filtered.filter((s) => status.includes(s.status));
      return paginate(filtered, page, pageSize);
    }
    const { data } = await apiClient.get<PaginatedResult<SavingsAccount>>("/api/v1/savingsaccounts", {
      params,
    });
    return data;
  },

  /**
   * GET /fineract-provider/api/v1/savingsaccounts/{id}/transactions
   * This is the same underlying Fineract endpoint our purchase_orchestrator.py
   * calls with command=withdrawal|deposit.
   */
  async listTransactions(accountId: string): Promise<SavingsTransaction[]> {
    if (MOCK_MODE) {
      await simulateLatency();
      return generateSavingsTransactions(accountId);
    }
    const { data } = await apiClient.get<SavingsTransaction[]>(
      `/api/v1/savingsaccounts/${accountId}/transactions`
    );
    return data;
  },
};
