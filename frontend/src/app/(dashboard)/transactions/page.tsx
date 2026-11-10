"use client";

import * as React from "react";
import { PaymentsStatement } from "@/components/payments/statement";
import { ReconcilePanel } from "@/components/payments/reconcile-panel";

export default function TransactionsPage() {
  // Bumping the token reloads totals + ledger after a reconcile/import. It must not
  // remount the statement: that would also remount ReconcilePanel and wipe its
  // "Checked N · corrected M" report the moment something was corrected.
  const [reload, setReload] = React.useState(0);
  return (
    <PaymentsStatement
      reloadToken={reload}
      scope={{ kind: "admin" }}
      title="Transactions"
      subtitle="Every collection, payout and cash-out across all integrators - with the fee charged, LMBTech's cost and your margin."
    >
      <ReconcilePanel onChanged={() => setReload((k) => k + 1)} />
    </PaymentsStatement>
  );
}
