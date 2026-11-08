"use client";

import { Ledger } from "@/components/payments/ledger";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

export default function PortalTransactionsPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  if (!token) return null;
  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-6">
        <header>
          <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">Transactions</h1>
          <p className="bk-muted mt-1 text-sm">Every payment you received and every payout you sent, with the fee. Search, filter and export to CSV.</p>
        </header>
        <Ledger scope={{ kind: "portal", token }} />
      </div>
    </div>
  );
}
