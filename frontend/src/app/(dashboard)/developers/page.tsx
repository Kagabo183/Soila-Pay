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
import { useSettingsStore } from "@/store/settings-store";

const SECTIONS = [
  { id: "authentication", label: "Authentication", icon: KeyRound },
  { id: "collection-api", label: "Collection API", icon: Wallet },
  { id: "disbursement-api", label: "Disbursement API", icon: Send },
  { id: "webhooks", label: "Webhook Receiver", icon: Webhook },
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

const loginCurl = (baseUrl: string) => `curl -X POST "${baseUrl}/api/v1/admin/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{
    "username": "your-admin-username",
    "password": "your-admin-password"
  }'`;

const LOGIN_RESPONSE = `{
  "token": "eyJpbnRlZ3JhdG9yX2lk...signed-session-token"
}`;

const collectionCurl = (baseUrl: string) => `curl -X POST "${baseUrl}/api/v1/collection/collect" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: idem-2f6a9c-0001" \\
  -H "Integrator-Key: sk_your_integrator_key" \\
  -d '{
    "fineract_savings_account_id": "1",
    "provider": "MTN",
    "customer_account_number": "0788123456",
    "customer_name": "Jean Uwimana",
    "amount_rwf": 5000
  }'`;

const COLLECTION_RESPONSE = `{
  "status": "SUCCESS",
  "idempotency_key": "idem-2f6a9c-0001",
  "fineract_savings_account_id": "1",
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

const webhookReceiverEndpoint = (baseUrl: string) => `POST ${baseUrl}/api/v1/webhooks/ddin

Headers (sent BY DDIN, verify both):
  X-Moola-Event: collection.success | collection.failed
  X-Moola-Signature: <hex HMAC-SHA256 of the raw body, using your webhook secret>`;

const WEBHOOK_PAYLOAD_SUCCESS = `{
  "success": true,
  "message": "Collection successful",
  "data": {
    "referenceId": "idem-2f6a9c-0001",
    "transactionId": "CYC-559013",
    "operationReferenceId": "0bbf5b0b-fbc9-4a95-8320-3823d7333359"
  }
}`;

const WEBHOOK_PAYLOAD_FAILED = `{
  "success": true,
  "message": "Collection failed",
  "data": {
    "referenceId": "idem-2f6a9c-0002",
    "status": "failed",
    "message": "Customer declined the request"
  }
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
  // Pulled from /settings/api, not hardcoded - every curl example below uses
  // YOUR actual configured base URL, so they're genuinely copy-pasteable.
  const baseUrl = useSettingsStore((s) => s.baseUrl);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "Developer Portal" }]} />
        <h1 className="mt-1 text-xl font-semibold text-foreground">Developer Portal</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Integration reference for the Soila Pay middleware. Base URL:{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">{baseUrl}</code> -
          change it on{" "}
          <Link href="/settings/api" className="text-primary hover:underline">
            API Integration
          </Link>
          .
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
              There are two independent credential types - don&apos;t confuse them. An{" "}
              <strong className="text-foreground">Integrator-Key</strong> (below, Collection API)
              authenticates each collection request and identifies which integrator to bill/credit -
              no login step needed, just send the header. The{" "}
              <strong className="text-foreground">admin session token</strong> below is only for
              the operator console (integrator management, DDIN diagnostics) - obtained via the shared
              operator credential, not per-user.
            </p>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">Admin login</p>
              <CodeBlock code={loginCurl(baseUrl)} lang="bash" filename="Request" />
              <div className="mt-2">
                <CodeBlock code={LOGIN_RESPONSE} lang="json" filename="200 OK" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                The token is a self-contained, signed session (not a JWT) valid for 7 days - there is
                no separate refresh endpoint. Send it as{" "}
                <code className="rounded bg-secondary px-1 py-0.5 font-mono">
                  Authorization: Bearer &lt;token&gt;
                </code>{" "}
                and log in again once it expires.
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
            <CodeBlock code={collectionCurl(baseUrl)} lang="bash" filename="POST /api/v1/collection/collect" />
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
              <StatusBadge variant="warning">Coming Soon</StatusBadge>
              <p className="text-xs text-muted-foreground">
                The disbursement API is under development and will allow you to send money directly
                to mobile money accounts. The contract below shows the planned request/response
                shape — it is not yet live.
              </p>
            </div>
            <CodeBlock code={DISBURSEMENT_SHAPE} lang="js" filename="Planned contract" />
          </section>

          {/* Webhook receiver */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="webhooks" icon={Webhook}>
              Webhook Receiver
            </SectionHeading>
            <p className="text-sm text-muted-foreground">
              There is no self-service registration endpoint - unlike Collection, this isn&apos;t
              something you call. DDIN calls <strong className="text-foreground">us</strong>, at one
              fixed URL, when a collection you initiated resolves. Getting a real webhook secret and
              having DDIN actually call this URL requires it to be a real, publicly reachable
              address (not <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">localhost</code>)
              registered with DDIN directly - that part of their process isn&apos;t documented to us
              yet. Until then, you can still exercise this exact code path yourself from the{" "}
              <Link href="/playground" className="text-primary hover:underline">
                API Playground&apos;s Webhook Receiver Test
              </Link>{" "}
              - it signs a synthetic event and sends it here for real, which is also how a{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">PENDING</code>{" "}
              collection gets resolved locally without waiting on DDIN.
            </p>
            <CodeBlock code={webhookReceiverEndpoint(baseUrl)} lang="text" filename="Endpoint" />
          </section>

          {/* Webhook payload examples */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="webhook-payloads" icon={FileJson}>
              Webhook Payload Examples
            </SectionHeading>
            <p className="text-xs text-muted-foreground">
              ASSUMPTION, not confirmed against real DDIN webhook traffic (we don&apos;t have a
              publicly reachable receiver for DDIN to call yet - see above). This is the exact shape{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">app/api/v1/webhooks.py</code>{" "}
              parses (<code className="rounded bg-secondary px-1 py-0.5 font-mono">data.referenceId</code>,{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">data.transactionId</code> /{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono">operationReferenceId</code>),
              inferred from DDIN&apos;s other responses (collection/initiate also nests its payload
              under <code className="rounded bg-secondary px-1 py-0.5 font-mono">data</code>) -
              confirm and correct once real webhook traffic arrives.
            </p>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">X-Moola-Event: collection.success</p>
              <CodeBlock code={WEBHOOK_PAYLOAD_SUCCESS} lang="json" />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">X-Moola-Event: collection.failed</p>
              <CodeBlock code={WEBHOOK_PAYLOAD_FAILED} lang="json" />
            </div>
          </section>

          {/* HMAC signatures */}
          <section className="flex flex-col gap-4">
            <SectionHeading id="signatures" icon={ShieldCheck}>
              HMAC-SHA256 Signature Verification
            </SectionHeading>
            <p className="text-sm text-muted-foreground">
              Every webhook delivery is signed. Always verify the signature before trusting a
              payload - never process a webhook whose signature doesn&apos;t match. The two headers
              below are CONFIRMED - they&apos;re exactly what{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">app/api/v1/webhooks.py</code>{" "}
              requires and verifies today. <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">X-Moola-Timestamp</code>{" "}
              is not currently sent or checked by our receiver - shown as a common convention worth
              adding (replay protection) once real DDIN webhook traffic is confirmed to include it.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Signature Headers</CardTitle>
                <CardDescription>Required and verified by our receiver today, unless noted</CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <tbody>
                    {[
                      ["Content-Type", "application/json"],
                      ["X-Moola-Event", "collection.success | collection.failed - required, checked"],
                      ["X-Moola-Signature", "hex-encoded HMAC-SHA256 of the raw request body - required, verified"],
                      ["X-Moola-Timestamp", "NOT currently sent or checked - proposed, not implemented"],
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
