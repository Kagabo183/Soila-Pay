"use client";

import * as React from "react";
import { Copy, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { toast } from "@/store/toast-store";

function maskKey(key: string) {
  if (key.length <= 10) return key;
  return `${key.slice(0, 7)}${"*".repeat(10)}${key.slice(-4)}`;
}

function copyKey(key: string) {
  navigator.clipboard?.writeText(key);
  toast({ title: "Copied to clipboard", variant: "default" });
}

function ApiKeyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2 font-mono text-sm">
        <span className="flex-1 break-all">{maskKey(value)}</span>
        <button onClick={() => copyKey(value)} className="text-muted-foreground hover:text-foreground">
          <Copy className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function PortalOverviewPage() {
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  if (!integrator) return null;

  const statusIcon =
    integrator.productionStatus === "APPROVED" ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : integrator.productionStatus === "PENDING_REVIEW" ? (
      <Clock className="h-4 w-4 text-warning" />
    ) : integrator.productionStatus === "REJECTED" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : null;

  const statusLabel: Record<typeof integrator.productionStatus, string> = {
    NOT_SUBMITTED: "Not submitted",
    PENDING_REVIEW: "Under review",
    APPROVED: "Live",
    REJECTED: "Rejected",
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your API keys and account status.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sandbox API Key</CardTitle>
          <CardDescription>
            Use this key to test collections. Routes to a safe simulator — no real money moves.
            Pass it as the <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">Integrator-Key</code> header.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeyRow label="Sandbox Key" value={integrator.sandboxApiKey} />
        </CardContent>
      </Card>

      {integrator.productionApiKey && (
        <Card>
          <CardHeader>
            <CardTitle>Production API Key</CardTitle>
            <CardDescription>
              Live key — real money, real DDIN collections. Keep it secret.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApiKeyRow label="Production Key" value={integrator.productionApiKey} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Name</p>
            <p className="font-medium text-foreground">{integrator.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Phone</p>
            <p className="font-medium text-foreground">{integrator.phoneNumber ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Production status</p>
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              {statusIcon}
              {statusLabel[integrator.productionStatus]}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fee</p>
            <p className="font-medium text-foreground">{integrator.feePercentage}%</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
