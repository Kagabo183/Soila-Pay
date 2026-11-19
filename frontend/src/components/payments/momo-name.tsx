"use client";

import * as React from "react";
import { BadgeCheck, Loader2, UserX } from "lucide-react";
import { paymentService, type PaymentChannel, type PaymentScope } from "@/services/payment.service";

export type MomoNameState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "found"; name: string }
  | { status: "unknown" };

/** As soon as a full, valid MoMo number is typed, ask the gateway whose
 * number it is (Kitovu's name check; the simulator in test). Shows nothing
 * when the MoMo gateway can't look names up (LMBTech). `onFound` gets the
 * name so the page can fill in its name field. */
export function useMomoName(
  scope: PaymentScope,
  channel: PaymentChannel | null,
  phone: string,
  phoneError: string | null,
  onFound?: (name: string) => void
): MomoNameState {
  const scopeKey = JSON.stringify(scope);
  const key = channel && phone && !phoneError ? `${scopeKey}|${channel}|${phone}` : null;
  const [answer, setAnswer] = React.useState<{ key: string; state: MomoNameState } | null>(null);
  const onFoundRef = React.useRef(onFound);
  React.useEffect(() => {
    onFoundRef.current = onFound;
  }, [onFound]);

  React.useEffect(() => {
    if (!key || !channel) return;
    let cancelled = false;
    // Wait until typing stops, then ask once.
    const timer = setTimeout(async () => {
      let state: MomoNameState = { status: "idle" };
      try {
        const found = await paymentService.momoLookup(JSON.parse(scopeKey) as PaymentScope, { channel, phone, amountRwf: 100 });
        if (found.verified && found.accountName) state = { status: "found", name: found.accountName };
        else if ((found.gateway ?? "").toUpperCase() !== "LMBTECH") state = { status: "unknown" };
      } catch {
        // No answer: show nothing rather than block the form.
      }
      if (cancelled) return;
      setAnswer({ key, state });
      if (state.status === "found") onFoundRef.current?.(state.name);
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, channel, phone, scopeKey]);

  if (!key) return { status: "idle" };
  return answer?.key === key ? answer.state : { status: "checking" };
}

/** The line under the phone field: the registered name, or a warning. */
export function MomoNameHint({ state }: { state: MomoNameState }) {
  if (state.status === "idle") return null;
  if (state.status === "checking")
    return (
      <p className="mt-2 flex items-center gap-2 text-sm font-semibold" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking whose number this is…
      </p>
    );
  if (state.status === "found")
    return (
      <p className="bk-box bk-fill-green mt-2 flex items-center gap-2 px-3 py-2 text-sm font-bold" aria-live="polite">
        <BadgeCheck className="h-4 w-4 shrink-0" /> {state.name}
      </p>
    );
  return (
    <p className="bk-box bk-fill-yellow mt-2 flex items-center gap-2 px-3 py-2 text-sm font-semibold" aria-live="polite">
      <UserX className="h-4 w-4 shrink-0" /> No name found for this number - check it with the customer
    </p>
  );
}
