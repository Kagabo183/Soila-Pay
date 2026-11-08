"use client";

import * as React from "react";
import { PaymentsStatement } from "@/components/payments/statement";
import { ReconcilePanel } from "@/components/payments/reconcile-panel";

export default function TransactionsPage() {
  // Bumping the key remounts the statement so totals + ledger reload after a reconcile/import.
  const [key, setKey] = React.useState(0);
  return (
    <PaymentsStatement
      key={key}
      scope={{ kind: "admin" }}
      title="Transactions"
      subtitle="Every collection, payout and cash-out across all integrators - with the fee charged, LMBTech's cost and your margin."
    >
      <ReconcilePanel onChanged={() => setKey((k) => k + 1)} />
    </PaymentsStatement>
  );
}
