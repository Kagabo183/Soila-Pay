import { apiClient } from "@/lib/axios";
import { computeHmacSha256Hex } from "@/lib/hmac";
import { MOCK_MODE, simulateLatency } from "@/lib/mock";

export interface DdinWebhookTestPayload {
  event: "collection.success" | "collection.failed";
  referenceId: string;
  transactionId?: string;
  message?: string;
}

/**
 * There is no webhook *subscription* concept in this backend - DDIN calls a
 * single fixed receiver, POST /api/v1/webhooks/ddin (see app/api/v1/webhooks.py),
 * not a URL we register per-integrator. The only real, useful thing to do
 * here is test that receiver: sign a synthetic DDIN-shaped payload with the
 * configured webhook secret (same HMAC-SHA256 scheme documented in the
 * Developer Portal) and send it, exactly as DDIN eventually will. This is
 * also how a PENDING collection can be resolved locally, before DDIN has a
 * real public URL to call.
 */
export const webhookService = {
  async testDdinReceiver(payload: DdinWebhookTestPayload, secret: string) {
    const body = JSON.stringify({
      success: true,
      message: payload.event === "collection.success" ? "Collection successful" : "Collection failed",
      data: {
        referenceId: payload.referenceId,
        transactionId: payload.transactionId ?? null,
        message: payload.message,
      },
    });

    if (MOCK_MODE) {
      await simulateLatency(300, 600);
      return { received: true, mocked: true };
    }

    if (!secret) {
      throw new Error(
        "No webhook secret configured - set one on /settings/api (must match DDIN_WEBHOOK_SECRET in the backend's .env)"
      );
    }
    const signature = await computeHmacSha256Hex(body, secret);
    const { data } = await apiClient.post("/api/v1/webhooks/ddin", body, {
      headers: {
        "Content-Type": "application/json",
        "X-Moola-Event": payload.event,
        "X-Moola-Signature": signature,
      },
    });
    return data;
  },
};
