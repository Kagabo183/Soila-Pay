"use client";

import * as React from "react";
import Link from "next/link";
import { Landmark, Loader2, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import { paymentErrorMessage, paymentService, type Payment, type PaymentScope, type PeriodSummary } from "@/services/payment.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { Ledger } from "./ledger";
import { rwf } from "./brutal";

type Period = "today" | "yesterday" | "7d" | "month" | "lastmonth" | "year" | "all" | "custom";
const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "month", label: "This month" },
  { id: "lastmonth", label: "Last month" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(p: Period): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (offset: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  switch (p) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "yesterday":
      return { from: iso(day(-1)), to: iso(day(-1)) };
    case "7d":
      return { from: iso(day(-6)), to: iso(today) };
    case "lastmonth":
      return { from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: iso(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case "year":
      return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
    case "all":
      return { from: "", to: "" };
    default:
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
  }
}

function pretty(d: string) {
  return d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { month: "short", day: "2-digit", year: "numeric" }) : "";
}

/** LMBTech's "Payments" page for Soila Pay: date range, balance with Cashout
 * to Bank / MoMo (portal), period totals and the full ledger. Shared by the
 * admin console (all integrators) and the integrator portal. */
export function PaymentsStatement({
  scope,
  title,
  subtitle,
  children,
  reloadToken = 0,
}: {
  scope: PaymentScope;
  title: string;
  subtitle: string;
  /** Extra panels shown above the ledger (e.g. admin's Match with LMBTech). */
  children?: React.ReactNode;
  /** Bump to reload totals + ledger without remounting (children keep their state). */
  reloadToken?: number;
}) {
  const admin = scope.kind === "admin";
  const token = scope.kind === "portal" ? scope.token : null;
  const stableScope = React.useMemo<PaymentScope>(() => (token ? { kind: "portal", token } : { kind: "admin" }), [token]);

  const initial = rangeFor("month");
  const [period, setPeriod] = React.useState<Period>("month");
  const [draft, setDraft] = React.useState(initial);
  const [applied, setApplied] = React.useState(initial);
  const [summary, setSummary] = React.useState<PeriodSummary | null>(null);
  const [innerKey, setRefreshKey] = React.useState(0);
  const refreshKey = innerKey + reloadToken;
  const [cashout, setCashout] = React.useState<"MOMO" | "BANK" | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    paymentService
      .period(stableScope, applied.from, applied.to)
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => toast({ title: "Could not load totals", description: paymentErrorMessage(e), variant: "error" }));
    return () => {
      cancelled = true;
    };
  }, [stableScope, applied, refreshKey]);

  function choosePeriod(p: Period) {
    setPeriod(p);
    if (p !== "custom") setDraft(rangeFor(p));
  }

  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) {
      toast({ title: "Start date is after end date", variant: "error" });
      return;
    }
    setApplied(draft);
  }

  function reset() {
    const r = rangeFor("month");
    setPeriod("month");
    setDraft(r);
    setApplied(r);
  }

  const rangeText = applied.from || applied.to ? `${pretty(applied.from) || "Beginning"} - ${pretty(applied.to) || "Today"}` : "All time";

  const cards = [
    { label: "Total Net", value: summary?.netRwf, sub: `Collected ${summary ? rwf(summary.grossRwf) : "—"} minus fees`, fill: "bk-fill-green" },
    { label: "Total Withdraw", value: summary?.withdrawnRwf, sub: "Payouts + cash-outs (incl. fees)", fill: "bk-fill-blue" },
    { label: "Remaining Balance", value: summary?.remainingRwf, sub: "Net minus withdrawn, this period", fill: "bk-fill-pink" },
  ];

  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">{title}</h1>
            <p className="bk-muted mt-1 max-w-2xl text-sm">{subtitle}</p>
          </div>
          <span className="bk-tag bk-fill-paper px-3 py-1 text-xs">📅 {rangeText}</span>
        </header>

        {/* Balance + cash-out (portal) / pending bank cash-outs (admin) */}
        <section className="bk-card bk-fill-yellow flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
          {admin ? (
            <div>
              <p className="bk-display text-xs font-bold uppercase">Bank cash-outs waiting for you</p>
              <p className="bk-display mt-1 text-3xl font-bold">{summary ? rwf(summary.pendingBankRwf) : "…"}</p>
              <p className="text-xs font-medium">Filter by “⇪ Cash-outs” + “Waiting”, open one and press Settle after sending the bank transfer.</p>
            </div>
          ) : (
            <>
              <div>
                <p className="bk-display text-xs font-bold uppercase">Available Balance</p>
                <p className="bk-display mt-1 text-4xl font-bold">{summary?.availableBalanceRwf == null ? "…" : rwf(summary.availableBalanceRwf)}</p>
                {!!summary?.pendingBankRwf && <p className="text-xs font-medium">{rwf(summary.pendingBankRwf)} on its way to your bank</p>}
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => setCashout("BANK")} className="bk-btn bk-fill-paper">
                  <Landmark className="h-4 w-4" /> Cashout to Bank
                </button>
                <button type="button" onClick={() => setCashout("MOMO")} className="bk-btn bk-fill-ink">
                  <Smartphone className="h-4 w-4" /> Cashout to MoMo
                </button>
              </div>
            </>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className={cn("bk-card p-4", c.fill)}>
              <p className="bk-display text-xs font-bold uppercase">{c.label}</p>
              <p className={cn("bk-display mt-1 truncate text-2xl font-bold", (c.value ?? 0) < 0 && "text-[#8a0000]")}>{c.value == null ? "…" : rwf(c.value)}</p>
              <p className="text-[11px] font-medium opacity-80">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Date range */}
        <form onSubmit={apply} className="bk-card flex flex-wrap items-end gap-3 p-4">
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
            Start date
            <input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => { setPeriod("custom"); setDraft((d) => ({ ...d, from: e.target.value })); }} className="bk-input min-h-10 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
            End date
            <input type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => { setPeriod("custom"); setDraft((d) => ({ ...d, to: e.target.value })); }} className="bk-input min-h-10 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-bold uppercase">
            Period
            <select value={period} onChange={(e) => choosePeriod(e.target.value as Period)} className="bk-input min-h-10 text-sm">
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="bk-btn bk-fill-ink min-h-10">
            Apply
          </button>
          <button type="button" onClick={reset} className="bk-btn bk-fill-paper min-h-10">
            Reset
          </button>
          <span className="ml-auto text-xs font-semibold">{summary ? `${summary.transactions} transactions` : ""}</span>
        </form>

        {children}

        <Ledger scope={stableScope} refreshKey={refreshKey} dateFrom={applied.from || undefined} dateTo={applied.to || undefined} onChanged={() => setRefreshKey((k) => k + 1)} />
      </div>

      {cashout && token && (
        <CashoutDialog
          token={token}
          destination={cashout}
          balance={summary?.availableBalanceRwf ?? 0}
          onClose={() => setCashout(null)}
          onDone={() => {
            setCashout(null);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

/** Withdraw your own balance - to your MTN MoMo number or your bank account. */
function CashoutDialog({
  token,
  destination,
  balance,
  onClose,
  onDone,
}: {
  token: string;
  destination: "MOMO" | "BANK";
  balance: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const [amount, setAmount] = React.useState("");
  const [fee, setFee] = React.useState<number | null>(null);
  const [step, setStep] = React.useState<"form" | "confirm" | "sending" | "done">("form");
  const [result, setResult] = React.useState<Payment | null>(null);

  React.useEffect(() => {
    if (destination !== "MOMO") return;
    paymentService
      .summary({ kind: "portal", token })
      .then((s) => setFee(s.payoutFeePercentage))
      .catch(() => undefined);
  }, [destination, token]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && step !== "sending" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step]);

  const amountNum = Math.floor(Number(amount) || 0);
  const feeAmount = destination === "MOMO" && fee ? Math.round(amountNum * fee) / 100 : 0;
  const total = amountNum + feeAmount;
  const momo = destination === "MOMO";
  const target = momo ? integrator?.phoneNumber : integrator?.bankName && integrator?.bankAccount ? `${integrator.bankName} · ${integrator.bankAccount}` : null;
  const maxAmount = momo && fee ? Math.floor(balance / (1 + fee / 100)) : Math.floor(balance);
  const error = !amount ? null : amountNum < 100 ? "Minimum is 100 RWF" : total > balance ? `More than your balance (${rwf(balance)})` : null;

  async function send() {
    setStep("sending");
    try {
      setResult(await paymentService.cashout(token, destination, amountNum));
      setStep("done");
    } catch (e) {
      toast({ title: "Cash-out not made", description: paymentErrorMessage(e), variant: "error" });
      setStep("confirm");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Cash out" onClick={() => step !== "sending" && onClose()}>
      <div className="bk-card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <header className={cn("flex items-center justify-between border-b-2 border-[var(--bk-ink)] px-4 py-3", momo ? "bk-fill-yellow" : "bk-fill-blue")}>
          <h2 className="bk-display flex items-center gap-2 text-base font-bold uppercase">
            {momo ? <Smartphone className="h-4 w-4" /> : <Landmark className="h-4 w-4" />} Cashout to {momo ? "MoMo" : "Bank"}
          </h2>
          <button type="button" onClick={onClose} disabled={step === "sending"} aria-label="Close" className="bk-btn bk-fill-paper min-h-8 px-2">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-4">
          {!target ? (
            <div className="bk-box bk-fill-red p-3 text-sm font-semibold">
              {momo ? (
                "No MTN number on your account yet - ask Soila Pay to add your phone number."
              ) : (
                <>
                  Add your bank name and account number first on the{" "}
                  <Link href="/portal/account" className="underline">
                    Account page
                  </Link>
                  .
                </>
              )}
            </div>
          ) : step === "done" && result ? (
            <div className="text-center">
              <p className="bk-display text-2xl font-bold uppercase">
                {result.status === "SUCCESS" ? "Sent!" : result.status === "FAILED" ? "Not sent" : momo ? "On its way…" : "Request sent"}
              </p>
              <p className="mt-2 text-sm">
                {result.status === "FAILED"
                  ? result.statusMessage ?? "The cash-out failed - nothing was taken from your balance."
                  : momo
                    ? `${rwf(result.amountRwf)} to ${target}.`
                    : `Soila Pay will send ${rwf(result.amountRwf)} to ${target}. The money is reserved from your balance until then.`}
              </p>
              <p className="bk-muted mt-2 font-mono text-xs">{result.referenceId}</p>
              <button type="button" onClick={onDone} className="bk-btn bk-fill-green mt-4">
                Done
              </button>
            </div>
          ) : step === "form" ? (
            <>
              <div className="bk-box p-3 text-sm">
                <p className="bk-display text-[11px] font-bold uppercase">To</p>
                <p className="font-semibold">{target}</p>
                <p className="bk-display mt-2 text-[11px] font-bold uppercase">Available balance</p>
                <p className="font-semibold">{rwf(balance)}</p>
              </div>
              <label className="flex flex-col gap-1 text-sm font-bold uppercase">
                Amount (RWF)
                <input inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))} className="bk-input bk-display h-14 text-2xl" placeholder="0" aria-invalid={!!error} />
              </label>
              {error && <p className="text-sm font-semibold text-[var(--bk-red)]">✕ {error}</p>}
              <button type="button" onClick={() => setAmount(String(Math.max(0, maxAmount)))} className="bk-btn bk-fill-paper self-start min-h-8 px-3 text-xs">
                Use max ({rwf(Math.max(0, maxAmount))})
              </button>
              <button type="button" disabled={!amount || !!error} onClick={() => setStep("confirm")} className="bk-btn bk-fill-ink h-12">
                Review →
              </button>
            </>
          ) : (
            <>
              <dl className="bk-box divide-y-2 divide-[var(--bk-ink)] text-sm">
                <div className="flex justify-between px-3 py-2"><dt className="font-bold uppercase text-xs">To</dt><dd>{target}</dd></div>
                <div className="flex justify-between px-3 py-2"><dt className="font-bold uppercase text-xs">You receive</dt><dd className="font-bold">{rwf(amountNum)}</dd></div>
                {momo && <div className="flex justify-between px-3 py-2"><dt className="font-bold uppercase text-xs">Fee ({fee ?? "—"}%)</dt><dd>{rwf(feeAmount)}</dd></div>}
                <div className="flex justify-between px-3 py-2"><dt className="font-bold uppercase text-xs">Taken from balance</dt><dd className="font-bold">{rwf(total)}</dd></div>
              </dl>
              <p className="bk-muted text-xs">{momo ? "Sent instantly through LMBTech to your MTN number." : "Soila Pay sends the bank transfer, usually within 1 business day."}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep("form")} disabled={step === "sending"} className="bk-btn bk-fill-paper">
                  Edit
                </button>
                <button type="button" onClick={send} disabled={step === "sending"} className="bk-btn bk-fill-green flex-1">
                  {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Yes, cash out {rwf(amountNum)}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
