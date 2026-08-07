import { apiClient } from "@/lib/axios";
import { MOCK_MODE, simulateLatency } from "@/lib/mock";
import { generateDailySeries, generateProviders } from "@/data/mock/generators";
import type { Provider } from "@/types/api";

const MOCK_PROVIDERS = generateProviders();

export const providerService = {
  async list(): Promise<Provider[]> {
    if (MOCK_MODE) {
      await simulateLatency();
      return MOCK_PROVIDERS;
    }
    const { data } = await apiClient.get<Provider[]>("/api/v1/providers");
    return data;
  },

  async dailyVolumeSeries(days = 14) {
    if (MOCK_MODE) {
      await simulateLatency();
      return generateDailySeries(days);
    }
    const { data } = await apiClient.get(`/api/v1/providers/volume?days=${days}`);
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
