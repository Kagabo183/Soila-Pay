"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { paymentService, type PaymentScope, type PaymentSummary } from "@/services/payment.service";
import { CheckoutPanel } from "./checkout-panel";
import { PaymentsList, PaymentSummaryTiles } from "./payments-list";
import { TestLab } from "./test-lab";

type Tab = "pay" | "lab" | "history";

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: "pay", label: "Take a payment", emoji: "💳" },
  { id: "lab", label: "Test Lab", emoji: "🧪" },
  { id: "history", label: "History", emoji: "📜" },
];

/** Shared by the admin console (/payments) and the integrator portal
 * (/portal/payments). Brutalist styling lives in globals.css (bk-*). */
export function PaymentsPage({
  scope,
  title,
  subtitle,
  integratorKey,
  showIntegrator = false,
}: {
  scope: PaymentScope;
  title: string;
  subtitle: string;
  integratorKey?: string;
  showIntegrator?: boolean;
}) {
  const [summary, setSummary] = React.useState<PaymentSummary | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [tab, setTab] = React.useState<Tab>("pay");
  const bump = React.useCallback(() => setRefreshKey((k) => k + 1), []);
  const testMode = summary?.testMode ?? true;
  const token = scope.kind === "portal" ? scope.token : null;

  // Totals at the top refresh after every new payment, whichever tab is open.
  React.useEffect(() => {
    let cancelled = false;
    const s: PaymentScope = token ? { kind: "portal", token } : { kind: "admin" };
    paymentService
      .summary(s)
      .then((value) => {
        if (!cancelled) setSummary(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, refreshKey]);

  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">{title}</h1>
            <p className="bk-muted mt-1 max-w-xl text-sm">{subtitle}</p>
          </div>
          <span className={cn("bk-tag px-3 py-1 text-xs", testMode ? "bk-fill-yellow" : "bk-fill-green")}>
            {testMode ? "🧪 Test mode — no real money" : "🟢 Live — real money"}
          </span>
        </header>

        {summary && !summary.gatewayConfigured && (
          <div className="bk-card bk-fill-red p-4 text-sm font-semibold">
            Payments are not set up yet. Add LMBTECH_APP_KEY and LMBTECH_SECRET_KEY to the backend .env, then restart it.
          </div>
        )}

        <PaymentSummaryTiles summary={summary} />

        <nav className="flex flex-wrap gap-3" role="tablist" aria-label="Payments sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("bk-btn px-4 text-sm", tab === t.id ? "bk-fill-ink" : "bk-fill-paper")}
            >
              <span aria-hidden="true">{t.emoji}</span> {t.label}
            </button>
          ))}
        </nav>

        {tab === "pay" && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <CheckoutPanel scope={scope} testMode={testMode} onChange={bump} />
            <PaymentsList scope={scope} refreshKey={refreshKey} showIntegrator={showIntegrator} compact onSummary={setSummary} />
          </div>
        )}

        {tab === "lab" && <TestLab scope={scope} integratorKey={integratorKey} testMode={testMode} onRan={bump} />}

        {tab === "history" && <PaymentsList scope={scope} refreshKey={refreshKey} showIntegrator={showIntegrator} onSummary={setSummary} />}
      </div>
    </div>
  );
}
