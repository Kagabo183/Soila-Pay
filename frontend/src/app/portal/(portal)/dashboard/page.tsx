"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { OverviewDashboard } from "@/components/payments/overview-dashboard";
import { BkPanel } from "@/components/payments/brutal";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

const STATUS_LABEL = {
  NOT_SUBMITTED: "Not submitted",
  PENDING_REVIEW: "Under review",
  APPROVED: "Live",
  REJECTED: "Rejected",
} as const;

function KeyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="min-w-0">
      <p className="bk-display text-xs font-bold uppercase">{label}</p>
      <div className="bk-box mt-1 flex items-center gap-2 px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{value}</code>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() =>
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            })
          }
          className="bk-btn bk-fill-paper min-h-8 px-2"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export default function PortalOverviewPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  if (!token || !integrator) return null;

  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-6">
        <header>
          <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">Hello, {integrator.name}</h1>
          <p className="bk-muted mt-1 text-sm">Your money in, money out and balance - live.</p>
        </header>

        <OverviewDashboard
          scope={{ kind: "portal", token }}
          links={{ collections: "/portal/payments", disbursements: "/portal/disbursements", transactions: "/portal/transactions" }}
        />

        <BkPanel
          title="Your API keys"
          tone="bk-fill-yellow"
          action={
            <span className="bk-tag bk-fill-paper">
              Production: {STATUS_LABEL[integrator.productionStatus]}
            </span>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <KeyRow label="Sandbox key (testing)" value={integrator.sandboxApiKey} />
            {integrator.productionApiKey ? (
              <KeyRow label="Production key (real money)" value={integrator.productionApiKey} />
            ) : (
              <div className="bk-box flex items-center justify-between gap-3 p-3 text-sm">
                <span>No production key yet.</span>
                <Link href="/portal/go-live" className="bk-btn bk-fill-green min-h-9 px-3 text-xs">
                  Go live →
                </Link>
              </div>
            )}
          </div>
          <p className="bk-muted mt-3 text-xs">
            Send the key as the <code className="font-mono">Integrator-Key</code> header. Examples are in{" "}
            <Link href="/portal/dev-tools" className="font-semibold underline">
              API Docs
            </Link>
            .
          </p>
        </BkPanel>
      </div>
    </div>
  );
}
