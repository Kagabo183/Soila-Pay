"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Download,
  Loader2,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import { gatewayLabel, paymentErrorMessage } from "@/services/payment.service";
import {
  reconciliationService,
  type ReconBalance,
  type ReconMoney,
  type ReconReport,
} from "@/services/reconciliation.service";
import { channelLabel } from "./payment-logos";
import { BkPanel, rwf } from "./brutal";

// ---------------------------------------------------------------- helpers

const SOURCE: Record<string, { label: string; what: string }> = {
  API: { label: "API", what: "An integrator's system, with its API key" },
  PORTAL: {
    label: "Integrator portal",
    what: "An integrator, logged in to their dashboard",
  },
  CONSOLE: {
    label: "Admin console",
    what: "You (or another admin), from this console",
  },
  TEST_LAB: { label: "Test Lab", what: "Test payments from the Test Lab" },
  IMPORT: {
    label: "Imported",
    what: "Added by hand from a gateway's dashboard",
  },
  UNKNOWN: {
    label: "Integrator (before tracking)",
    what: "Made by an integrator before Soila Pay recorded the source",
  },
};

const REASON: Record<string, { label: string; fill: string; what: string }> = {
  STUCK: {
    label: "Stuck",
    fill: "bk-fill-red",
    what: "Still waiting after 30 minutes - check it at the gateway",
  },
  CORRECTED: {
    label: "Corrected",
    fill: "bk-fill-yellow",
    what: "A gateway check changed its status",
  },
  IMPORTED: {
    label: "Imported",
    fill: "bk-fill-blue",
    what: "Added by hand from a gateway's dashboard",
  },
  BELOW_COST: {
    label: "Lost money",
    fill: "bk-fill-orange",
    what: "The gateway cost more than the fee charged",
  },
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
};

const PRESETS: { id: string; label: string; range: () => [string, string] }[] =
  [
    {
      id: "today",
      label: "Today",
      range: () => [ymd(new Date()), ymd(new Date())],
    },
    { id: "7", label: "7 days", range: () => [daysAgo(6), ymd(new Date())] },
    { id: "30", label: "30 days", range: () => [daysAgo(29), ymd(new Date())] },
    {
      id: "month",
      label: "This month",
      range: () => {
        const d = new Date();
        return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(d)];
      },
    },
    { id: "all", label: "All time", range: () => ["", ""] },
  ];

interface Col<T> {
  header: string;
  value: (r: T) => string | number | null;
  render?: (r: T) => React.ReactNode;
  money?: boolean;
}

