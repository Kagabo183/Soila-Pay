"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Check, Clock, Loader2, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { paymentErrorMessage, paymentService, type PublicPayment } from "@/services/payment.service";
import { channelLabel } from "@/components/payments/payment-logos";
import { rwf } from "@/components/payments/brutal";

/** Where the card page sends the customer back to. Public - no login.
 * Keeps checking until the bank's answer is in. */
function ReturnInner() {
  const params = useSearchParams();
  const ref = params.get("ref") ?? params.get("reference_id") ?? "";
  const [payment, setPayment] = React.useState<PublicPayment | null>(null);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const error = ref ? fetchError : "This link is missing the payment reference.";

  React.useEffect(() => {
    if (!ref) return;
    let stopped = false;
    let tries = 0;
    async function tick() {
      try {
        const p = await paymentService.getPublic(ref);
        if (stopped) return;
        setPayment(p);
        if (p.status === "PENDING" && tries++ < 60) setTimeout(tick, 3000);
      } catch (e) {
        if (!stopped) setFetchError(paymentErrorMessage(e));
      }
    }
    tick();
    return () => {
      stopped = true;
    };
  }, [ref]);

  const pending = !payment || payment.status === "PENDING";
  const ok = payment?.status === "SUCCESS";
  const fill = error ? "bk-fill-red" : pending ? "bk-fill-yellow" : ok ? "bk-fill-green" : "bk-fill-red";

  return (
    <section className="bk-card w-full min-w-0 max-w-md">
      <div className={cn("flex flex-col items-center gap-3 border-b-2 border-[var(--bk-ink)] px-6 py-8 text-center", fill)}>
        <div className="bk-box bk-fill-paper flex h-20 w-20 items-center justify-center shadow-[var(--bk-shadow-sm)]">
          {error ? (
            <X className="h-12 w-12" strokeWidth={3} />
          ) : !payment ? (
            <Loader2 className="h-10 w-10 animate-spin" />
          ) : pending ? (
            <Clock className="h-10 w-10" strokeWidth={2.5} />
          ) : ok ? (
            <Check className="h-12 w-12" strokeWidth={3} />
          ) : (
            <X className="h-12 w-12" strokeWidth={3} />
          )}
        </div>
        <h1 className="bk-display text-3xl font-bold uppercase">
          {error ? "Not found" : pending ? "Confirming…" : ok ? "Paid!" : "Not paid"}
        </h1>
        <p className="max-w-xs text-sm font-medium">
          {error
            ? error
            : pending
              ? "This usually takes a few seconds. Keep this page open."
              : ok
                ? "Thank you! You can close this page."
                : payment?.statusMessage || "Your card was not charged. You can try again."}
        </p>
      </div>

      {payment && (
        <div className="p-5">
          <dl className="bk-box divide-y-2 divide-[var(--bk-ink)] text-sm">
            <div className="flex justify-between px-3 py-2">
              <dt className="bk-display text-xs font-bold uppercase">Amount</dt>
              <dd className="bk-display font-bold">{rwf(payment.amountRwf)}</dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="bk-display text-xs font-bold uppercase">Paid with</dt>
              <dd>{channelLabel(payment.channel)}</dd>
            </div>
            {payment.description && payment.description !== "payment" && (
              <div className="flex justify-between gap-3 px-3 py-2">
                <dt className="bk-display shrink-0 text-xs font-bold uppercase">For</dt>
                <dd className="min-w-0 truncate">{payment.description}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 px-3 py-2">
              <dt className="bk-display shrink-0 text-xs font-bold uppercase">Reference</dt>
              <dd className="min-w-0 truncate font-mono text-xs">{payment.referenceId}</dd>
            </div>
          </dl>
          {payment.isTest && <p className="bk-tag bk-fill-yellow mt-3">🧪 Test payment — no real money moved</p>}
          {payment.returnUrl && !pending && (
            <a href={payment.returnUrl} className="bk-btn bk-fill-ink mt-5 w-full">
              Back to the shop →
            </a>
          )}
        </div>
      )}
    </section>
  );
}

export default function PayReturnPage() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-6 overflow-x-hidden bg-[var(--bk-page)] p-4 pr-5 text-[var(--bk-ink)]">
      <div className="bk-display flex items-center gap-2 text-lg font-bold uppercase">
        <span className="bk-box bk-fill-yellow flex h-9 w-9 items-center justify-center">
          <Zap className="h-5 w-5" />
        </span>
        Soila Pay
      </div>
      <React.Suspense fallback={<Loader2 className="h-8 w-8 animate-spin" />}>
        <ReturnInner />
      </React.Suspense>
    </div>
  );
}
