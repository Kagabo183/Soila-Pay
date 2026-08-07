"use client";

import Link from "next/link";
import {
  KeyRound,
  Wallet,
  Send,
  Webhook,
  FileJson,
  ShieldCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { CodeBlock } from "@/components/ui/code-block";
import { SignatureVerifier } from "@/components/signature-verifier";
import { StatusBadge } from "@/components/ui/status-badge";

const SECTIONS = [
  { id: "authentication", label: "Authentication", icon: KeyRound },
  { id: "collection-api", label: "Collection API", icon: Wallet },
  { id: "disbursement-api", label: "Disbursement API", icon: Send },
  { id: "webhooks", label: "Webhook Registration", icon: Webhook },
  { id: "webhook-payloads", label: "Webhook Payload Examples", icon: FileJson },
  { id: "signatures", label: "HMAC-SHA256 Signatures", icon: ShieldCheck },
];

const NODE_HMAC_EXAMPLE = `const crypto = require("crypto");

/**
 * Verifies an inbound Soila Pay / Moola webhook.
 * @param {string} rawBody - the exact, unparsed request body string
 * @param {string} secret - your webhook secret (from /settings/api)
 * @param {string} signatureHeader - value of the X-Moola-Signature header
 */
function verifyWebhookSignature(rawBody, secret, signatureHeader) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  const provided = signatureHeader.replace(/^sha256=/, "");

  // Constant-time comparison to avoid timing attacks
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Express.js example
app.post("/webhooks/soila-pay", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.header("X-Moola-Signature");
  const timestamp = req.header("X-Moola-Timestamp");
  const rawBody = req.body.toString("utf8");

  if (!verifyWebhookSignature(rawBody, process.env.WEBHOOK_SECRET, signature)) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = JSON.parse(rawBody);
  console.log("Verified webhook event:", event.event);
  res.status(200).json({ received: true });
});`;

const LOGIN_CURL = `curl -X POST "https://agenttestapi.ddin.rw/api/v1/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{
    "username": "your-agent-username",
    "password": "your-agent-password"
  }'`;

const LOGIN_RESPONSE = `{
  "user": {
    "id": "usr-001",
    "username": "your-agent-username",
    "displayName": "Mifos Administrator",
    "roles": ["Super User", "Ops Admin"],
    "officeName": "Head Office"
  },
  "tokens": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expiresAt": "2026-08-07T12:00:00Z"
  }
}`;

const REFRESH_CURL = `curl -X POST "https://agenttestapi.ddin.rw/api/v1/auth/refresh" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <expired-or-expiring-access-token>" \\
  -d '{ "refreshToken": "<refresh-token>" }'`;

const COLLECTION_CURL = `curl -X POST "https://agenttestapi.ddin.rw/api/v1/collection/collect" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: idem-2f6a9c-0001" \\
  -H "Integrator-Key: sk_your_integrator_key" \\
  -d '{
    "fineract_savings_account_id": "12345",
    "provider": "MTN",
    "customer_account_number": "0788123456",
    "customer_name": "Jean Uwimana",
    "amount_rwf": 5000
  }'`;

const COLLECTION_RESPONSE = `{
  "status": "SUCCESS",
  "idempotency_key": "idem-2f6a9c-0001",
  "fineract_savings_account_id": "12345",
  "debit_transaction_id": "9001",
  "refund_transaction_id": null,
  "provider_transaction_reference": "CYC-559013",
  "amount_rwf": 5000.00,
  "message": "Collection completed successfully",
  "refunded": false
}`;

const DISBURSEMENT_SHAPE = `// PLANNED - not yet live. Shape mirrors the Collection API's
// idempotency + status-machine contract for consistency.

POST /api/v1/disbursement/payout
Headers: Idempotency-Key: <unique-per-attempt>

{
  "fineract_savings_account_id": "12345",
  "recipient_msisdn": "0788123456",
  "channel": "MTN",
  "amount_rwf": 25000,
  "narration": "Loan disbursement"
}

// Response (planned)
{
  "status": "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
  "idempotency_key": "...",
  "disbursement_id": "DIS-000123",
  "recipient_msisdn": "0788123456",
  "amount_rwf": 25000,
  "message": "..."
}`;

const WEBHOOK_REGISTER_CURL = `curl -X POST "https://agenttestapi.ddin.rw/api/v1/webhooks" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <access-token>" \\
  -d '{
    "url": "https://your-server.example.com/webhooks/soila-pay",
    "events": ["collection.success", "collection.failed_refunded", "disbursement.completed"]
  }'`;

const WEBHOOK_PAYLOAD_SUCCESS = `{
  "event": "collection.success",
  "idempotency_key": "idem-2f6a9c-0001",
  "fineract_savings_account_id": "12345",
  "provider": "MTN",
  "customer_account_number": "0788123456",
  "amount_rwf": 5000,
  "status": "SUCCESS",
  "provider_transaction_reference": "CYC-559013",
  "timestamp": "2026-08-07T11:42:00Z"
}`;

const WEBHOOK_PAYLOAD_REFUNDED = `{
  "event": "collection.failed_refunded",
  "idempotency_key": "idem-2f6a9c-0002",
  "fineract_savings_account_id": "12345",
  "provider": "MTN",
  "customer_account_number": "00000000000",
  "amount_rwf": 5000,
  "status": "FAILED_REFUNDED",
  "refund_transaction_id": "9014",
  "message": "Collection failed. Funds were refunded successfully.",
  "timestamp": "2026-08-07T11:45:12Z"
}`;

function SectionHeading({ id, icon: Icon, children }: { id: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-20 flex items-center gap-2 text-lg font-semibold text-foreground">
      <Icon className="h-5 w-5 text-primary" />
      {children}
    </h2>
  );
}

export default function DeveloperPortalPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "Developer Portal" }]} />
        <h1 className="mt-1 text-xl font-semibold text-foreground">Developer Portal</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Integration reference for the Soila Pay middleware and the Moola webhook contract.
          Base URL: <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">https://agenttestapi.ddin.rw</code>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="h-fit lg:sticky lg:top-6">
          <Card className="p-2">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <s.icon className="h-4 w-4" />
                {s.label}
              </a>
            ))}
          </Card>
          <Card className="mt-3 p-3">
            <p className="text-xs text-muted-foreground">
              Want to try these live?{" "}
              <Link href="/playground" className="font-medium text-primary hover:underline">
                Open the API Playground →
              </Link>
            </p>
          </Card>
        </nav>

        <div className="flex flex-col gap-10">
          {/* Authentication */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="authentication" icon={KeyRound}>
              Authentication
            </SectionHeading>
            <p className="text-sm text-muted-foreground">
              The API uses short-lived JWT access tokens plus a longer-lived refresh token.
              Send the access token as <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">Authorization: Bearer &lt;token&gt;</code> on every
              authenticated request.
            </p>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">1. Login</p>
              <CodeBlock code={LOGIN_CURL} lang="bash" filename="Request" />
              <div className="mt-2">
                <CodeBlock code={LOGIN_RESPONSE} lang="json" filename="200 OK" />
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">2. Refresh an expiring token</p>
              <CodeBlock code={REFRESH_CURL} lang="bash" filename="Request" />
              <p className="mt-2 text-xs text-muted-foreground">
                Access tokens expire after 15 minutes. Refresh proactively before expiry, or on
                receiving a <code className="rounded bg-secondary px-1 py-0.5 font-mono">401</code> response.
              </p>
            </div>
          </section>

          {/* Collection API */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="collection-api" icon={Wallet}>
              Collection API
            </SectionHeading>
            <p className="text-sm text-muted-foreground">
              Debits a customer&apos;s mobile money account (MTN/Airtel) via DDIN and deposits the
              result into a Fineract savings wallet. Idempotent - retried requests with the same{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">Idempotency-Key</code>{" "}
              return the original result rather than double-debiting. On provider failure, the
              debit is automatically refunded.
            </p>
            <CodeBlock code={COLLECTION_CURL} lang="bash" filename="POST /api/v1/collection/collect" />
            <CodeBlock code={COLLECTION_RESPONSE} lang="json" filename="200 OK" />
            <div className="flex flex-wrap gap-2">
              <StatusBadge variant="success">SUCCESS</StatusBadge>
              <StatusBadge variant="warning">FAILED_REFUNDED</StatusBadge>
              <StatusBadge variant="destructive">FAILED_REFUND_ERROR</StatusBadge>
              <StatusBadge variant="destructive">409 idempotency conflict</StatusBadge>
            </div>
          </section>

          {/* Disbursement API */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="disbursement-api" icon={Send}>
              Disbursement API
            </SectionHeading>
            <div className="flex items-center gap-2">
              <StatusBadge variant="outline">Placeholder</StatusBadge>
              <p className="text-xs text-muted-foreground">
                Not yet implemented in the production middleware - shape shown for forward
                compatibility. <code className="rounded bg-secondary px-1 py-0.5 font-mono">services/disbursement.service.ts</code> already
                mocks this contract.
              </p>
            </div>
            <CodeBlock code={DISBURSEMENT_SHAPE} lang="js" filename="Planned contract" />
          </section>

          {/* Webhook registration */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="webhooks" icon={Webhook}>
              Webhook Registration
            </SectionHeading>
            <p className="text-sm text-muted-foreground">
              Register a URL to receive lifecycle events for collections and disbursements.
              Available events: <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">collection.success</code>,{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">collection.failed_refunded</code>,{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">disbursement.completed</code>,{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">disbursement.failed</code>.
            </p>
            <CodeBlock code={WEBHOOK_REGISTER_CURL} lang="bash" filename="POST /api/v1/webhooks" />
            <p className="text-xs text-muted-foreground">
              You can also manage active webhooks (enable/disable, delete) - see{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">services/webhook.service.ts</code>.
            </p>
          </section>

          {/* Webhook payload examples */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="webhook-payloads" icon={FileJson}>
              Webhook Payload Examples
            </SectionHeading>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">collection.success</p>
              <CodeBlock code={WEBHOOK_PAYLOAD_SUCCESS} lang="json" />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">collection.failed_refunded</p>
              <CodeBlock code={WEBHOOK_PAYLOAD_REFUNDED} lang="json" />
            </div>
          </section>

          {/* HMAC signatures */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="signatures" icon={ShieldCheck}>
              HMAC-SHA256 Signature Verification
            </SectionHeading>
            <p className="text-sm text-muted-foreground">
              Every webhook delivery is signed. Always verify the signature before trusting a
              payload - never process a webhook whose signature doesn&apos;t match.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Signature Headers</CardTitle>
                <CardDescription>Sent with every webhook delivery</CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["Content-Type", "application/json"],
                      ["X-Moola-Event", "e.g. collection.success"],
                      ["X-Moola-Timestamp", "ISO-8601 delivery timestamp"],
                      ["X-Moola-Signature", "hex-encoded HMAC-SHA256 of the raw request body"],
                    ].map(([header, desc]) => (
                      <tr key={header} className="border-b border-border last:border-0">
                        <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-primary">
                          {header}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <div>
              <p className="mb-2 text-sm font-medium text-foreground">
                Node.js verification example
              </p>
              <CodeBlock code={NODE_HMAC_EXAMPLE} lang="js" filename="verify-webhook.js" />
            </div>

            <SignatureVerifier />
          </section>
        </div>
      </div>
    </div>
  );
}
