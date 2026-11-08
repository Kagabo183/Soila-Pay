"use client";

import * as React from "react";
import { BkPanel } from "@/components/payments/brutal";
import { paymentService, type PaymentSummary } from "@/services/payment.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

export default function PortalAccountPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const [summary, setSummary] = React.useState<PaymentSummary | null>(null);

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    paymentService
      .summary({ kind: "portal", token })
      .then((s) => !cancelled && setSummary(s))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!integrator) return null;

  const fields: [string, React.ReactNode][] = [
    ["Business name", integrator.name],
    ["Email", integrator.email ?? "—"],
    ["Phone", integrator.phoneNumber ?? "—"],
    ["Business location", integrator.businessLocation ?? "—"],
    ["IP whitelist", integrator.ipWhitelist || "Not set"],
    ["Account", integrator.isActive ? "Active" : "Disabled"],
  ];

  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-3xl flex-col gap-6">
        <header>
          <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">Account</h1>
          <p className="bk-muted mt-1 text-sm">Your business details and what you pay per transaction.</p>
        </header>

        <BkPanel title="Your fees" tone="bk-fill-pink">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="bk-box p-3">
              <p className="bk-display text-xs font-bold uppercase">Collections</p>
              <p className="bk-display mt-1 text-2xl font-bold">{summary?.feePercentage ?? "—"}%</p>
              <p className="bk-muted text-xs">Of each payment you receive</p>
            </div>
            <div className="bk-box p-3">
              <p className="bk-display text-xs font-bold uppercase">Payouts</p>
              <p className="bk-display mt-1 text-2xl font-bold">{summary?.payoutFeePercentage ?? "—"}%</p>
              <p className="bk-muted text-xs">Added to each payout you send</p>
            </div>
            <div className="bk-box p-3">
              <p className="bk-display text-xs font-bold uppercase">Available balance</p>
              <p className="bk-display mt-1 text-2xl font-bold">
                {summary?.availableBalanceRwf == null ? "—" : `${Math.round(summary.availableBalanceRwf).toLocaleString("en-RW")} RWF`}
              </p>
              <p className="bk-muted text-xs">What you can pay out now</p>
            </div>
          </div>
          <p className="bk-muted mt-3 text-xs">Fees are set by Soila Pay. Contact us to discuss pricing.</p>
        </BkPanel>

        <BkPanel title="Business details">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {fields.map(([label, value]) => (
              <div key={label}>
                <dt className="bk-display text-xs font-bold uppercase">{label}</dt>
                <dd className="mt-0.5 font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </BkPanel>
      </div>
    </div>
  );
}
