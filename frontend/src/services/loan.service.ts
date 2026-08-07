import { apiClient } from "@/lib/axios";
import { MOCK_MODE, paginate, simulateLatency } from "@/lib/mock";
import { generateClients, generateLoans } from "@/data/mock/generators";
import type { Loan, PaginatedResult } from "@/types/api";

const MOCK_CLIENTS = generateClients();
const MOCK_LOANS = generateLoans(MOCK_CLIENTS);

export interface ListLoansParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string[];
}

export const loanService = {
  /** GET /fineract-provider/api/v1/loans (proxied through our middleware). */
  async list(params: ListLoansParams = {}): Promise<PaginatedResult<Loan>> {
    const { page = 1, pageSize = 10, search = "", status = [] } = params;
    if (MOCK_MODE) {
      await simulateLatency();
      let filtered = MOCK_LOANS;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (l) => l.clientName.toLowerCase().includes(q) || l.accountNo.includes(q)
        );
      }
      if (status.length) filtered = filtered.filter((l) => status.includes(l.status));
      return paginate(filtered, page, pageSize);
    }
    const { data } = await apiClient.get<PaginatedResult<Loan>>("/api/v1/loans", { params });
    return data;
  },

  async getById(id: string): Promise<Loan | undefined> {
    if (MOCK_MODE) {
      await simulateLatency();
      return MOCK_LOANS.find((l) => l.id === id);
    }
    const { data } = await apiClient.get<Loan>(`/api/v1/loans/${id}`);
    return data;
  },
};
