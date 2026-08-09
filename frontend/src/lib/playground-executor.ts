import { authService } from "@/services/auth.service";
import { collectionService } from "@/services/collection.service";
import { webhookService } from "@/services/webhook.service";
import { useSettingsStore } from "@/store/settings-store";
import type { CollectionRequest, PlaygroundResult } from "@/types/api";

// Routes a Playground request through the *same* service layer the rest of the
// app uses (rather than a raw fetch), so the response shown here always
// matches what the actual UI would receive - including in mock mode.
export async function executePlaygroundRequest(
  endpointId: string,
  body: Record<string, unknown>,
  headers: Record<string, string>
): Promise<PlaygroundResult> {
  const start = performance.now();

  try {
    let responseBody: unknown;
    let status = 200;

    switch (endpointId) {
      case "login": {
        responseBody = await authService.login({
          username: String(body.username ?? ""),
          password: String(body.password ?? ""),
        });
        break;
      }
      case "collection": {
        const idempotencyKey = headers["Idempotency-Key"] || headers["idempotency-key"];
        const integratorApiKey = headers["Integrator-Key"] || headers["integrator-key"];
        responseBody = await collectionService.collect(
          body as unknown as CollectionRequest,
          integratorApiKey,
          idempotencyKey
        );
        const parsed = responseBody as { status: string };
        status = parsed.status === "FAILED_REFUND_ERROR" ? 500 : parsed.status === "PENDING" ? 202 : 200;
        break;
      }
      case "transaction-status": {
        const key = String(body.idempotency_key ?? "");
        const integratorApiKey = headers["Integrator-Key"] || headers["integrator-key"] || "";
        try {
          const found = await collectionService.getByIdempotencyKey(key, integratorApiKey);
          responseBody = {
            idempotency_key: found.idempotencyKey,
            status: found.status,
            debit_transaction_id: found.debitTransactionId,
            refund_transaction_id: found.refundTransactionId,
            provider_transaction_reference: found.providerTransactionReference,
            amount_rwf: found.amountRwf,
            created_at: found.createdAt,
          };
        } catch (err) {
          status = 404;
          responseBody = {
            message: err instanceof Error ? err.message : "Transaction not found",
            idempotency_key: key,
          };
        }
        break;
      }
      case "webhook-receiver-test": {
        const secret = useSettingsStore.getState().webhookSecret;
        responseBody = await webhookService.testDdinReceiver(
          {
            event: (body.event as "collection.success" | "collection.failed") ?? "collection.success",
            referenceId: String(body.referenceId ?? ""),
            transactionId: body.transactionId ? String(body.transactionId) : undefined,
          },
          secret
        );
        break;
      }
      default:
        throw new Error(`Unknown playground endpoint: ${endpointId}`);
    }

    const timeMs = Math.round(performance.now() - start);
    return {
      status,
      statusText: status < 300 ? "OK" : status < 500 ? "Client Error" : "Server Error",
      timeMs,
      headers: {
        "content-type": "application/json",
        "x-request-id": `req_${Date.now().toString(36)}`,
      },
      body: responseBody,
    };
  } catch (error) {
    const timeMs = Math.round(performance.now() - start);
    return {
      status: 400,
      statusText: "Bad Request",
      timeMs,
      headers: { "content-type": "application/json" },
      body: { error: error instanceof Error ? error.message : "Request failed" },
    };
  }
}
