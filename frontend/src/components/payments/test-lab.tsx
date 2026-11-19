"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { PaymentScope } from "@/services/payment.service";
import { CheckoutPanel } from "./checkout-panel";

/** Test Lab: the real "Take a payment" checkout, with test money. Nobody is
 * charged. MoMo goes to Soila Pay's simulator, or (admin, when Kitovu's test
 * keys are set) to Kitovu's TEST gateway with your own phone. Cards always
 * use the test card page. Integrators see it too, on their own test money. */
export function TestLab({
  scope,
  kitovuTest = false,
  onRan,
}: {
  scope: PaymentScope;
  /** Kept for callers (the old developer checks showed it in cURL). */
  integratorKey?: string;
  /** Kept for callers; the lab is always test money whatever the mode. */
  testMode?: boolean;
  /** Admin: offer Kitovu's TEST gateway for mobile money. */
  kitovuTest?: boolean;
  onRan?: () => void;
}) {
  const [route, setRoute] = React.useState<"kitovu" | "sandbox">(kitovuTest ? "kitovu" : "sandbox");

  return (
    <div className="flex flex-col gap-6">
      <div className="bk-card bk-fill-yellow p-4 text-sm">
        <p className="bk-display text-base font-bold">🧪 Test Lab - the real checkout, with test money</p>
        <p className="mt-1">
          Works exactly like <b>Take a payment</b>: pick how they pay, enter the amount, confirm, and follow it to the receipt.{" "}
          <b>No real money moves.</b> Test payments show under <b>Test money</b>.
        </p>
        {kitovuTest && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase">Mobile money goes to:</span>
            {(
              [
                ["kitovu", "Kitovu test system (your own phone)"],
                ["sandbox", "Simulator (test numbers)"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRoute(id)}
                aria-pressed={route === id}
                className={cn("bk-btn min-h-8 px-3 text-xs", route === id ? "bk-fill-ink" : "bk-fill-paper")}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <p className="bk-muted mt-2 text-xs">
          {route === "kitovu"
            ? "MTN / Airtel: Kitovu checks the name on your number, then sends the prompt to your phone - approve it to finish. Cards use the test card page (card 4242 4242 4242 4242)."
            : "Use “Fill test details”. MoMo answers by itself after ~5 seconds (0780000002 = customer says no, 0780000003 = not enough money). Cards open the test card page (4242 4242 4242 4242 approves, 4000 0000 0000 0002 is declined)."}
        </p>
      </div>

      <CheckoutPanel key={route} scope={{ ...scope, test: route }} testMode airtelAvailable onChange={() => onRan?.()} />
    </div>
  );
}
