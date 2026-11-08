"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CreditCard, RefreshCw, Send } from "lucide-react";
import { ComparisonBarChart } from "@/components/ui/charts";
import { cn, formatDateTime } from "@/lib/utils";
import { paymentErrorMessage, paymentService, type Overview, type PaymentScope, type PaymentSummary } from "@/services/payment.service";
import { ChannelLogo, channelLabel } from "./payment-logos";
import { BkPanel, StatusStamp, rwf } from "./brutal";

const RANGES = [7, 14, 30];

/** The Overview dashboard, shared by the admin console and the integrator
 * portal. Every number comes from the LMBTech ledger - nothing is mocked or
 * estimated, and empty data shows "—" rather than a made-up rate. */
export function OverviewDashboard({ scope, links }: { scope: PaymentScope; links: { collections: string; disbursements: string; transactions: string } }) {
  const admin = scope.kind === "admin";
  const token = scope.kind === "portal" ? scope.token : null;
  const [days, setDays] = React.useState(14);
  const [data, setData] = React.useState<Overview | null>(null);
  const [summary, setSummary] = React.useState<PaymentSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    const s: PaymentScope = token ? { kind: "portal", token } : { kind: "admin" };
    setLoading(true);
    setError(null);
    try {
      const [o, sum] = await Promise.all([paymentService.overview(s, days), paymentService.summary(s)]);
      setData(o);
      setSummary(sum);
    } catch (e) {
      setError(paymentErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [token, days]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const chart = (data?.series ?? []).map((d) => ({
    day: new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    Collected: d.collected,
    "Paid out": d.disbursed,
  }));
  const channelTotal = (data?.channels ?? []).reduce((s, c) => s + c.amountRwf, 0);
  const channels = [...(data?.channels ?? [])].sort((a, b) => b.amountRwf - a.amountRwf);
  const t = data?.today;

  const tiles = [
    { label: "Collected today", value: t ? rwf(t.collectedRwf) : "—", sub: summary ? `All time: ${rwf(summary.collectedRwf)}` : "", fill: "bk-fill-green", icon: ArrowDownLeft },
    { label: "Paid out today", value: t ? rwf(t.disbursedRwf) : "—", sub: summary ? `All time: ${rwf(summary.disbursedRwf)}` : "", fill: "bk-fill-blue", icon: ArrowUpRight },
    admin
      ? {
          label: "Your margin today",
          value: t ? rwf(t.marginRwf ?? 0) : "—",
          sub: summary ? `All time: ${rwf(summary.marginRwf ?? 0)}` : "",
          fill: (t?.marginRwf ?? 0) < 0 ? "bk-fill-red" : "bk-fill-pink",
          icon: CreditCard,
        }
      : {
          label: "Available balance",
          value: summary ? rwf(summary.availableBalanceRwf ?? 0) : "—",
          sub: "Collected − fees − payouts",
          fill: "bk-fill-pink",
          icon: CreditCard,
        },
    {
      label: "Success rate today",
      value: t?.successRate == null ? "—" : `${t.successRate}%`,
      sub: t ? `${t.successCount} paid · ${t.failedCount} failed · ${t.pendingCount} waiting` : "",
      fill: "bk-fill-yellow",
      icon: Send,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="bk-card bk-fill-red flex items-center justify-between gap-3 p-4 text-sm font-semibold">
          <span>Could not load the dashboard: {error}</span>
          <button type="button" onClick={load} className="bk-btn bk-fill-paper min-h-9 px-3 text-xs">
            Retry
          </button>
        </div>
      )}
      {summary && !summary.gatewayConfigured && (
        <div className="bk-card bk-fill-red p-4 text-sm font-semibold">
          LMBTech is not connected yet - add LMBTECH_APP_KEY and LMBTECH_SECRET_KEY to the backend .env and restart it.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(({ label, value, sub, fill, icon: Icon }) => (
          <div key={label} className={cn("bk-card p-4", fill)}>
            <div className="flex items-start justify-between gap-2">
              <p className="bk-display text-xs font-bold uppercase">{label}</p>
              <Icon className="h-4 w-4 shrink-0" />
            </div>
            <p className="bk-display mt-1 truncate text-2xl font-bold">{loading && !data ? "…" : value}</p>
            <p className="truncate text-[11px] font-medium opacity-80">{sub}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href={links.collections} className="bk-btn bk-fill-green">
          <ArrowDownLeft className="h-4 w-4" /> Take a payment
        </Link>
        <Link href={links.disbursements} className="bk-btn bk-fill-blue">
          <ArrowUpRight className="h-4 w-4" /> Send a payout
        </Link>
        <Link href={links.transactions} className="bk-btn bk-fill-paper">
          See all transactions
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <BkPanel
          title={`Money in & out · last ${days} days`}
          action={
            <div className="flex gap-1.5">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setDays(r)}
                  aria-pressed={days === r}
                  className={cn("bk-btn min-h-8 px-2.5 py-0.5 text-[11px]", days === r ? "bk-fill-ink" : "bk-fill-paper")}
                >
                  {r}d
                </button>
              ))}
              <button type="button" onClick={load} aria-label="Refresh" className="bk-btn bk-fill-paper min-h-8 px-2 py-0.5">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </button>
            </div>
          }
        >
          {chart.every((d) => d.Collected === 0 && d["Paid out"] === 0) ? (
            <EmptyState text={`No paid transactions in the last ${days} days.`} />
          ) : (
            <ComparisonBarChart
              data={chart}
              xKey="day"
              series={[
                { key: "Collected", label: "Collected (RWF)", color: "#22a35a" },
                { key: "Paid out", label: "Paid out (RWF)", color: "#2f4bff" },
              ]}
            />
          )}
        </BkPanel>

        <BkPanel title="How customers pay">
          {channels.length === 0 ? (
            <EmptyState text="No collections yet." />
          ) : (
            <ul className="flex flex-col gap-3">
              {channels.map((c) => {
                const pct = channelTotal ? Math.round((100 * c.amountRwf) / channelTotal) : 0;
                return (
                  <li key={c.channel}>
                    <div className="flex items-center gap-2">
                      <ChannelLogo channel={c.channel} className="h-7 w-11 text-[9px]" />
                      <span className="flex-1 text-sm font-semibold">{channelLabel(c.channel)}</span>
                      <span className="text-sm font-bold">{pct}%</span>
                    </div>
                    <div className="bk-box mt-1.5 h-3 overflow-hidden">
                      <div className="h-full bg-[var(--bk-ink)]" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="bk-muted mt-0.5 text-[11px]">
                      {rwf(c.amountRwf)} · {c.count} payment{c.count === 1 ? "" : "s"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </BkPanel>
      </div>

      <BkPanel
        title="Latest activity"
        action={
          <Link href={links.transactions} className="bk-btn bk-fill-paper min-h-8 px-3 py-0.5 text-[11px]">
            View all →
          </Link>
        }
      >
        {!data || data.recent.length === 0 ? (
          <EmptyState text="Nothing yet - take a payment or send a payout to see it here." />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.recent.map((p) => (
              <li key={p.referenceId} className="bk-box flex items-center gap-3 p-2.5">
                <span
                  className={cn(
                    "bk-tag shrink-0",
                    p.direction === "DISBURSEMENT" ? "bk-fill-blue" : "bk-fill-green"
                  )}
                >
                  {p.direction === "DISBURSEMENT" ? "↑ Out" : "↓ In"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{p.customerName}</p>
                  <p className="bk-muted truncate text-[11px]">
                    {channelLabel(p.channel)} · {formatDateTime(p.createdAt)}
                    {admin && ` · ${p.integratorName ?? "Console"}`}
                  </p>
                </div>
                <span className="bk-display shrink-0 font-bold">{rwf(p.amountRwf)}</span>
                <StatusStamp status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </BkPanel>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bk-box flex min-h-32 items-center justify-center border-dashed p-6 text-center text-sm font-semibold">
      {text}
    </div>
  );
}
