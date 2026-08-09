"use client";

import * as React from "react";
import { Copy, Check, Eye, EyeOff, Terminal, Code2, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { cn } from "@/lib/utils";

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://pay.soila.rw";

type Lang = "curl" | "javascript" | "python";

function curlExample(apiKey: string, accountId: string) {
  return `curl -X POST "${BASE_URL}/api/v1/collection/collect" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Integrator-Key: ${apiKey}" \\
  -d '{
    "fineract_savings_account_id": "${accountId}",
    "provider": "MTN",
    "customer_account_number": "0788123456",
    "customer_name": "Jean Uwimana",
    "amount_rwf": 5000
  }'`;
}

function jsExample(apiKey: string, accountId: string) {
  return `// Node.js / Browser — fetch
const response = await fetch("${BASE_URL}/api/v1/collection/collect", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": crypto.randomUUID(),
    "Integrator-Key": "${apiKey}",
  },
  body: JSON.stringify({
    fineract_savings_account_id: "${accountId}",
    provider: "MTN",
    customer_account_number: "0788123456",
    customer_name: "Jean Uwimana",
    amount_rwf: 5000,
  }),
});

const result = await response.json();
console.log(result.status); // "SUCCESS" | "FAILED_REFUNDED" | "FAILED_REFUND_ERROR"`;
}

function pythonExample(apiKey: string, accountId: string) {
  return `import requests, uuid

url = "${BASE_URL}/api/v1/collection/collect"
headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": str(uuid.uuid4()),
    "Integrator-Key": "${apiKey}",
}
body = {
    "fineract_savings_account_id": "${accountId}",
    "provider": "MTN",
    "customer_account_number": "0788123456",
    "customer_name": "Jean Uwimana",
    "amount_rwf": 5000,
}

resp = requests.post(url, json=body, headers=headers)
resp.raise_for_status()
print(resp.json()["status"])  # SUCCESS | FAILED_REFUNDED | FAILED_REFUND_ERROR`;
}

const SUCCESS_RESPONSE = `{
  "status": "SUCCESS",
  "idempotency_key": "3fa2-c7d1-0001",
  "fineract_savings_account_id": "1",
  "debit_transaction_id": "9001",
  "refund_transaction_id": null,
  "provider_transaction_reference": "CYC-559013",
  "amount_rwf": 5000.00,
  "message": "Collection completed successfully",
  "refunded": false
}`;

const FAILED_RESPONSE = `{
  "status": "FAILED_REFUNDED",
  "idempotency_key": "3fa2-c7d1-0002",
  "fineract_savings_account_id": "1",
  "debit_transaction_id": "9002",
  "refund_transaction_id": "9003",
  "provider_transaction_reference": null,
  "amount_rwf": 5000.00,
  "message": "Provider rejected the payment. Float refunded.",
  "refunded": true
}`;

const IDEMPOTENCY_NOTE = `// Same Idempotency-Key within 24 h returns the original result — no double-debit.
// Use a unique key per payment attempt; reuse the same key only to safely retry.`;

const STATUSES = [
  { label: "SUCCESS", tone: "success" as const, desc: "Debit + Fineract deposit both completed." },
  { label: "FAILED_REFUNDED", tone: "warning" as const, desc: "Provider rejected. Float auto-refunded." },
  { label: "FAILED_REFUND_ERROR", tone: "destructive" as const, desc: "Provider failed and refund also failed — contact support." },
  { label: "409 Conflict", tone: "destructive" as const, desc: "Duplicate Idempotency-Key with a different payload." },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary/80 transition-colors"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const TABS: { id: Lang; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "curl", label: "cURL", icon: Terminal },
  { id: "javascript", label: "JavaScript", icon: Code2 },
  { id: "python", label: "Python", icon: Code2 },
];

export default function DevToolsPage() {
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const fineractAccountId = useIntegratorPortalStore((s) => s.fineractAccountId);
  const [lang, setLang] = React.useState<Lang>("curl");
  const [keyVisible, setKeyVisible] = React.useState(false);

  const apiKey = integrator?.sandboxApiKey ?? "sk_your_sandbox_key";
  const accountId = fineractAccountId || "1";

  const codeMap: Record<Lang, { code: string; lang: "bash" | "js" | "js" }> = {
    curl: { code: curlExample(apiKey, accountId), lang: "bash" },
    javascript: { code: jsExample(apiKey, accountId), lang: "js" },
    python: { code: pythonExample(apiKey, accountId), lang: "js" },
  };
  const current = codeMap[lang];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Developer Tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your sandbox API key, code examples, and response reference for the Collection API.
        </p>
      </div>

      {/* API Key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your Sandbox API Key</CardTitle>
          <CardDescription>
            Pass this as the <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">Integrator-Key</code> header on every request.
            Keep it secret — do not commit it to version control.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-code-bg px-3 py-2.5 font-mono text-xs text-code-foreground">
              <span className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-thin">
                {keyVisible ? apiKey : "sk_" + "•".repeat(Math.max(0, apiKey.length - 3))}
              </span>
            </div>
            <button
              onClick={() => setKeyVisible((v) => !v)}
              className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {keyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {keyVisible ? "Hide" : "Reveal"}
            </button>
            <CopyButton text={apiKey} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Base URL: <code className="rounded bg-secondary px-1 py-0.5 font-mono">{BASE_URL}</code>
          </p>
        </CardContent>
      </Card>

      {/* Code examples */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Collection API</CardTitle>
              <CardDescription>
                <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">POST /api/v1/collection/collect</code>
                {" "}— debit a customer&apos;s mobile money account
              </CardDescription>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-secondary/50 p-0.5">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setLang(tab.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      lang === tab.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CodeBlock
            code={current.code}
            lang={current.lang as "bash" | "js"}
            filename={
              lang === "curl"
                ? "terminal"
                : lang === "javascript"
                ? "collect.js"
                : "collect.py"
            }
          />
          <CodeBlock
            code={IDEMPOTENCY_NOTE}
            lang="js"
            filename="Idempotency"
          />
        </CardContent>
      </Card>

      {/* Responses */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Success Response</CardTitle>
              <StatusBadge variant="success">200 OK</StatusBadge>
            </div>
          </CardHeader>
          <CardContent>
            <CodeBlock code={SUCCESS_RESPONSE} lang="json" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Failed Response</CardTitle>
              <StatusBadge variant="warning">200 OK</StatusBadge>
            </div>
          </CardHeader>
          <CardContent>
            <CodeBlock code={FAILED_RESPONSE} lang="json" />
          </CardContent>
        </Card>
      </div>

      {/* Status reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Reference</CardTitle>
          <CardDescription>Possible values of the <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">status</code> field</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border rounded-md border border-border">
            {STATUSES.map((s) => (
              <div key={s.label} className="flex items-start gap-4 px-4 py-3">
                <StatusBadge variant={s.tone} className="mt-0.5 shrink-0">
                  {s.label}
                </StatusBadge>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Disbursement coming soon */}
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4 text-muted-foreground" />
              Disbursement API
            </CardTitle>
            <StatusBadge variant="warning">Coming Soon</StatusBadge>
          </div>
          <CardDescription>
            Send money directly to mobile money accounts. This API is under development and will be available soon.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
