"use client";

import * as React from "react";
import { Play, Copy, Check, Clock, Hash, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { JsonViewer } from "@/components/ui/json-viewer";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { PLAYGROUND_ENDPOINTS } from "@/data/mock/playground-endpoints";
import { executePlaygroundRequest } from "@/lib/playground-executor";
import { buildCurlCommand, buildRequestSummary } from "@/lib/curl";
import { useSettingsStore } from "@/store/settings-store";
import { toast } from "@/store/toast-store";
import { cn } from "@/lib/utils";
import type { PlaygroundEndpoint, PlaygroundResult } from "@/types/api";

type Tab = "headers" | "body" | "response";

const METHOD_COLOR: Record<string, string> = {
  GET: "text-primary",
  POST: "text-success",
  PUT: "text-warning",
  DELETE: "text-destructive",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast({ title: `${label} copied to clipboard`, variant: "default" });
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

export default function PlaygroundPage() {
  const baseUrl = useSettingsStore((s) => s.baseUrl);
  const [selected, setSelected] = React.useState<PlaygroundEndpoint>(PLAYGROUND_ENDPOINTS[0]);
  const [headersText, setHeadersText] = React.useState(
    JSON.stringify(selected.defaultHeaders ?? {}, null, 2)
  );
  const [bodyText, setBodyText] = React.useState(JSON.stringify(selected.defaultBody ?? {}, null, 2));
  const [tab, setTab] = React.useState<Tab>("body");
  const [sending, setSending] = React.useState(false);
  const [result, setResult] = React.useState<PlaygroundResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function selectEndpoint(endpoint: PlaygroundEndpoint) {
    setSelected(endpoint);
    setHeadersText(JSON.stringify(endpoint.defaultHeaders ?? {}, null, 2));
    setBodyText(JSON.stringify(endpoint.defaultBody ?? {}, null, 2));
    setResult(null);
    setError(null);
    setTab("body");
  }

  async function handleSend() {
    setError(null);
    let headers: Record<string, string>;
    let body: Record<string, unknown>;
    try {
      headers = JSON.parse(headersText || "{}");
      body = JSON.parse(bodyText || "{}");
    } catch {
      setError("Headers and body must be valid JSON.");
      return;
    }
    setSending(true);
    const res = await executePlaygroundRequest(selected.id, body, headers);
    setResult(res);
    setSending(false);
    setTab("response");
  }

  const grouped = React.useMemo(() => {
    const map = new Map<string, PlaygroundEndpoint[]>();
    for (const ep of PLAYGROUND_ENDPOINTS) {
      map.set(ep.category, [...(map.get(ep.category) ?? []), ep]);
    }
    return map;
  }, []);

  let parsedHeaders: Record<string, string> = {};
  let parsedBody: Record<string, unknown> = {};
  try {
    parsedHeaders = JSON.parse(headersText || "{}");
  } catch {}
  try {
    parsedBody = JSON.parse(bodyText || "{}");
  } catch {}

  const fullUrl = `${baseUrl}${selected.path}`;
  const curl = buildCurlCommand(selected.method, fullUrl, parsedHeaders, parsedBody);
  const requestSummary = buildRequestSummary(selected.method, fullUrl, parsedHeaders, parsedBody);

  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "API Playground" }]} />
        <h1 className="mt-1 text-xl font-semibold text-foreground">API Playground</h1>
        <p className="text-sm text-muted-foreground">
          Try the middleware&apos;s endpoints directly from the browser - Swagger-style, running
          against {baseUrl || "the configured base URL"}.
        </p>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        {/* Endpoint list */}
        <Card className="h-fit overflow-hidden p-0 lg:sticky lg:top-6">
          {[...grouped.entries()].map(([category, endpoints]) => (
            <div key={category}>
              <p className="border-b border-border bg-secondary/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </p>
              {endpoints.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => selectEndpoint(ep)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-secondary/60",
                    selected.id === ep.id && "bg-primary/5"
                  )}
                >
                  <span className="flex items-center gap-2 text-xs">
                    <span className={cn("font-mono font-bold", METHOD_COLOR[ep.method])}>
                      {ep.method}
                    </span>
                    {ep.requiresAuth && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      selected.id === ep.id ? "text-primary" : "text-foreground"
                    )}
                  >
                    {ep.name}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </Card>

        {/* Request/response panel */}
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={cn("font-mono text-sm font-bold", METHOD_COLOR[selected.method])}>
                    {selected.method}
                  </span>
                  <code className="rounded bg-secondary px-2 py-0.5 font-mono text-xs text-foreground">
                    {selected.path}
                  </code>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{selected.description}</p>
              </div>
              <Button onClick={handleSend} loading={sending} className="shrink-0">
                <Play className="h-4 w-4" />
                Send
              </Button>
            </div>
          </Card>

          <Card className="flex-1 p-0">
            <div className="flex items-center gap-1 border-b border-border px-3 pt-2">
              {(["headers", "body", "response"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-t-md px-3 py-2 text-xs font-medium capitalize transition-colors",
                    tab === t
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t}
                  {t === "response" && result && (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />
                  )}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-2 py-1.5">
                <CopyButton text={requestSummary} label="Copy Request" />
                <CopyButton text={curl} label="Copy cURL" />
              </div>
            </div>

            <div className="p-4">
              {tab === "headers" && (
                <Textarea
                  value={headersText}
                  onChange={(e) => setHeadersText(e.target.value)}
                  className="min-h-48"
                  spellCheck={false}
                />
              )}
              {tab === "body" && (
                <Textarea
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="min-h-48"
                  spellCheck={false}
                  disabled={selected.method === "GET"}
                />
              )}
              {tab === "response" && (
                <div className="flex flex-col gap-3">
                  {error && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {error}
                    </p>
                  )}
                  {!result && !error && (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      Send a request to see the response here.
                    </p>
                  )}
                  {result && (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <StatusBadge variant={result.status < 300 ? "success" : result.status < 500 ? "warning" : "destructive"}>
                          <Hash className="h-3 w-3" /> {result.status} {result.statusText}
                        </StatusBadge>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" /> {result.timeMs}ms
                        </span>
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Response Headers
                        </p>
                        <div className="rounded-md border border-border bg-secondary/30 p-3 font-mono text-xs text-foreground">
                          {Object.entries(result.headers).map(([k, v]) => (
                            <div key={k}>
                              <span className="text-muted-foreground">{k}:</span> {v}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Response Body (Pretty JSON, dark mode)
                        </p>
                        <JsonViewer data={result.body} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