function csvCell(v: string | number | null) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(
  name: string,
  cols: Col<never>[] | Col<unknown>[],
  rows: unknown[],
) {
  const lines = [
    cols.map((c) => csvCell(c.header)).join(","),
    ...rows.map((r) =>
      cols.map((c) => csvCell((c as Col<unknown>).value(r))).join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** The money columns every breakdown shares. */
function moneyCols<T extends ReconMoney>(): Col<T>[] {
  return [
    {
      header: "Money in",
      value: (r) => r.in_amount,
      money: true,
      render: (r) => <Amt v={r.in_amount} n={r.in_count} />,
    },
    {
      header: "Paid out",
      value: (r) => r.out_amount,
      money: true,
      render: (r) => <Amt v={r.out_amount} n={r.out_count} />,
    },
    {
      header: "Cashed out",
      value: (r) => r.cashout_amount,
      money: true,
      render: (r) => <Amt v={r.cashout_amount} n={r.cashout_count} />,
    },
    { header: "Fees earned", value: (r) => r.fees, money: true },
    {
      header: "Gateway cost",
      value: (r) => r.gateway_cost,
      money: true,
      render: (r) => (r.gateway_cost ? `−${rwf(r.gateway_cost)}` : "—"),
    },
    {
      header: "Margin",
      value: (r) => r.margin,
      money: true,
      render: (r) => (
        <span
          className={r.margin < 0 ? "font-bold text-destructive" : "font-bold"}
        >
          {rwf(r.margin)}
        </span>
      ),
    },
    {
      header: "Pending",
      value: (r) => r.pending_amount,
      money: true,
      render: (r) => <Amt v={r.pending_amount} n={r.pending_count} />,
    },
    {
      header: "Failed",
      value: (r) => r.failed_count,
      render: (r) =>
        r.failed_count ? `${r.failed_count} (${rwf(r.failed_amount)})` : "—",
    },
  ];
}

function Amt({ v, n }: { v: number; n: number }) {
  if (!v && !n) return <span className="bk-muted">—</span>;
  return (
    <span>
      {rwf(v)}
      <span className="bk-muted block text-[10px] font-semibold">{n} txn</span>
    </span>
  );
}

function Table<T>({
  title,
  hint,
  cols,
  rows,
  file,
  tone,
  empty = "Nothing in this period.",
}: {
  title: string;
  hint?: string;
  cols: Col<T>[];
  rows: T[];
  file: string;
  tone?: string;
  empty?: string;
}) {
  return (
    <BkPanel
      title={title}
      tone={tone}
      action={
        <button
          type="button"
          onClick={() => downloadCsv(file, cols as Col<unknown>[], rows)}
          disabled={!rows.length}
          className="bk-btn bk-fill-paper min-h-8 px-2 text-xs"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
      }
    >
      {hint && <p className="bk-muted mb-3 text-xs">{hint}</p>}
      {rows.length === 0 ? (
        <p className="bk-muted text-sm">{empty}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--bk-ink)]">
                {cols.map((c) => (
                  <th
                    key={c.header}
                    className={cn(
                      "bk-display whitespace-nowrap px-2 py-2 text-xs font-bold uppercase",
                      c.money ? "text-right" : "text-left",
                    )}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className="border-b border-[var(--bk-ink)]/20 align-top"
                >
                  {cols.map((c) => (
                    <td
                      key={c.header}
                      className={cn(
                        "px-2 py-2",
                        c.money ? "whitespace-nowrap text-right" : "",
                      )}
                    >
                      {c.render
                        ? c.render(r)
                        : c.money
                          ? rwf(Number(c.value(r)) || 0)
                          : (c.value(r) ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BkPanel>
  );
}

// ---------------------------------------------------------------- pay an integrator

function PayDialog({
  b,
  onClose,
  onDone,
}: {
  b: ReconBalance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [destination, setDestination] = React.useState<"MOMO" | "BANK">("MOMO");
  const [amount, setAmount] = React.useState(
    String(Math.max(0, Math.floor(b.balance))),
  );
  const [busy, setBusy] = React.useState(false);
  const n = Number(amount) || 0;
  const ok = n >= 100 && n <= b.balance;

  async function pay() {
    setBusy(true);
    try {
      const r = await reconciliationService.payIntegrator(
        b.integrator_id,
        destination,
        n,
      );
      toast({
        title:
          r.status === "FAILED"
            ? "Payout failed"
            : `Payout started for ${b.integrator_name}`,
        description: `${r.reference_id} · ${r.status}${r.status_message ? ` - ${r.status_message}` : ""}`,
        variant: r.status === "FAILED" ? "error" : "success",
      });
      onDone();
    } catch (error) {
      toast({
        title: "Could not pay",
        description: paymentErrorMessage(error),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Pay ${b.integrator_name}`}
    >
      <div className="bk-card w-full max-w-md bg-[var(--bk-page)]">
        <header className="bk-fill-green flex items-center justify-between border-b-2 border-[var(--bk-ink)] px-4 py-3">
          <h2 className="bk-display font-bold uppercase">
            Pay {b.integrator_name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="bk-btn bk-fill-paper min-h-8 px-2"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex flex-col gap-4 p-4 text-sm">
          <p>
            Owed now: <b>{rwf(b.balance)}</b>. This pays them{" "}
            <b>on their behalf</b>, exactly like their own cash-out, so their
            balance goes down by the same amount and the books stay matched.
          </p>
          <div className="flex gap-2">
            {(["MOMO", "BANK"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDestination(d)}
                className={cn(
                  "bk-btn flex-1 text-xs",
                  destination === d ? "bk-fill-ink" : "bk-fill-paper",
                )}
              >
                {d === "MOMO"
                  ? "To their MoMo number (now)"
                  : "By bank transfer (you send it)"}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase">
            Amount (RWF)
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="bk-input bk-display text-2xl"
            />
          </label>
          {!ok && (
            <p className="text-xs font-semibold text-destructive">
              Between 100 RWF and what they are owed ({rwf(b.balance)}).
            </p>
          )}
          <p className="bk-muted text-xs">
            {destination === "MOMO"
              ? "Sent to the MoMo number on their account; the payout fee is taken from their balance."
              : "Creates a bank cash-out request that waits until you mark it paid under Transactions."}
          </p>
          <button
            type="button"
            disabled={!ok || busy}
            onClick={pay}
            className="bk-btn bk-fill-green h-12 text-base"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}{" "}
            Pay {rwf(n)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export function ReconciliationReport() {
  const [preset, setPreset] = React.useState("30");
  const [[from, to], setRange] = React.useState<[string, string]>(
    PRESETS[2].range(),
  );
  const [data, setData] = React.useState<ReconReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [paying, setPaying] = React.useState<ReconBalance | null>(null);
  const [reload, setReload] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    reconciliationService
      .report(from, to)
      .then((r) => !cancelled && setData(r))
      .catch(
        (e) =>
          !cancelled &&
          toast({
            title: "Could not load the report",
            description: paymentErrorMessage(e),
            variant: "error",
          }),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, reload]);

  const choose = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setLoading(true);
    setRange(p.range());
  };
  const period =
    from || to ? `${from || "start"}_to_${to || "today"}` : "all-time";
  const ledger = data?.is_test ? "test" : "live";
  const t = data?.totals;

  const cards = t
    ? [
        {
          label: "Money in",
          value: rwf(t.in_amount),
          sub: `${t.in_count} paid collections`,
          fill: "bk-fill-green",
        },
        {
          label: "Paid out",
          value: rwf(t.out_amount),
          sub: `${t.out_count} payouts to customers`,
          fill: "bk-fill-blue",
        },
        {
          label: "Cashed out",
          value: rwf(t.cashout_amount),
          sub: `${t.cashout_count} withdrawals`,
          fill: "bk-fill-blue",
        },
        {
          label: "Fees earned",
          value: rwf(t.fees),
          sub: "Charged to integrators",
          fill: "bk-fill-pink",
        },
        {
          label: "Gateway costs",
          value: rwf(t.gateway_cost),
          sub: "LMBTech + Kitovu",
          fill: "bk-fill-orange",
        },
        {
          label: "Your margin",
          value: rwf(t.margin),
          sub: "Fees − gateway costs",
          fill: t.margin < 0 ? "bk-fill-red" : "bk-fill-pink",
        },
        {
          label: "Owed to integrators",
          value: rwf(data!.owed_to_integrators),
          sub: "Right now, all time",
          fill: "bk-fill-yellow",
        },
        {
          label: "In flight",
          value: rwf(t.pending_amount),
          sub: `${t.pending_count} pending · ${t.failed_count} failed`,
          fill: "bk-fill-paper",
        },
      ]
    : [];

  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-7xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">
              Reconciliation
            </h1>
            <p className="bk-muted mt-1 max-w-2xl text-sm">
              Where every franc came from and went: through which aggregator, by
              which method, started by whom and how, what each integrator is
              owed - and what needs a look.{" "}
              {data
                ? data.is_test
                  ? "Showing TEST money."
                  : "Showing LIVE money."
                : ""}{" "}
              Switch with Live / Test money at the top.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setReload((k) => k + 1);
            }}
            className="bk-btn bk-fill-paper px-3 text-xs"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}{" "}
            Refresh
          </button>
        </header>

        <div className="bk-card flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p.id)}
                className={cn(
                  "bk-btn min-h-9 px-3 text-xs",
                  preset === p.id ? "bk-fill-ink" : "bk-fill-paper",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setPreset("custom");
                setLoading(true);
                setRange([e.target.value, to]);
              }}
              className="bk-input min-h-9 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setPreset("custom");
                setLoading(true);
                setRange([from, e.target.value]);
              }}
              className="bk-input min-h-9 py-1 text-sm"
            />
          </label>
        </div>

        {!data ? (
          <div className="bk-card flex items-center gap-2 p-6 text-sm font-semibold">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {cards.map((c) => (
                <div key={c.label} className={cn("bk-card p-4", c.fill)}>
                  <p className="bk-display text-xs font-bold uppercase">
                    {c.label}
                  </p>
                  <p className="bk-display mt-1 text-xl font-bold sm:text-2xl">
                    {c.value}
                  </p>
                  <p className="text-xs font-semibold opacity-80">{c.sub}</p>
                </div>
              ))}
            </div>

            {data.attention.length > 0 && (
              <Table
                title={`⚠ Needs a look (${data.attention.length})`}
                tone="bk-fill-red"
                hint="Stuck, corrected by a gateway check, added by hand, or sold below cost. Open Transactions and search the reference to act on it."
                file={`needs-a-look_${ledger}_${period}.csv`}
                rows={data.attention}
                cols={[
                  {
                    header: "Why",
                    value: (r) => REASON[r.reason]?.label ?? r.reason,
                    render: (r) => (
                      <span
                        className={cn("bk-tag", REASON[r.reason]?.fill)}
                        title={REASON[r.reason]?.what}
                      >
                        {REASON[r.reason]?.label ?? r.reason}
                      </span>
                    ),
                  },
                  {
                    header: "Reference",
                    value: (r) => r.reference_id,
                    render: (r) => (
                      <span className="font-mono text-xs">
                        {r.reference_id}
                      </span>
                    ),
                  },
                  {
                    header: "When",
                    value: (r) => r.created_at,
                    render: (r) => new Date(r.created_at).toLocaleString(),
                  },
                  { header: "Who", value: (r) => r.integrator_name },
                  {
                    header: "How",
                    value: (r) => SOURCE[r.source]?.label ?? r.source,
                  },
                  {
                    header: "Through",
                    value: (r) =>
                      `${gatewayLabel(r.gateway)} · ${channelLabel(r.channel)}`,
                  },
                  {
                    header: "Type",
                    value: (r) =>
                      r.direction === "COLLECTION"
                        ? "Money in"
                        : r.is_cashout
                          ? "Cash-out"
                          : "Payout",
                  },
                  { header: "Amount", value: (r) => r.amount_rwf, money: true },
                  {
                    header: "Status",
                    value: (r) =>
                      `${r.status}${r.status_message ? ` - ${r.status_message}` : ""}`,
                  },
                ]}
              />
            )}

            <Table
              title="Who is owed what - right now"
              tone="bk-fill-yellow"
              hint="Each integrator's balance over all time in this ledger: what they earned (collections − fees) minus what they already took out (payouts + cash-outs + fees) minus payouts still in progress. Pay them here, or they cash out themselves."
              file={`integrator-balances_${ledger}.csv`}
              rows={data.balances}
              empty="No integrator has money in this ledger yet."
              cols={[
                {
                  header: "Integrator",
                  value: (r) => r.integrator_name,
                  render: (r) => <b>{r.integrator_name}</b>,
                },
                { header: "Account", value: (r) => r.account_mode },
                {
                  header: "Earned (net)",
                  value: (r) => r.earned_net,
                  money: true,
                },
                { header: "Taken out", value: (r) => r.spent, money: true },
                {
                  header: "In progress",
                  value: (r) => r.reserved,
                  money: true,
                },
                {
                  header: "Owed now",
                  value: (r) => r.balance,
                  money: true,
                  render: (r) => (
                    <b className={r.balance < 0 ? "text-destructive" : ""}>
                      {rwf(r.balance)}
                    </b>
                  ),
                },
                {
                  header: "Last activity",
                  value: (r) => r.last_activity,
                  render: (r) =>
                    r.last_activity
                      ? new Date(r.last_activity).toLocaleDateString()
                      : "—",
                },
                {
                  header: "Action",
                  value: () => "",
                  render: (r) =>
                    r.balance >= 100 ? (
                      <button
                        type="button"
                        onClick={() => setPaying(r)}
                        className="bk-btn bk-fill-green min-h-8 px-2 text-xs"
                      >
                        <Send className="h-3.5 w-3.5" /> Pay
                      </button>
                    ) : (
                      <span className="bk-muted text-xs">—</span>
                    ),
                },
              ]}
            />

            <Table
              title="By aggregator"
              hint="Which gateway moved the money: LMBTech (cards), Kitovu (mobile money), Sandbox (test), Manual (bank transfers and hand-recorded cash-outs)."
              file={`by-aggregator_${ledger}_${period}.csv`}
              rows={data.by_gateway}
              cols={[
                {
                  header: "Aggregator",
                  value: (r) => gatewayLabel(r.gateway),
                  render: (r) => <b>{gatewayLabel(r.gateway)}</b>,
                },
                ...moneyCols<(typeof data.by_gateway)[number]>(),
                { header: "Transactions", value: (r) => r.total_count },
              ]}
            />

            <Table
              title="By aggregator and method"
              hint="Every route money took - e.g. Kitovu · MTN MoMo money in, LMBTech · Visa money in, Kitovu · MTN payouts."
              file={`by-route_${ledger}_${period}.csv`}
              rows={data.by_route}
              cols={[
                {
                  header: "Aggregator",
                  value: (r) => gatewayLabel(r.gateway),
                  render: (r) => <b>{gatewayLabel(r.gateway)}</b>,
                },
                { header: "Method", value: (r) => channelLabel(r.channel) },
                {
                  header: "Direction",
                  value: (r) =>
                    r.direction === "COLLECTION" ? "Money in" : "Money out",
                },
                ...moneyCols<(typeof data.by_route)[number]>(),
              ]}
            />

            <Table
              title="By integrator (this period)"
              hint="What each business did in the period. “Soila Pay console” = your own sales and payouts from this console."
              file={`by-integrator_${ledger}_${period}.csv`}
              rows={data.by_integrator}
              cols={[
                {
                  header: "Integrator",
                  value: (r) => r.integrator_name,
                  render: (r) =>
                    r.integrator_id ? (
                      <Link
                        className="font-bold underline"
                        href={`/settings/integrators`}
                      >
                        {r.integrator_name}
                      </Link>
                    ) : (
                      <b>{r.integrator_name}</b>
                    ),
                },
                ...moneyCols<(typeof data.by_integrator)[number]>(),
                { header: "Transactions", value: (r) => r.total_count },
              ]}
            />

            <Table
              title="How it was started"
              hint="Who started each transaction and from where. Each transaction's own record (Transactions → open a row) also shows the exact person and IP address."
              file={`by-source_${ledger}_${period}.csv`}
              rows={data.by_source}
              cols={[
                {
                  header: "Started from",
                  value: (r) => SOURCE[r.source]?.label ?? r.source,
                  render: (r) => (
                    <span>
                      <b>{SOURCE[r.source]?.label ?? r.source}</b>
                      <span className="bk-muted block text-[11px]">
                        {SOURCE[r.source]?.what}
                      </span>
                    </span>
                  ),
                },
                ...moneyCols<(typeof data.by_source)[number]>(),
                { header: "Transactions", value: (r) => r.total_count },
              ]}
            />

            <Table
              title="By method"
              file={`by-method_${ledger}_${period}.csv`}
              rows={data.by_channel}
              cols={[
                {
                  header: "Method",
                  value: (r) => channelLabel(r.channel),
                  render: (r) => <b>{channelLabel(r.channel)}</b>,
                },
                {
                  header: "Direction",
                  value: (r) =>
                    r.direction === "COLLECTION" ? "Money in" : "Money out",
                },
                ...moneyCols<(typeof data.by_channel)[number]>(),
              ]}
            />

            <Table
              title="Day by day"
              file={`by-day_${ledger}_${period}.csv`}
              rows={data.by_day}
              cols={[
                {
                  header: "Day",
                  value: (r) => r.day,
                  render: (r) => <b>{r.day}</b>,
                },
                ...moneyCols<(typeof data.by_day)[number]>(),
                { header: "Transactions", value: (r) => r.total_count },
              ]}
            />

            <p className="bk-muted flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Money columns count completed (successful) transactions only;
              pending and failed are shown separately. Every row in every table
              can be downloaded as CSV for Excel.
            </p>
          </>
        )}
      </div>
      {paying && (
        <PayDialog
          b={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            setLoading(true);
            setReload((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}
