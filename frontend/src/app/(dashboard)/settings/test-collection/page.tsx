"use client";

import * as React from "react";
import { Send, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { StatusBadge } from "@/components/ui/status-badge";
import { CollectMoneyPanel } from "@/components/portal/collect-money-panel";
import { integratorsService } from "@/services/integrators.service";
import { toast } from "@/store/toast-store";
import { cn } from "@/lib/utils";
import type { Integrator } from "@/types/api";

function maskApiKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 7)}${"*".repeat(10)}${key.slice(-4)}`;
}

function copyKey(key: string) {
  navigator.clipboard?.writeText(key);
  toast({ title: "API key copied", variant: "default" });
}

export default function TestCollectionPage() {
  const [integrators, setIntegrators] = React.useState<Integrator[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [keyMode, setKeyMode] = React.useState<"sandbox" | "production">("sandbox");

  React.useEffect(() => {
    let mounted = true;
    integratorsService.list().then((list) => {
      if (!mounted) return;
      setIntegrators(list);
      setSelectedId((current) => current ?? list.find((i) => i.isActive)?.id ?? list[0]?.id ?? null);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const selected = integrators.find((i) => i.id === selectedId) ?? null;

  // A production key can only ever be used for a real production run - if the
  // integrator selection changes to one without an approved production key,
  // silently keeping "production" active would mean the next test sends an
  // empty Integrator-Key. Derived directly during render (rather than synced
  // via an effect) so there's no render where the mismatch is visible.
  const effectiveKeyMode: "sandbox" | "production" =
    keyMode === "production" && !selected?.productionApiKey ? "sandbox" : keyMode;

  const activeKey =
    effectiveKeyMode === "production" ? selected?.productionApiKey ?? "" : selected?.sandboxApiKey ?? "";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "Test Collection" }]} />
        <h1 className="mt-1 text-xl font-semibold text-foreground">Test Collection</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Run the same real debit → collect → refund flow integrators use, on their behalf, without
          needing their credentials. Pick an integrator below - everything else is the exact
          <code className="mx-1 rounded bg-secondary px-1 py-0.5 font-mono text-xs">POST /api/v1/collection/collect</code>
          call their own Integrator Portal makes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Integrator</CardTitle>
          <CardDescription>
            Requests are sent with this integrator&apos;s real API key, exactly as if they&apos;d made
            the call themselves - their margin and DDIN cost snapshot the same way.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-64 flex-col gap-1.5">
              <label htmlFor="integrator-select" className="text-sm font-medium text-foreground">
                Integrator
              </label>
              <select
                id="integrator-select"
                value={selectedId ?? ""}
                onChange={(e) => setSelectedId(Number(e.target.value))}
                disabled={loading || integrators.length === 0}
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {integrators.length === 0 && <option value="">No integrators yet</option>}
                {integrators.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} {i.isActive ? "" : "(disabled)"}
                  </option>
                ))}
              </select>
            </div>

            {selected && (
              <div className="flex gap-2 rounded-lg border border-border bg-secondary/40 p-1">
                <button
                  onClick={() => setKeyMode("sandbox")}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    effectiveKeyMode === "sandbox" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Sandbox
                </button>
                <button
                  onClick={() => setKeyMode("production")}
                  disabled={!selected.productionApiKey}
                  title={selected.productionApiKey ? undefined : "This integrator has no approved production key"}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    effectiveKeyMode === "production" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Production
                </button>
              </div>
            )}

            {selected && !selected.isActive && (
              <StatusBadge variant="outline">Integrator disabled - requests will 403</StatusBadge>
            )}
          </div>

          {selected && activeKey && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 font-mono text-xs">
              <span className="text-muted-foreground">Integrator-Key:</span>
              <span className="flex-1 break-all">{maskApiKey(activeKey)}</span>
              <button onClick={() => copyKey(activeKey)} className="text-muted-foreground hover:text-foreground" title="Copy full key">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {effectiveKeyMode === "production" && (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              Production mode moves real money through DDIN&apos;s live collection API. Only use this
              with an amount and phone number you intend to actually charge.
            </div>
          )}
        </CardContent>
      </Card>

      {selected && activeKey ? (
        <CollectMoneyPanel
          key={`${selected.id}-${effectiveKeyMode}`}
          integratorApiKey={activeKey}
          isSandbox={effectiveKeyMode === "sandbox"}
        />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Send className="h-6 w-6" />
            {loading ? "Loading integrators..." : "Select an integrator above to run a test collection."}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
