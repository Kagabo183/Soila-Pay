"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CreditCard, FlaskConical, Loader2, Lock, X, Zap } from "lucide-react";
import { paymentErrorMessage, paymentService, type PublicPayment } from "@/services/payment.service";
import { channelLabel } from "@/components/payments/payment-logos";
import { rwf } from "@/components/payments/brutal";

const SUCCESS_CARD = "4242 4242 4242 4242";
const DECLINE_CARD = "4000 0000 0000 0002";

/** Soila Pay's SANDBOX card page - where a sandbox card payment sends the
 * customer instead of the bank's real page. Nothing is charged: Pay /
 * Decline just decide the simulated outcome, then the customer lands on the
 * normal receipt (and the integrator's return_url / webhooks), exactly like a
 * live payment. The server only accepts pending SANDBOX rows here. */
function SandboxCardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const ref = params.get("ref") ?? "";
  const [payment, setPayment] = React.useState<PublicPayment | null>(null);
  const [error, setError] = React.useState<string | null>(ref ? null : "This link is missing the payment reference.");
  const [card, setCard] = React.useState(SUCCESS_CARD);
  const [busy, setBusy] = React.useState<"pay" | "cancel" | null>(null);

  React.useEffect(() => {
    if (!ref) return;
    paymentService
      .getPublic(ref)
      .then((p) => {
        setPayment(p);
        if (!p.isTest) setError("This is not a sandbox payment.");
        else if (p.status !== "PENDING") router.replace(`/pay/return?ref=${encodeURIComponent(ref)}`);
      })
      .catch((e) => setError(paymentErrorMessage(e)));
  }, [ref, router]);

  async function finish(approve: boolean) {
    setBusy(approve ? "pay" : "cancel");
    try {
      await paymentService.completeSandboxCard(ref, approve, card);
      router.replace(`/pay/return?ref=${encodeURIComponent(ref)}`);
    } catch (e) {
      setError(paymentErrorMessage(e));
      setBusy(null);
    }
  }

  return (
    <section className="bk-card w-full min-w-0 max-w-md">
      <p className="bk-fill-yellow flex items-center justify-center gap-2 border-b-2 border-[var(--bk-ink)] px-3 py-2 text-xs font-bold uppercase">
        <FlaskConical className="h-4 w-4" /> Sandbox - no real card is charged
      </p>
      {error ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <X className="h-10 w-10" strokeWidth={3} />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      ) : !payment ? (
        <div className="flex justify-center p-10">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-5">
          <div className="text-center">
            <p className="bk-display text-xs font-bold uppercase">{channelLabel(payment.channel)} payment</p>
            <p className="bk-display mt-1 text-4xl font-bold">{rwf(payment.amountRwf)}</p>
            {payment.description && payment.description !== "payment" && <p className="bk-muted mt-1 text-sm">{payment.description}</p>}
          </div>
          <label className="flex flex-col gap-1 text-xs font-bold uppercase" htmlFor="sb-card">
            Test card number
            <span className="relative">
              <CreditCard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
              <input
                id="sb-card"
                value={card}
                onChange={(e) => setCard(e.target.value.replace(/[^\d ]/g, "").slice(0, 23))}
                className="bk-input pl-9 font-mono text-base normal-case"
                inputMode="numeric"
                autoComplete="off"
              />
            </span>
          </label>
          <div className="bk-box p-3 text-xs">
            <p className="font-bold uppercase">Test cards</p>
            <p className="mt-1">
              <button type="button" onClick={() => setCard(SUCCESS_CARD)} className="font-mono underline">
                {SUCCESS_CARD}
              </button>{" "}
              approves
            </p>
            <p className="mt-1">
              <button type="button" onClick={() => setCard(DECLINE_CARD)} className="font-mono underline">
                {DECLINE_CARD}
              </button>{" "}
              is declined by the bank
            </p>
          </div>
          <button type="button" onClick={() => finish(true)} disabled={busy !== null} className="bk-btn bk-fill-green h-14 w-full text-lg">
            {busy === "pay" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-5 w-5" />} Pay {rwf(payment.amountRwf)}
          </button>
          <button type="button" onClick={() => finish(false)} disabled={busy !== null} className="bk-btn bk-fill-paper w-full text-xs">
            {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Cancel payment
          </button>
        </div>
      )}
    </section>
  );
}

export default function SandboxCardPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-6 overflow-x-hidden bg-[var(--bk-page)] p-4 pr-5 text-[var(--bk-ink)]">
      <div className="bk-display flex items-center gap-2 text-lg font-bold uppercase">
        <span className="bk-box bk-fill-yellow flex h-9 w-9 items-center justify-center">
          <Zap className="h-5 w-5" />
        </span>
        Soila Pay
      </div>
      <React.Suspense fallback={<Loader2 className="h-8 w-8 animate-spin" />}>
        <SandboxCardInner />
      </React.Suspense>
    </div>
  );
}
