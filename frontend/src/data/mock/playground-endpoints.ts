import type { PlaygroundEndpoint } from "@/types/api";

export const PLAYGROUND_ENDPOINTS: PlaygroundEndpoint[] = [
  {
    id: "login",
    method: "POST",
    path: "/api/v1/admin/auth/login",
    name: "Admin Login",
    category: "Authentication",
    description:
      "Exchanges the shared operator credential (ADMIN_USERNAME/ADMIN_PASSWORD) for a signed session token. There is no per-user login yet - see app/services/admin_auth.py.",
    defaultHeaders: { "Content-Type": "application/json" },
    defaultBody: { username: "admin", password: "" },
    requiresAuth: false,
  },
  {
    id: "collection",
    method: "POST",
    path: "/api/v1/collection/collect",
    name: "Collection",
    category: "Collection",
    description:
      "Debits a customer's mobile money account (MTN/AIRTEL), deposits into a Fineract savings wallet, and auto-refunds on provider failure. Requires Idempotency-Key and Integrator-Key headers. A response of PENDING (HTTP 202) means DDIN acknowledged the request but hasn't resolved it yet - see the Webhook Receiver Test entry below.",
    defaultHeaders: {
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-playground-0001",
      "Integrator-Key": "sk_your_integrator_key",
    },
    defaultBody: {
      fineract_savings_account_id: "1",
      provider: "MTN",
      customer_account_number: "0788123456",
      customer_name: "Jean Uwimana",
      amount_rwf: 5000,
    },
    requiresAuth: true,
  },
  {
    id: "transaction-status",
    method: "GET",
    path: "/api/v1/collection/transactions/{idempotency_key}",
    name: "Transaction Status",
    category: "Collection",
    description:
      "Looks up one of YOUR OWN collections (scoped by Integrator-Key) by its idempotency key - a fallback for polling when you don't yet have a reachable webhook endpoint. Put the idempotency key in the body field below; it's sent as a path parameter, not JSON.",
    defaultHeaders: {
      "Content-Type": "application/json",
      "Integrator-Key": "sk_your_integrator_key",
    },
    defaultBody: { idempotency_key: "idem-playground-0001" },
    requiresAuth: true,
  },
  {
    id: "webhook-receiver-test",
    method: "POST",
    path: "/api/v1/webhooks/ddin",
    name: "Webhook Receiver Test",
    category: "Webhooks",
    description:
      "There's no webhook *subscription* API - DDIN calls one fixed URL (this one) when a collection resolves, not a URL you register per-integrator. This sends a synthetic, correctly-signed DDIN event straight at our real receiver - the same code path a real DDIN webhook hits, including resolving a PENDING transaction to SUCCESS/FAILED. Requires a Webhook Secret set on Settings -> API Integration (must match DDIN_WEBHOOK_SECRET in the backend's .env). Set referenceId to a real idempotency key of a PENDING collection to actually resolve it.",
    defaultHeaders: { "Content-Type": "application/json" },
    defaultBody: {
      event: "collection.success",
      referenceId: "idem-playground-0001",
      transactionId: "DDIN-TXN-0001",
    },
    requiresAuth: false,
  },
];
