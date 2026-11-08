"use client";

import * as React from "react";
import { ArrowLeft, Check, Loader2, Send, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import {
  paymentErrorMessage,
  paymentService,
  type Payment,
  type PaymentScope,
  type PaymentSummary,
} from "@/services/payment.service";
import { BkField, BkPanel, rwf } from "./brutal";
import { phoneProblem } from "./checkout-panel";
import { PaymentsList } from "./payments-list";

const MIN = 100;
const QUICK = [1000, 5000, 10000, 50000];

type Step = "form" | "confirm" | "sending" | "done";

/** Send money to an MTN MoMo number through LMBTech's payout API. Shared by
 * the admin console (pays from Soila Pay's own LMBTech balance) and the
 * integrator portal (pays from the integrator's available balance). Payouts
 * move real money, so there's always a confirm step that shows the exact
 * amount, fee and total first. */
export function DisbursementsPage({ scope }: { scope: PaymentScope }) {
  const admin = scope.kind === "admin";
  const token = scope.kind === "portal" ? scope.token : null;
  const stableScope = React.useMemo<PaymentScope>(() => (token ? { kind: "portal", token } : { kind: "admin" }), [token]);

  const [summary, setSummary] = React.useState<PaymentSummary | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [step, setStep] = React.useState<Step>("form");
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [result, setResult] = React.useState<Payment | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    paymentService
      .summary(stableScope, "DISBURSEMENT")
      .then((s) => !cancelled && setSummary(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [stableScope, refreshKey]);

  // Keep checking a pending payout until LMBTech settles it (~3 minutes).
  React.useEffect(() => {
    if (step !== "done" || !result || result.status !== "PENDING") return;
    let tries = 0;
    const id = setInterval(async () => {
      if (++tries > 60) return clearInterval(id);
      try {
        const latest = await paymentService.get(stableScope, result.referenceId);
        if (latest.status !== "PENDING") {
          clearInterval(id);
          setResult(latest);
          setRefreshKey((k) => k + 1);
        }
      } catch {
        /* next tick */
      }
    }, 3000);
    return () => clearInterval(id);
  }, [step, result, stableScope]);

  const amountNum = Math.floor(Number(amount) || 0);
  const feePct = admin ? 0 : summary?.payoutFeePercentage ?? 0;
  const fee = Math.round((amountNum * feePct) / 100 * 100) / 100;
  const total = amountNum + fee;
  const balance = summary?.availableBalanceRwf ?? null;
  const errors = {
    name: name.trim().length < 2 ? "Enter the recipient's name" : null,
    phone: phone ? phoneProblem(phone) : "Enter the MTN number",
    amount:
      amountNum < MIN
        ? amount
          ? `Minimum is ${rwf(MIN)}`
          : "Enter an amount"
        : !admin && balance !== null && total > balance
          ? `Not enough balance: ${rwf(total)} needed, ${rwf(balance)} available`
          : null,
  };
  const valid = !Object.values(errors).some(Boolean);
  const show = (k: keyof typeof errors, v: string) => (touched || v ? errors[k] : null);

  function review(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (valid) setStep("confirm");
  }

  async function send() {
    setStep("sending");
    try {
      const p = await paymentService.createDisbursement(stableScope, {
        amountRwf: amountNum,
        recipientName: name.trim(),
        recipientPhone: phone,
        description: reason.trim() || undefined,
      });
      setResult(p);
      setStep("done");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({ title: "Payout not sent", description: paymentErrorMessage(err), variant: "error" });
      setStep("confirm");
    }
  }

  function reset() {
    setStep("form");
    setResult(null);
    setTouched(false);
    setName("");
    setPhone("");
    setAmount("");
    setReason("");
  }

  const tiles = [
    admin
      ? { label: "Paid out", value: summary ? rwf(summary.disbursedRwf) : "—", sub: summary ? `${summary.successCount} payouts` : "", fill: "bk-fill-blue" }
      : { label: "Available balance", value: balance === null ? "—" : rwf(balance), sub: "What you can pay out now", fill: "bk-fill-green" },
    admin
      ? { label: `LMBTech cost (${summary?.payoutCostPercentage ?? 5}%)`, value: summary ? `${summary.payoutCostPercentage ?? 5}%` : "—", sub: "Of every payout", fill: "bk-fill-orange" }
      : { label: "Paid out", value: summary ? rwf(summary.disbursedRwf) : "—", sub: summary ? `${summary.successCount} payouts` : "", fill: "bk-fill-blue" },
    admin
      ? { label: "Waiting / failed", value: summary ? `${summary.pendingCount} / ${summary.failedCount}` : "—", sub: summary ? `of ${summary.totalCount} payouts` : "", fill: "bk-fill-pink" }
      : { label: "Payout fee", value: summary ? `${summary.payoutFeePercentage ?? "—"}%` : "—", sub: "Added to each payout", fill: "bk-fill-pink" },
  ];

  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">Disbursements</h1>
            <p className="bk-muted mt-1 max-w-xl text-sm">
              Send money to any MTN Mobile Money number.{" "}
              {admin ? "Payouts come from Soila Pay's LMBTech balance." : "Payouts come from your available balance."}
            </p>
          </div>
          {summary && (
            <span className={cn("bk-tag px-3 py-1 text-xs", summary.testMode ? "bk-fill-yellow" : "bk-fill-green")}>
              {summary.testMode ? "🧪 Test mode - no real money" : "🟢 Live - real money"}
            </span>
          )}
        </header>

        {summary && !summary.payoutsConfigured && (
          <div className="bk-card bk-fill-red p-4 text-sm font-semibold">
            Payouts are not set up yet. Add LMBTECH_ACCOUNT_EMAIL (your LMBTech account email) and the LMBTech keys to the backend .env, then restart it.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className={cn("bk-card p-4", t.fill)}>
              <p className="bk-display text-xs font-bold uppercase">{t.label}</p>
              <p className="bk-display mt-1 truncate text-2xl font-bold">{t.value}</p>
              <p className="text-[11px] font-medium opacity-80">{t.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <BkPanel title="Send a payout" tone="bk-fill-blue">
            {step === "form" && (
              <form onSubmit={review} noValidate className="flex flex-col gap-5">
                <BkField label="Recipient name" htmlFor="po-name" error={show("name", name)}>
                  <input id="po-name" className="bk-input" value={name} aria-invalid={!!show("name", name)} onChange={(e) => setName(e.target.value)} placeholder="Aline Uwase" autoComplete="name" />
                </BkField>
                <BkField label="MTN phone number" htmlFor="po-phone" hint="Only MTN numbers (078 / 079) can receive payouts" error={show("phone", phone)}>
                  <div className="flex min-w-0">
                    <span className="bk-box bk-fill-yellow bk-display flex shrink-0 items-center border-r-0 px-3 text-sm font-bold">+250</span>
                    <input
                      id="po-phone"
                      inputMode="tel"
                      className="bk-input"
                      value={phone}
                      aria-invalid={!!show("phone", phone)}
                      onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, "").slice(0, 16))}
                      placeholder="078 123 4567"
                    />
                  </div>
                </BkField>
                <BkField label="Amount" htmlFor="po-amount" error={show("amount", amount)}>
                  <div className="relative">
                    <input
                      id="po-amount"
                      inputMode="numeric"
                      className="bk-input bk-display h-16 pr-16 text-3xl font-bold"
                      value={amount}
                      aria-invalid={!!show("amount", amount)}
                      onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))}
                      placeholder="0"
                    />
                    <span className="bk-display pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold">RWF</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {QUICK.map((v) => (
                      <button key={v} type="button" onClick={() => setAmount(String(v))} className={cn("bk-btn min-h-9 px-3 py-1 text-xs", amountNum === v ? "bk-fill-ink" : "bk-fill-paper")}>
                        {rwf(v)}
                      </button>
                    ))}
                  </div>
                </BkField>
                <BkField label="Reason (optional)" htmlFor="po-reason">
                  <input id="po-reason" className="bk-input" value={reason} onChange={(e) => setReason(e.target.value.slice(0, 60))} placeholder="Refund order #1024" />
                </BkField>
                {summary?.testMode && (
                  <button type="button" className="bk-btn bk-fill-pink self-start text-xs" onClick={() => { setName("Test Recipient"); setPhone("0780000000"); setAmount("100"); setReason("Test payout"); }}>
                    Fill test details
                  </button>
                )}
                <button type="submit" disabled={summary ? !summary.payoutsConfigured : false} className="bk-btn bk-fill-blue h-14 w-full text-lg">
                  Review payout →
                </button>
              </form>
            )}

            {(step === "confirm" || step === "sending") && (
              <div className="flex flex-col gap-5">
                <p className="bk-display text-2xl font-bold">Send this payout?</p>
                <dl className="bk-box divide-y-2 divide-[var(--bk-ink)] text-sm">
                  <Row label="To" value={<b>{name.trim()}</b>} />
                  <Row label="MTN number" value={<span className="font-mono">{phone}</span>} />
                  <Row label="They receive" value={<b className="bk-display text-base">{rwf(amountNum)}</b>} />
                  {!admin && <Row label={`Fee (${feePct}%)`} value={rwf(fee)} />}
                  {!admin && <Row label="Taken from your balance" value={<b>{rwf(total)}</b>} />}
                  {reason.trim() && <Row label="Reason" value={reason.trim()} />}
                </dl>
                <p className="bk-muted text-xs">
                  {summary?.testMode ? "Test mode: LMBTech simulates this payout." : "This sends real money and cannot be undone."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => setStep("form")} disabled={step === "sending"} className="bk-btn bk-fill-paper">
                    <ArrowLeft className="h-4 w-4" /> Edit
                  </button>
                  <button type="button" onClick={send} disabled={step === "sending"} className="bk-btn bk-fill-green flex-1">
                    {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Yes, send {rwf(amountNum)}
                  </button>
                </div>
              </div>
            )}

            {step === "done" && result && (
              <div className="flex flex-col items-center text-center">
                <div
                  className={cn(
                    "bk-box flex h-20 w-20 items-center justify-center shadow-[var(--bk-shadow)]",
                    result.status === "SUCCESS" ? "bk-fill-green" : result.status === "PENDING" ? "bk-fill-yellow" : "bk-fill-red"
                  )}
                >
                  {result.status === "SUCCESS" ? (
                    <Check className="h-12 w-12" strokeWidth={3} />
                  ) : result.status === "PENDING" ? (
                    <Smartphone className="h-10 w-10 animate-pulse" />
                  ) : (
                    <X className="h-12 w-12" strokeWidth={3} />
                  )}
                </div>
                <p className="bk-display mt-4 text-3xl font-bold uppercase">
                  {result.status === "SUCCESS" ? "Sent!" : result.status === "PENDING" ? "On its way…" : "Not sent"}
                </p>
                <p className="mt-1 max-w-sm text-sm">
                  {result.status === "SUCCESS"
                    ? `${rwf(result.amountRwf)} sent to ${result.customerName}.`
                    : result.status === "PENDING"
                      ? "MTN is processing the payout. This updates by itself."
                      : result.statusMessage || "The payout did not go through. Nothing was taken from the balance."}
                </p>
                <p className="bk-muted mt-2 font-mono text-xs">{result.referenceId}</p>
                <button type="button" onClick={reset} className="bk-btn bk-fill-blue mt-5">
                  New payout
                </button>
              </div>
            )}
          </BkPanel>

          <PaymentsList scope={stableScope} refreshKey={refreshKey} direction="DISBURSEMENT" compact showIntegrator={admin} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="bk-display shrink-0 text-xs font-bold uppercase">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}
