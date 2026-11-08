"use client";

import * as React from "react";
import { Ledger } from "@/components/payments/ledger";
import { ReconcilePanel } from "@/components/payments/reconcile-panel";

export default function TransactionsPage() {
  const [refreshKey, setRefreshKey] = React.useState(0);
  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-6">
        <header>
          <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">Transactions</h1>
          <p className="bk-muted mt-1 max-w-2xl text-sm">
            Every collection and payout, with the fee charged, what LMBTech took and the margin you kept. Search, filter and export to CSV.
          </p>
        </header>
        <ReconcilePanel onChanged={() => setRefreshKey((k) => k + 1)} />
        <Ledger scope={{ kind: "admin" }} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
