"use client";

import * as React from "react";
import { Play, Square, ChevronDown, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { StatusBadge } from "@/components/ui/status-badge";
import { ComparisonBarChart } from "@/components/ui/charts";
import { useSettingsStore } from "@/store/settings-store";
import { toast } from "@/store/toast-store";
import { cn } from "@/lib/utils";
import {
  ddinDiagnosticsService,
  type DdinDiagnosticStep,
  type DdinDiagnosticsResult,
  type DdinConnectionInfo,
} from "@/services/ddin-diagnostics.service";
import { HealthOverviewCards } from "@/components/ddin-diagnostics/health-cards";
import { DiagnosticsStepper, buildStepperNodes } from "@/components/ddin-diagnostics/diagnostics-stepper";
import { StepInspector } from "@/components/ddin-diagnostics/inspector";
import { ConnectionDetailsCard } from "@/components/ddin-diagnostics/connection-details";
import { LogViewer } from "@/components/ddin-diagnostics/log-viewer";
import { ApiDocsCard } from "@/components/ddin-diagnostics/api-docs";
import { formatDateTime } from "@/lib/utils";

const STEP_LABELS: Record<DdinDiagnosticStep["step"], string> = {
  config: "Config",
  login: "Login",
  refresh_token: "Refresh",
  balance: "Balance",
  test_collection: "Collection",
};

function buildResultFromSteps(steps: DdinDiagnosticStep[], baseUrl: string): DdinDiagnosticsResult {
  const overallStatus = steps.some((s) => s.status === "FAIL") ? "FAIL" : "PASS";
  const totalDurationMs = steps.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0);
  return {
    overallStatus,
    baseUrl,
    correlationId: steps[0]?.correlationId ?? "",
    steps,
    ranAt: new Date().toISOString(),
    totalDurationMs,
  };
}

