"use client";

import * as React from "react";
import { Save, RotateCcw, Activity, CheckCircle2, XCircle, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSettingsStore, DEFAULT_SETTINGS } from "@/store/settings-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { providerService } from "@/services/provider.service";
import { toast } from "@/store/toast-store";
import { cn } from "@/lib/utils";
import type { ApiIntegrationSettings } from "@/types/api";

function extractSettings(state: ApiIntegrationSettings): ApiIntegrationSettings {
  const { baseUrl, bearerToken, timeoutMs, retryCount, webhookSecret, environment } = state;
  return { baseUrl, bearerToken, timeoutMs, retryCount, webhookSecret, environment };
}

export default function ApiSettingsPage() {
  const settings = useSettingsStore();
  const confirm = useConfirm();
  // Lazy initializer only - this page renders inside AuthGuard, which already
  // defers rendering until after the client has mounted and zustand's
  // persisted store has hydrated, so a sync-on-mount effect isn't needed.
  const [form, setForm] = React.useState<ApiIntegrationSettings>(() => extractSettings(settings));
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; latencyMs: number } | null>(null);

  function handleChange<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    settings.update(form);
    toast({ title: "API settings saved", description: "Stored locally in this browser.", variant: "success" });
  }

  async function handleReset() {
    const ok = await confirm({
      title: "Reset to defaults?",
      description: "This clears your saved base URL, token, and webhook secret.",
      confirmLabel: "Reset",
      destructive: true,
    });
    if (!ok) return;
    settings.reset();
    setForm(DEFAULT_SETTINGS);
    toast({ title: "Settings reset to defaults", variant: "default" });
  }

  async function handleTestConnection() {
    setTesting(true);
    setResult(null);
    const res = await providerService.healthCheck(form.baseUrl);
    setResult(res);
    setTesting(false);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "API Integration" }]} />
        <h1 className="mt-1 text-xl font-semibold text-foreground">API Integration Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure how this console talks to the Soila Pay middleware. Used by every service in{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">src/services/</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>Base URL, credentials, and request behavior</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Input
            label="Base URL"
            value={form.baseUrl}
            onChange={(e) => handleChange("baseUrl", e.target.value)}
            placeholder="https://agenttestapi.ddin.rw"
            hint="Points at the FastAPI middleware (app/main.py). Local default: http://localhost:8000"
          />
          <Input
            label="Bearer Token"
            type="password"
            value={form.bearerToken}
            onChange={(e) => handleChange("bearerToken", e.target.value)}
            placeholder="Paste a JWT access token"
            hint="Overrides the token issued by the login flow, if set."
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Timeout (ms)"
              type="number"
              value={form.timeoutMs}
              onChange={(e) => handleChange("timeoutMs", Number(e.target.value))}
              min={1000}
              step={500}
            />
            <Input
              label="Retry Count"
              type="number"
              value={form.retryCount}
              onChange={(e) => handleChange("retryCount", Number(e.target.value))}
              min={0}
              max={5}
            />
          </div>
          <Input
            label="Webhook Secret"
            type="password"
            value={form.webhookSecret}
            onChange={(e) => handleChange("webhookSecret", e.target.value)}
            placeholder="whsec_..."
            hint="Used to sign outgoing webhook test payloads and pre-fill the Developer Portal's Signature Verifier."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
          <CardDescription>Switch between sandbox and production credentials</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {(["sandbox", "production"] as const).map((env) => (
              <button
                key={env}
                onClick={() => handleChange("environment", env)}
                className={cn(
                  "flex-1 rounded-lg border px-4 py-3 text-left transition-colors",
                  form.environment === env
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-secondary"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize text-foreground">{env}</span>
                  {form.environment === env && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {env === "sandbox"
                    ? "Safe for testing - mock providers, no real money movement."
                    : "Live traffic. Real MTN/Airtel/bank rails and real Fineract postings."}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connection Test</CardTitle>
          <CardDescription>Verify the middleware is reachable at the configured base URL</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleTestConnection} loading={testing}>
              <Activity className="h-4 w-4" />
              Run Health Check
            </Button>
            {result && (
              <StatusBadge variant={result.ok ? "success" : "destructive"}>
                {result.ok ? (
                  <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Healthy</span>
                ) : (
                  <span className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Unreachable</span>
                )}
                {" "}&middot; {result.latencyMs}ms
              </StatusBadge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Calls <code className="rounded bg-secondary px-1 py-0.5 font-mono">GET {form.baseUrl || "<base-url>"}/healthz</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" /> Storage
          </CardTitle>
          <CardDescription>Where these settings live</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Settings are persisted client-side only, in this browser&apos;s local storage
            (<code className="rounded bg-secondary px-1 py-0.5 font-mono">soila-pay-api-settings</code>).
            Nothing here is sent anywhere until you click Save, and no value is shared across devices -
            each operator configures their own console.
          </p>
        </CardContent>
        <CardFooter className="justify-between">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4" />
            Save Settings
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
