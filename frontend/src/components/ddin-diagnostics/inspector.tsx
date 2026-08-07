"use client";

import * as React from "react";
import { ChevronDown, Copy, ShieldAlert } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/store/toast-store";
import { cn } from "@/lib/utils";
import type { DdinDiagnosticStep } from "@/services/ddin-diagnostics.service";

const STEP_LABELS: Record<DdinDiagnosticStep["step"], string> = {
  config: "Configuration",
  login: "Login",
  refresh_token: "Refresh Token",
  balance: "Get Accounts (Balance)",
  test_collection: "Test Collection (optional)",
};

const CATEGORY_LABELS: Record<string, string> = {
  NETWORK: "Network / DNS",
  TLS: "TLS / SSL",
  TIMEOUT: "Timeout",
  UNAUTHORIZED: "Unauthorized / Invalid Credentials",
  DDIN_UNAVAILABLE: "DDIN Service Unavailable",
  INVALID_RESPONSE: "Invalid Response",
  CONFIG: "Configuration Error",
  UNEXPECTED: "Unexpected Error",
};

function CopyIconButton({ text }: { text: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text);
        toast({ title: "Copied to clipboard", variant: "default" });
      }}
      className="text-muted-foreground hover:text-foreground"
      aria-label="Copy"
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  const text = JSON.stringify(value, null, 2);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <CopyIconButton text={text} />
      </div>
      <pre className="overflow-x-auto rounded-md bg-secondary/50 p-2.5 font-mono text-[11px] text-foreground scrollbar-thin">
        {text}
      </pre>
    </div>
  );
}

export function StepInspector({ step }: { step: DdinDiagnosticStep }) {
  const [open, setOpen] = React.useState(step.status === "FAIL");
  const rr = step.requestResponse;

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5">
          <StatusBadge
            variant={
              step.status === "PASS"
                ? "success"
                : step.status === "FAIL"
                  ? "destructive"
                  : step.status === "SKIPPED"
                    ? "outline"
                    : "warning"
            }
          >
            {step.status}
          </StatusBadge>
          <p className="text-sm font-medium text-foreground">{STEP_LABELS[step.step]}</p>
          {step.latencyMs !== null && (
            <span className="text-xs text-muted-foreground">{Math.round(step.latencyMs)}ms</span>
          )}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">{step.message}</p>

          {step.category && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <div className="text-xs">
                <p className="font-medium text-destructive">{CATEGORY_LABELS[step.category] ?? step.category}</p>
                {step.troubleshooting.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {step.troubleshooting.map((tip, i) => (
                      <li key={i}>{tip}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {rr && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-secondary px-1.5 py-0.5 font-mono font-semibold text-foreground">
                  {rr.method}
                </span>
                <code className="break-all font-mono text-muted-foreground">{rr.url}</code>
                <CopyIconButton text={rr.url} />
                {rr.statusCode !== null && (
                  <StatusBadge variant={rr.statusCode < 300 ? "success" : rr.statusCode < 500 ? "warning" : "destructive"}>
                    {rr.statusCode}
                  </StatusBadge>
                )}
              </div>
              <JsonBlock label="Request Headers (sensitive values masked)" value={rr.headers} />
              <JsonBlock label="Request Body (sensitive values masked)" value={rr.body} />
              <JsonBlock label="Response Body" value={rr.responseBody} />
            </>
          )}

          <div className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
            <span>Correlation ID: <code className="font-mono">{step.correlationId}</code></span>
            <CopyIconButton text={step.correlationId} />
          </div>
        </div>
      )}
    </div>
  );
}