export default function DdinDiagnosticsPage() {
  const middlewareUrl = useSettingsStore((s) => s.baseUrl) || "http://localhost:8000";

  const [connectionInfo, setConnectionInfo] = React.useState<DdinConnectionInfo | null>(null);
  const [middlewareOnline, setMiddlewareOnline] = React.useState<boolean | null>(null);

  const [includeRefresh, setIncludeRefresh] = React.useState(true);
  const [includeBalance, setIncludeBalance] = React.useState(true);
  const [runTestCollection, setRunTestCollection] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const [phase, setPhase] = React.useState<"idle" | "running" | "done">("idle");
  const [liveSteps, setLiveSteps] = React.useState<DdinDiagnosticStep[]>([]);
  const [runHistory, setRunHistory] = React.useState<DdinDiagnosticsResult[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    let mounted = true;
    ddinDiagnosticsService
      .getConnectionInfo()
      .then((info) => {
        if (!mounted) return;
        setConnectionInfo(info);
        setMiddlewareOnline(true);
      })
      .catch(() => {
        if (mounted) setMiddlewareOnline(false);
      });
    // Server-side history - survives a reload, unlike the old session-only log.
    ddinDiagnosticsService
      .getHistory()
      .then((history) => {
        if (mounted) setRunHistory(history.slice().reverse());
      })
      .catch(() => {
        // Not fatal - the page still works for new runs even if history can't load.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const lastSuccessfulRun = [...runHistory].reverse().find((r) => r.overallStatus === "PASS");
  const lastRun = runHistory[runHistory.length - 1];

  async function handleRun() {
    setError(null);
    setLiveSteps([]);
    setPhase("running");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const collected: DdinDiagnosticStep[] = [];
      await ddinDiagnosticsService.runStream(
        { includeRefresh, includeBalance, runTestCollection },
        (step) => {
          collected.push(step);
          setLiveSteps([...collected]);
        },
        controller.signal
      );
      setMiddlewareOnline(true);
      const result = buildResultFromSteps(collected, connectionInfo?.ddinBaseUrl ?? "");
      setRunHistory((h) => [...h, result]);
      toast({
        title: result.overallStatus === "PASS" ? "DDIN connection healthy" : "DDIN connection failed",
        variant: result.overallStatus === "PASS" ? "success" : "error",
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        toast({ title: "Diagnostics run cancelled", variant: "default" });
      } else {
        setMiddlewareOnline(false);
        const message =
          err instanceof Error
            ? `Could not reach the middleware at ${middlewareUrl} - is it running? (${err.message})`
            : "Diagnostics request failed";
        setError(message);
        toast({ title: "Diagnostics request failed", variant: "error" });
      }
    } finally {
      setPhase("done");
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  const stepperNodes = buildStepperNodes(liveSteps, phase);
  const chartData = liveSteps
    .filter((s) => s.latencyMs !== null)
    .map((s) => ({ name: STEP_LABELS[s.step], "Latency (ms)": Math.round(s.latencyMs ?? 0) }));

  const fullUrl = `${middlewareUrl}/api/v1/admin/ddin/diagnostics`;
  const requestBodyJson = JSON.stringify(
    { include_refresh: includeRefresh, include_balance: includeBalance, run_test_collection: runTestCollection },
    null,
    2
  );

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {/* Header */}
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "DDIN Diagnostics" }]} />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-foreground">DDIN Connection Diagnostics</h1>
          {connectionInfo && (
            <StatusBadge variant="outline">{connectionInfo.environment.toUpperCase()}</StatusBadge>
          )}
          <StatusBadge variant={middlewareOnline ? "success" : middlewareOnline === false ? "destructive" : "outline"}>
            {middlewareOnline === null ? "Checking..." : middlewareOnline ? "Middleware Online" : "Middleware Offline"}
          </StatusBadge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Internal engineering tool for operations and platform teams. Verifies Soila Pay can reach and
          authenticate against DDIN&apos;s sandbox, exactly the sequence in DDIN&apos;s own &quot;Getting
          Started&quot; guide. Read-only - never debits a wallet, calls Fineract, or writes to
          transaction_logs.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            Last successful run:{" "}
            <span className="font-medium text-foreground">
              {lastSuccessfulRun ? formatDateTime(lastSuccessfulRun.ranAt) : "Never this session"}
            </span>
          </span>
          <span>
            Region: <span className="font-medium text-foreground">Sandbox (single region)</span>
          </span>
          <span>
            API version: <span className="font-medium text-foreground">{connectionInfo?.apiPathVersion ?? "—"}</span>
          </span>
        </div>
      </div>

      {/* Health overview */}
      <HealthOverviewCards middlewareOnline={middlewareOnline} steps={liveSteps} />

      {/* Live diagnostics controls */}
      <Card>
        <CardHeader>
          <CardTitle>Run Diagnostics</CardTitle>
          <CardDescription>Streams progress in real time as each check completes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {phase === "running" ? (
              <Button variant="destructive" onClick={handleCancel}>
                <Square className="h-4 w-4" /> Cancel
              </Button>
            ) : (
              <Button onClick={handleRun}>
                <Play className="h-4 w-4" /> Run Diagnostics
              </Button>
            )}
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Advanced options
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")} />
            </button>
          </div>

          {advancedOpen && (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-secondary/30 p-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={includeRefresh} onChange={(e) => setIncludeRefresh(e.target.checked)} className="h-4 w-4 rounded border-border" />
                Test token refresh
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={includeBalance} onChange={(e) => setIncludeBalance(e.target.checked)} className="h-4 w-4 rounded border-border" />
                Test accounts lookup (Get Accounts / balance)
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={runTestCollection} onChange={(e) => setRunTestCollection(e.target.checked)} className="h-4 w-4 rounded border-border" />
                Run sandbox test collection - initiates a real MoMo request on DDIN&apos;s side (safe in
                sandbox, but not automatic)
              </label>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}

          {liveSteps.length > 0 && (
            <div className="border-t border-border pt-4">
              <DiagnosticsStepper nodes={stepperNodes} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Request/response inspector */}
      {liveSteps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Request & Response Inspector</CardTitle>
            <CardDescription>Every call this run made - expand a step for full detail.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {liveSteps.map((step) => (
              <StepInspector key={step.step} step={step} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Metrics */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Latency by Step
            </CardTitle>
            <CardDescription>
              Total execution time: {lastRun ? Math.round(lastRun.totalDurationMs) : 0}ms
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ComparisonBarChart
              data={chartData}
              xKey="name"
              series={[{ key: "Latency (ms)", label: "Latency (ms)" }]}
              height={220}
            />
          </CardContent>
        </Card>
      )}

      {/* Connection details */}
      <ConnectionDetailsCard info={connectionInfo} middlewareUrl={middlewareUrl} />

      {/* Log viewer */}
      <LogViewer runs={runHistory} />

      {/* API documentation */}
      <ApiDocsCard fullUrl={fullUrl} requestBodyJson={requestBodyJson} />
    </div>
  );
}
