"use client";

import * as React from "react";
import { Link2, Trash2, AlertTriangle, Copy, Check, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { integratorPortalService } from "@/services/integrator-portal.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import type { IntegratorWebhook, IntegratorWebhookCreated } from "@/types/api";

const EVENT_OPTIONS = [
  {
    id: "collection.success",
    label: "collection.success",
    desc: "Fired when a collection completes successfully.",
    tone: "success" as const,
  },
  {
    id: "collection.failed",
    label: "collection.failed",
    desc: "Fired when a collection fails (refunded or refund error).",
    tone: "destructive" as const,
  },
  {
    id: "collection.pending",
    label: "collection.pending",
    desc: "Fired when a collection is acknowledged but awaiting the provider's final result.",
    tone: "warning" as const,
  },
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
      className="flex items-center gap-1.5 rounded border border-border bg-secondary px-2 py-1 text-xs text-foreground hover:bg-secondary/80 transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export default function WebhooksPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  const integrator = useIntegratorPortalStore((s) => s.integrator);

  const [url, setUrl] = React.useState("");
  const [events, setEvents] = React.useState<Set<string>>(
    new Set(["collection.success", "collection.failed", "collection.pending"])
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [createdSecret, setCreatedSecret] = React.useState<IntegratorWebhookCreated | null>(null);

  const [webhooks, setWebhooks] = React.useState<IntegratorWebhook[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [deleting, setDeleting] = React.useState<number | null>(null);

  async function loadWebhooks() {
    if (!token) return;
    setLoading(true);
    try {
      const list = await integratorPortalService.listWebhooks(token);
      setWebhooks(list);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadWebhooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function toggleEvent(eventId: string) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!url.trim()) { setError("Callback URL is required."); return; }
    if (events.size === 0) { setError("Select at least one event."); return; }
    if (!token) return;
    setSubmitting(true);
    try {
      const created = await integratorPortalService.createWebhook(token, url.trim(), [...events]);
      setCreatedSecret(created);
      setUrl("");
      await loadWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register webhook.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    if (!token) return;
    setDeleting(id);
    try {
      await integratorPortalService.deleteWebhook(token, id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Webhook Callbacks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Register a callback URL to receive real-time POST notifications when a collection
          succeeds or fails. Each request is signed with{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">X-Soila-Signature</code>{" "}
          so you can verify authenticity.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Register form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Register Webhook</CardTitle>
            <CardDescription>Add a new callback endpoint</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              {/* Client ID / Name (read-only) */}
              <div className="flex flex-col gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Client ID
                  </label>
                  <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2">
                    <span className="flex-1 font-mono text-sm text-foreground">{integrator?.id ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">auto</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Taken from your account — cannot be changed</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Client Name
                  </label>
                  <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2">
                    <span className="flex-1 text-sm text-foreground">{integrator?.name ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">auto</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Taken from your account — cannot be changed</p>
                </div>
              </div>

              {/* Callback URL */}
              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Callback URL <span className="text-destructive">*</span>
                </label>
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30">
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://your-server.com/webhook"
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
                  />
                </div>
              </div>

              {/* Events */}
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Events to Subscribe
                </label>
                <div className="flex flex-col gap-2">
                  {EVENT_OPTIONS.map((ev) => {
                    const checked = events.has(ev.id);
                    return (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() => toggleEvent(ev.id)}
                        className={`flex items-center justify-between rounded-md border px-3 py-2.5 text-left transition-colors ${
                          checked
                            ? "border-primary/40 bg-primary/5"
                            : "border-border bg-background hover:bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className={`h-2 w-2 rounded-full ${
                            ev.tone === "success" ? "bg-success" : "bg-destructive"
                          }`} />
                          <span className="font-mono text-xs font-medium text-foreground">{ev.label}</span>
                        </div>
                        {checked && <Check className="h-4 w-4 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}

              <Button type="submit" disabled={submitting} loading={submitting} className="w-full">
                Register Webhook
              </Button>
            </form>

            {/* Secret shown once after creation */}
            {createdSecret && (
              <div className="mt-5 rounded-md border border-warning/40 bg-warning/5 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-warning">
                      Store this secret — it will never be shown again
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use it to verify incoming webhook deliveries with HMAC-SHA256.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 truncate rounded bg-code-bg px-2 py-1.5 font-mono text-xs text-code-foreground">
                        {createdSecret.secret}
                      </code>
                      <CopyButton text={createdSecret.secret} />
                    </div>
                    <button
                      onClick={() => setCreatedSecret(null)}
                      className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      I have saved it — dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active subscriptions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Active Subscriptions</CardTitle>
              <CardDescription>
                {webhooks.length} registered
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadWebhooks} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Loading...
              </div>
            ) : webhooks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Link2 className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No webhooks registered yet.</p>
                <p className="text-xs text-muted-foreground/70">
                  Add a callback URL from the form to get started.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {webhooks.map((wh) => (
                  <div
                    key={wh.id}
                    className="flex items-start gap-3 rounded-md border border-border p-3"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Link2 className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-success">● Active</span>
                      </div>
                      <p className="truncate font-mono text-xs text-foreground">{wh.callbackUrl}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        Secret: {wh.secretHint}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {wh.events.map((ev) => (
                          <StatusBadge
                            key={ev}
                            variant={
                              ev === "collection.success"
                                ? "success"
                                : ev === "collection.pending"
                                ? "warning"
                                : "destructive"
                            }
                          >
                            {ev}
                          </StatusBadge>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDelete(wh.id)}
                      disabled={deleting === wh.id}
                      className="mt-0.5 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 transition-colors"
                      title="Delete webhook"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Verification guide */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verifying Deliveries</CardTitle>
          <CardDescription>
            Each POST includes an <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">X-Soila-Signature</code> header.
            Verify it on your server before trusting the payload.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border border-border bg-code-bg p-4 font-mono text-xs text-code-foreground">
{`// Node.js example
const crypto = require("crypto");

app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.header("X-Soila-Signature"); // "sha256=<hex>"
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET)
    .update(req.body)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = JSON.parse(req.body);
  console.log(event.event, event.status); // e.g. "collection.success", "SUCCESS"
  res.status(200).json({ received: true });
});`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
