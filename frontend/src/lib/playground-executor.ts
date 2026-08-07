import { authService } from "@/services/auth.service";
import { collectionService } from "@/services/collection.service";
import { webhookService } from "@/services/webhook.service";
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
        responseBody = await collectionService.purchase(body as unknown as CollectionRequest, idempotencyKey);
        const parsed = responseBody as { status: string };
        status = parsed.status === "FAILED_REFUND_ERROR" ? 500 : 200;
        break;
      }
      case "transaction-status": {
        const key = String(body.idempotency_key ?? "");
        const { items } = await collectionService.list({ pageSize: 200 });
        const found = items.find((c) => c.idempotencyKey === key) ?? items[0];
        if (!found) {
          status = 404;
          responseBody = { message: "Transaction not found for idempotency key", idempotency_key: key };
        } else {
          responseBody = {
            idempotency_key: found.idempotencyKey,
            status: found.status,
            debit_transaction_id: found.debitTransactionId,
            refund_transaction_id: found.refundTransactionId,
            utility_token: found.utilityToken,
            amount_rwf: found.amountRwf,
            created_at: found.createdAt,
          };
        }
        break;
      }
      case "webhook-registration": {
        responseBody = await webhookService.register({
          url: String(body.url ?? ""),
          events: Array.isArray(body.events) ? (body.events as string[]) : [],
        });
        status = 201;
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
        "x-mock-mode": "true",
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
