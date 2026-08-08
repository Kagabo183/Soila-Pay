import { apiClient } from "@/lib/axios";
import { MOCK_MODE, simulateLatency } from "@/lib/mock";
import { generateDailySeries, generateProviders } from "@/data/mock/generators";
import type { Provider } from "@/types/api";

const MOCK_PROVIDERS = generateProviders();

function providerFromApi(row: {
  id: string;
  name: string;
  type: Provider["type"];
  health: Provider["health"];
  success_rate: number;
  avg_response_ms: number;
  collections_today: number;
  disbursements_today: number;
}): Provider {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    health: row.health,
    successRate: row.success_rate,
    avgResponseMs: row.avg_response_ms,
    collectionsToday: row.collections_today,
    disbursementsToday: row.disbursements_today,
  };
}

export const providerService = {
  /**
   * GET /api/v1/providers (admin-only). There's no "providers" table on the
   * backend - a provider is just a distinct value of transaction_logs.provider
   * (MTN/AIRTEL); these stats are computed from real collection history, not
   * stored. avgResponseMs is always 0 - no request-timing data is collected
   * anywhere in this stack (see DDIN Diagnostics for real latency numbers).
   */
  async list(): Promise<Provider[]> {
    if (MOCK_MODE) {
      await simulateLatency();
      return MOCK_PROVIDERS;
    }
    const { data } = await apiClient.get("/api/v1/providers");
    return (data as Parameters<typeof providerFromApi>[0][]).map(providerFromApi);
  },

  /** GET /api/v1/providers/volume?days=N (admin-only) - daily collection counts from real history. */
  async dailyVolumeSeries(days = 14) {
    if (MOCK_MODE) {
      await simulateLatency();
      return generateDailySeries(days);
    }
    const { data } = await apiClient.get<
      { date: string; collections: number; disbursements: number; failed: number }[]
    >("/api/v1/providers/volume", { params: { days } });
    return data;
  },

  /** GET /healthz on the middleware itself, proxied for the Connection Test button. */
  async healthCheck(baseUrl: string): Promise<{ ok: boolean; latencyMs: number }> {
    if (MOCK_MODE) {
      await simulateLatency(200, 600);
      return { ok: true, latencyMs: Math.round(200 + Math.random() * 400) };
    }
    const start = performance.now();
    try {
      await apiClient.get("/healthz", { baseURL: baseUrl });
      return { ok: true, latencyMs: Math.round(performance.now() - start) };
    } catch {
      return { ok: false, latencyMs: Math.round(performance.now() - start) };
    }
  },
};
