import { apiClient } from "@/lib/axios";
import { MOCK_MODE, paginate, simulateLatency } from "@/lib/mock";
import { generateClients } from "@/data/mock/generators";
import type { Client, PaginatedResult } from "@/types/api";

const MOCK_CLIENTS = generateClients();

export interface ListClientsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string[];
}

export const clientsService = {
  /** GET /fineract-provider/api/v1/clients (proxied through our middleware). */
  async list(params: ListClientsParams = {}): Promise<PaginatedResult<Client>> {
    const { page = 1, pageSize = 10, search = "", status = [] } = params;
    if (MOCK_MODE) {
      await simulateLatency();
      let filtered = MOCK_CLIENTS;
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          (c) => c.displayName.toLowerCase().includes(q) || c.accountNo.includes(q)
        );
      }
      if (status.length) filtered = filtered.filter((c) => status.includes(c.status));
      return paginate(filtered, page, pageSize);
    }
    const { data } = await apiClient.get<PaginatedResult<Client>>("/api/v1/clients", { params });
    return data;
  },

  async getById(id: string): Promise<Client | undefined> {
    if (MOCK_MODE) {
      await simulateLatency();
      return MOCK_CLIENTS.find((c) => c.id === id);
    }
    const { data } = await apiClient.get<Client>(`/api/v1/clients/${id}`);
    return data;
  },
};
