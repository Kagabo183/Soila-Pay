"use client";

import * as React from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeHmacSha256Hex } from "@/lib/hmac";
import { useSettingsStore } from "@/store/settings-store";
import { BkPanel } from "./brutal";

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        })
      }
      className="bk-btn bk-fill-paper min-h-7 px-2 py-0.5 text-[10px]"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {done ? "Copied" : "Copy"}
    </button>
  );
}

function Code({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="bk-display text-xs font-bold uppercase">{title}</span>
        <CopyBtn text={code} />
      </div>
      <pre className="bk-code max-h-80">{code}</pre>
    </div>
  );
}

function Endpoint({ method, path, children }: { method: "GET" | "POST"; path: string; children: React.ReactNode }) {
  return (
    <section className="bk-card min-w-0">
      <header className="flex flex-wrap items-center gap-2 border-b-2 border-[var(--bk-ink)] px-4 py-3">
        <span className={cn("bk-tag", method === "POST" ? "bk-fill-green" : "bk-fill-blue")}>{method}</span>
        <code className="font-mono text-sm font-bold">{path}</code>
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}

const SECTIONS = [
  { id: "auth", label: "Authentication" },
  { id: "collect", label: "Collect (cards, MoMo)" },
  { id: "status", label: "Check status" },
  { id: "payout", label: "Pay out" },
  { id: "webhooks", label: "Webhooks" },
  { id: "errors", label: "Statuses & errors" },
];

/** The one integration reference, shared by the admin console (/developers)
 * and the integrator portal (/portal/dev-tools). Describes the real API only. */
export function ApiDocs({ integratorKey }: { integratorKey?: string }) {
  const configured = useSettingsStore((s) => s.baseUrl);
  const base = (configured || "http://localhost:8000").replace(/\/$/, "");
  const key = integratorKey ?? "YOUR_INTEGRATOR_KEY";

  const collectCard = `curl -X POST ${base}/api/v1/payments \\
  -H "Content-Type: application/json" \\
  -H "Integrator-Key: ${key}" \\
  -d '{
    "channel": "VISA",
    "amount_rwf": 10000,
    "customer_name": "Aline Uwase",
    "customer_email": "aline@example.com",
    "description": "Order 1024",
    "return_url": "https://your-shop.rw/thank-you"
  }'`;
  const collectCardResponse = `{
  "reference_id": "SP-20261108-9F2C41AB",
  "direction": "COLLECTION",
  "status": "PENDING",
  "method": "CARD",
  "channel": "VISA",
  "amount_rwf": 10000.0,
  "fee_percentage": 6.0,
  "fee_amount_rwf": 600.0,
  "redirect_url": "https://pay.lmbtech.rw/pay/pesapal/iframe.php?reference_id=…",
  "is_test": true,
  ...
}`;
  const collectMomo = `curl -X POST ${base}/api/v1/payments \\
  -H "Content-Type: application/json" \\
  -H "Integrator-Key: ${key}" \\
  -d '{
    "channel": "MTN_MOMO",
    "amount_rwf": 2000,
    "customer_name": "Jean Mugisha",
    "customer_email": "jean@example.com",
    "customer_phone": "0788123456"
  }'`;
  const statusCurl = `curl ${base}/api/v1/payments/SP-20261108-9F2C41AB \\
  -H "Integrator-Key: ${key}"`;
  const listCurl = `curl "${base}/api/v1/payments?direction=COLLECTION&status=SUCCESS&page=1&pageSize=20" \\
  -H "Integrator-Key: ${key}"`;
  const payoutCurl = `curl -X POST ${base}/api/v1/disbursements \\
  -H "Content-Type: application/json" \\
  -H "Integrator-Key: ${key}" \\
  -d '{
    "amount_rwf": 5000,
    "recipient_name": "Aline Uwase",
    "recipient_phone": "0788123456",
    "description": "Refund order 1024"
  }'`;
  const balanceCurl = `curl ${base}/api/v1/disbursements/balance \\
  -H "Integrator-Key: ${key}"`;
  const webhookBody = `POST https://your-server.rw/webhooks/soila
X-Soila-Event: payment.success
X-Soila-Signature: sha256=<hex HMAC-SHA256 of the raw body>

{
  "event": "payment.success",
  "reference_id": "SP-20261108-9F2C41AB",
  "direction": "COLLECTION",
  "status": "SUCCESS",
  "method": "CARD",
  "channel": "VISA",
  "amount_rwf": 10000.0,
  "fee_rwf": 600.0,
  "gateway_transaction_id": "…",
  "is_test": false
}`;
  const verifyNode = `import crypto from "node:crypto";

// Use the RAW request body (before JSON.parse).
function isFromSoilaPay(rawBody, signatureHeader, secret) {
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader || ""));
}`;

  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-6">
        <header>
          <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">API Docs</h1>
          <p className="bk-muted mt-1 max-w-2xl text-sm">
            Collect card and MTN MoMo payments and send payouts with a few HTTP calls. Every example below is real and ready to copy.
          </p>
          <p className="mt-2 text-sm">
            Base URL: <code className="bk-tag bk-fill-paper font-mono normal-case">{base}</code>
          </p>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="bk-btn bk-fill-paper min-h-9 px-3 text-xs">
              {s.label}
            </a>
          ))}
        </nav>

        <div id="auth" className="scroll-mt-4">
          <BkPanel title="1 · Authentication" tone="bk-fill-yellow">
            <p className="text-sm">
              Send your key in the <code className="font-mono font-bold">Integrator-Key</code> header on every request. Use the{" "}
              <b>sandbox key</b> while testing; you get a <b>production key</b> after “Go Live” approval.
            </p>
            {integratorKey ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="bk-box bk-fill-paper break-all px-2 py-1 font-mono text-xs">{integratorKey}</code>
                <CopyBtn text={integratorKey} />
              </div>
            ) : (
              <p className="bk-muted mt-2 text-xs">Each integrator finds their key in their portal.</p>
            )}
          </BkPanel>
        </div>

        <div id="collect" className="flex scroll-mt-4 flex-col gap-4">
          <Endpoint method="POST" path="/api/v1/payments">
            <p className="text-sm">
              <b>Cards</b> (<code className="font-mono">VISA</code>, <code className="font-mono">MASTERCARD</code>,{" "}
              <code className="font-mono">OTHER_CARD</code>): send the customer to <code className="font-mono">redirect_url</code> to type their card
              on the bank&apos;s secure page. Afterwards they come back to your <code className="font-mono">return_url</code>.{" "}
              <b>MTN MoMo</b> (<code className="font-mono">MTN_MOMO</code>): add <code className="font-mono">customer_phone</code>; the customer
              approves on their phone.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <Code title="Card payment" code={collectCard} />
              <Code title="Response (201)" code={collectCardResponse} />
            </div>
            <Code title="MTN MoMo payment" code={collectMomo} />
            <p className="bk-muted text-xs">
              Optional: <code className="font-mono">reference_id</code> (your own unique ID - sending it twice is refused, so a retry can never charge twice).
              Amounts are whole RWF, 100 – 5,000,000.
            </p>
          </Endpoint>
        </div>

        <div id="status" className="flex scroll-mt-4 flex-col gap-4">
          <Endpoint method="GET" path="/api/v1/payments/{reference_id}">
            <p className="text-sm">Returns the latest status (it re-checks with the gateway when a payment is still waiting). Works for payouts too.</p>
            <Code title="Request" code={statusCurl} />
          </Endpoint>
          <Endpoint method="GET" path="/api/v1/payments">
            <p className="text-sm">
              Your transactions, newest first. Filters: <code className="font-mono">direction</code> (COLLECTION / DISBURSEMENT),{" "}
              <code className="font-mono">status</code>, <code className="font-mono">method</code> (CARD / MOMO).
            </p>
            <Code title="Request" code={listCurl} />
          </Endpoint>
        </div>

        <div id="payout" className="flex scroll-mt-4 flex-col gap-4">
          <Endpoint method="POST" path="/api/v1/disbursements">
            <p className="text-sm">
              Send money to an <b>MTN</b> number (078 / 079). It comes from your <b>available balance</b> = your successful collections, minus fees,
              minus earlier payouts and their fees. If the balance is too low you get <code className="font-mono">402</code> and nothing is sent.
            </p>
            <Code title="Request" code={payoutCurl} />
          </Endpoint>
          <Endpoint method="GET" path="/api/v1/disbursements/balance">
            <Code title="Request" code={balanceCurl} />
            <Code title="Response" code={`{ "available_balance_rwf": 14290.0 }`} />
          </Endpoint>
        </div>

        <div id="webhooks" className="flex scroll-mt-4 flex-col gap-4">
          <BkPanel title="Webhooks" tone="bk-fill-pink">
            <p className="text-sm">
              Register a URL in the portal (Webhooks) to be told the moment something finishes:{" "}
              <code className="font-mono">payment.success</code>, <code className="font-mono">payment.failed</code>,{" "}
              <code className="font-mono">disbursement.success</code>, <code className="font-mono">disbursement.failed</code>. Always check the signature
              before trusting a webhook.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Code title="What we send" code={webhookBody} />
              <Code title="Verify it (Node.js)" code={verifyNode} />
            </div>
          </BkPanel>
          <SignatureChecker />
        </div>

        <div id="errors" className="scroll-mt-4">
          <BkPanel title="Statuses & errors">
            <div className="grid gap-6 md:grid-cols-2">
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["PENDING", "Waiting for the customer / bank / MTN"],
                    ["SUCCESS", "Paid (or payout delivered)"],
                    ["FAILED", "Declined, timed out or refused - see status_message"],
                    ["CANCELLED", "Cancelled by the customer or the bank"],
                  ].map(([s, d]) => (
                    <tr key={s} className="border-b border-[var(--bk-ink)]/20 last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs font-bold">{s}</td>
                      <td className="py-2">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ["401", "Missing or wrong Integrator-Key"],
                    ["402", "Payout larger than your available balance"],
                    ["403", "Integrator account disabled"],
                    ["404", "Unknown reference (or not yours)"],
                    ["409", "reference_id already used"],
                    ["422", "Invalid input - the message says what to fix"],
                    ["503", "Payments temporarily not configured"],
                  ].map(([c, d]) => (
                    <tr key={c} className="border-b border-[var(--bk-ink)]/20 last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs font-bold">{c}</td>
                      <td className="py-2">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </BkPanel>
        </div>
      </div>
    </div>
  );
}

/** Paste a webhook you received and your secret to confirm it's genuine. */
function SignatureChecker() {
  const [body, setBody] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [header, setHeader] = React.useState("");
  const [result, setResult] = React.useState<null | { ok: boolean; expected: string }>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const expected = "sha256=" + (await computeHmacSha256Hex(body, secret));
    setResult({ ok: expected === header.trim(), expected });
  }

  return (
    <BkPanel title="Check a webhook signature" tone="bk-fill-green">
      <form onSubmit={check} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-bold uppercase">
          Raw body (exactly as received)
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="bk-input font-mono text-xs normal-case" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-bold uppercase">
            Webhook secret
            <input value={secret} onChange={(e) => setSecret(e.target.value)} className="bk-input font-mono text-xs normal-case" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase">
            X-Soila-Signature header
            <input value={header} onChange={(e) => setHeader(e.target.value)} placeholder="sha256=…" className="bk-input font-mono text-xs normal-case" />
          </label>
        </div>
        <button type="submit" disabled={!body || !secret || !header} className="bk-btn bk-fill-ink self-start">
          <ShieldCheck className="h-4 w-4" /> Check
        </button>
        {result && (
          <p className={cn("bk-box p-3 text-sm font-semibold", result.ok ? "bk-fill-green" : "bk-fill-red")}>
            {result.ok ? "✓ Genuine - this came from Soila Pay." : `✕ Does not match. Expected ${result.expected}`}
          </p>
        )}
      </form>
    </BkPanel>
  );
}
