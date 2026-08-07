import { apiClient } from "@/lib/axios";
import { MOCK_MODE, paginate, simulateLatency } from "@/lib/mock";
import { generateJournalEntries } from "@/data/mock/generators";
import type { JournalEntry, PaginatedResult } from "@/types/api";

const MOCK_ENTRIES = generateJournalEntries();

export interface ListJournalEntriesParams {
  page?: number;
  pageSize?: number;
  type?: "DEBIT" | "CREDIT";
}

export const accountingService = {
  /** GET /fineract-provider/api/v1/journalentries (proxied through our middleware). */
  async listJournalEntries(params: ListJournalEntriesParams = {}): Promise<PaginatedResult<JournalEntry>> {
    const { page = 1, pageSize = 10, type } = params;
    if (MOCK_MODE) {
      await simulateLatency();
      const filtered = type ? MOCK_ENTRIES.filter((e) => e.type === type) : MOCK_ENTRIES;
      return paginate(filtered, page, pageSize);
    }
    const { data } = await apiClient.get<PaginatedResult<JournalEntry>>("/api/v1/journalentries", {
      params,
    });
    return data;
  },

  async trialBalanceSummary(): Promise<{ totalDebits: number; totalCredits: number }> {
    if (MOCK_MODE) {
      await simulateLatency();
      const totalDebits = MOCK_ENTRIES.filter((e) => e.type === "DEBIT").reduce((s, e) => s + e.amount, 0);
      const totalCredits = MOCK_ENTRIES.filter((e) => e.type === "CREDIT").reduce((s, e) => s + e.amount, 0);
      return { totalDebits, totalCredits };
    }
    const { data } = await apiClient.get("/api/v1/accounting/trial-balance");
    return data;
  },
};
