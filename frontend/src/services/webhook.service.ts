import { apiClient } from "@/lib/axios";
import { MOCK_MODE, simulateLatency } from "@/lib/mock";
import { generateWebhookDeliveries, generateWebhookSubscriptions } from "@/data/mock/generators";
import type { WebhookDelivery, WebhookRegistrationRequest, WebhookSubscription } from "@/types/api";

let MOCK_SUBSCRIPTIONS = generateWebhookSubscriptions();
const MOCK_DELIVERIES = generateWebhookDeliveries();

export const webhookService = {
  async list(): Promise<WebhookSubscription[]> {
    if (MOCK_MODE) {
      await simulateLatency();
      return MOCK_SUBSCRIPTIONS;
    }
    const { data } = await apiClient.get<WebhookSubscription[]>("/api/v1/webhooks");
    return data;
  },

  /** POST /api/v1/webhooks - registers a new webhook subscription. */
  async register(payload: WebhookRegistrationRequest): Promise<WebhookSubscription> {
    if (MOCK_MODE) {
      await simulateLatency(400, 800);
      const created: WebhookSubscription = {
        id: `WH-${Date.now()}`,
        url: payload.url,
        events: payload.events,
        secretPreview: `whsec_****${Math.random().toString(36).slice(2, 6)}`,
        active: true,
        createdAt: new Date().toISOString(),
      };
      MOCK_SUBSCRIPTIONS = [created, ...MOCK_SUBSCRIPTIONS];
      return created;
    }
    const { data } = await apiClient.post<WebhookSubscription>("/api/v1/webhooks", payload);
    return data;
  },

  async setActive(id: string, active: boolean): Promise<void> {
    if (MOCK_MODE) {
      await simulateLatency(200, 400);
      MOCK_SUBSCRIPTIONS = MOCK_SUBSCRIPTIONS.map((w) => (w.id === id ? { ...w, active } : w));
      return;
    }
    await apiClient.patch(`/api/v1/webhooks/${id}`, { active });
  },

  async remove(id: string): Promise<void> {
    if (MOCK_MODE) {
      await simulateLatency(200, 400);
      MOCK_SUBSCRIPTIONS = MOCK_SUBSCRIPTIONS.filter((w) => w.id !== id);
      return;
    }
    await apiClient.delete(`/api/v1/webhooks/${id}`);
  },

  async deliveries(): Promise<WebhookDelivery[]> {
    if (MOCK_MODE) {
      await simulateLatency();
      return MOCK_DELIVERIES;
    }
    const { data } = await apiClient.get<WebhookDelivery[]>("/api/v1/webhooks/deliveries");
    return data;
  },
};
