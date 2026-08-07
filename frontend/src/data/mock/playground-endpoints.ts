import type { PlaygroundEndpoint } from "@/types/api";

export const PLAYGROUND_ENDPOINTS: PlaygroundEndpoint[] = [
  {
    id: "login",
    method: "POST",
    path: "/api/v1/auth/login",
    name: "Login",
    category: "Authentication",
    description: "Exchange a username/password for a JWT access + refresh token pair.",
    defaultHeaders: { "Content-Type": "application/json" },
    defaultBody: { username: "mifos", password: "password" },
    requiresAuth: false,
  },
  {
    id: "collection",
    method: "POST",
    path: "/api/v1/collection/collect",
    name: "Collection",
    category: "Collection",
    description:
      "Debits a customer's mobile money account (MTN/AIRTEL), deposits into a Fineract savings wallet, and auto-refunds on provider failure. Requires Idempotency-Key and Integrator-Key headers.",
    defaultHeaders: {
      "Content-Type": "application/json",
      "Idempotency-Key": "idem-playground-0001",
      "Integrator-Key": "sk_your_integrator_key",
    },
    defaultBody: {
      fineract_savings_account_id: "12345",
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
    description: "Look up a previously submitted collection transaction by its idempotency key.",
    defaultHeaders: { "Content-Type": "application/json" },
    defaultBody: { idempotency_key: "idem-playground-0001" },
    requiresAuth: true,
  },
  {
    id: "webhook-registration",
    method: "POST",
    path: "/api/v1/webhooks",
    name: "Webhook Registration",
    category: "Webhooks",
    description: "Registers a URL to receive collection/disbursement lifecycle events.",
    defaultHeaders: { "Content-Type": "application/json" },
    defaultBody: {
      url: "https://ops.soilapay.rw/webhooks/collections",
      events: ["collection.success", "collection.failed_refunded"],
    },
    requiresAuth: true,
  },
];
