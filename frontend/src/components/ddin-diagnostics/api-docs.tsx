"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type Tab = "curl" | "javascript" | "python" | "java" | "response";

const TABS: { id: Tab; label: string; lang: "bash" | "js" | "json" }[] = [
  { id: "curl", label: "cURL", lang: "bash" },
  { id: "javascript", label: "JavaScript", lang: "js" },
  { id: "python", label: "Python", lang: "json" },
  { id: "java", label: "Java", lang: "json" },
  { id: "response", label: "Response", lang: "json" },
];

const SAMPLE_RESPONSE = `{
  "overall_status": "PASS",
  "base_url": "https://agenttestapi.ddin.rw",
  "correlation_id": "a1b2c3d4e5f6a7b8",
  "total_duration_ms": 842.6,
  "ran_at": "2026-08-07T12:00:00Z",
  "steps": [
    { "step": "config", "status": "PASS", "latency_ms": null, "message": "...",
      "category": null, "troubleshooting": [], "detail": null,
      "request_response": null, "correlation_id": "a1b2c3d4e5f6a7b8",
      "started_at": "2026-08-07T12:00:00.000Z" },
    { "step": "login", "status": "PASS", "latency_ms": 312.4, "message": "Logged in successfully (200)",
      "category": null, "troubleshooting": [],
      "detail": { "success": true, "data": { "accessToken": "********", "refreshToken": "********" } },
      "request_response": {
        "method": "POST", "url": "https://agenttestapi.ddin.rw/v1/agency/auth/login",
        "headers": {}, "body": { "username": "agent-user", "password": "********" },
        "status_code": 200,
        "response_body": { "success": true, "data": { "accessToken": "********", "refreshToken": "********" } }
      },
      "correlation_id": "a1b2c3d4e5f6a7b8", "started_at": "2026-08-07T12:00:00.312Z" }
  ]
}`;

const ERROR_RESPONSES = [
  { status: "401 UNAUTHORIZED", meaning: "DDIN rejected the credentials in DDIN_USERNAME/DDIN_PASSWORD, or a token expired mid-chain." },
  { status: "422 Unprocessable Entity", meaning: "The request body sent to our own middleware didn't match the expected schema (only relevant if you're calling this endpoint directly, not via the console)." },
  { status: "500 Internal Server Error", meaning: "Our own middleware crashed outside the diagnostics logic itself - check middleware application logs, not DDIN." },
  { status: "Network / connection refused", meaning: "The middleware itself is unreachable - confirm it's running and CORS_ALLOWED_ORIGINS includes the console's origin." },
];

function buildExamples(fullUrl: string, body: string) {
  return {
    curl: `curl -X POST "${fullUrl}" \\
  -H "Content-Type: application/json" \\
  -d '${body}'`,
    javascript: `const res = await fetch("${fullUrl}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: '${body}',
});
const result = await res.json();
console.log(result.overall_status, result.steps);`,
    python: `import httpx

response = httpx.post(
    "${fullUrl}",
    json=${body},
    timeout=30,
)
result = response.json()
print(result["overall_status"], result["steps"])`,
    java: `HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("${fullUrl}"))
    .header("Content-Type", "application/json")
    .POST(HttpRequest.BodyPublishers.ofString(
        "${body}"))
    .build();

HttpResponse<String> response =
    client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`,
  };
}

export function ApiDocsCard({ fullUrl, requestBodyJson }: { fullUrl: string; requestBodyJson: string }) {
  const [tab, setTab] = React.useState<Tab>("curl");
  const examples = buildExamples(fullUrl, requestBodyJson);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-success">POST</span>
          <code className="rounded bg-secondary px-2 py-0.5 font-mono text-xs text-foreground">
            /api/v1/admin/ddin/diagnostics
          </code>
        </div>
        <CardDescription>
          Runs on our own middleware, which then calls out to DDIN using the DDIN_USERNAME /
          DDIN_PASSWORD configured in <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">.env</code>.
          Never touches Fineract or our own transaction_logs, never debits a wallet, never writes to
          transaction_logs. A streaming variant is available at{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">/diagnostics/stream</code>{" "}
          (newline-delimited JSON, one step per line) - used by this page&apos;s live view.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <div className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-t-md px-3 py-2 text-xs font-medium transition-colors",
                  tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="pt-3">
            {tab === "curl" && <CodeBlock code={examples.curl} lang="bash" />}
            {tab === "javascript" && <CodeBlock code={examples.javascript} lang="js" />}
            {tab === "python" && <CodeBlock code={examples.python} lang="json" />}
            {tab === "java" && <CodeBlock code={examples.java} lang="json" />}
            {tab === "response" && <CodeBlock code={SAMPLE_RESPONSE} lang="json" />}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Error Responses
          </p>
          <div className="flex flex-col gap-2">
            {ERROR_RESPONSES.map((e) => (
              <div key={e.status} className="flex items-start gap-2 text-xs">
                <StatusBadge variant="outline" className="shrink-0 font-mono">
                  {e.status}
                </StatusBadge>
                <span className="text-muted-foreground">{e.meaning}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
