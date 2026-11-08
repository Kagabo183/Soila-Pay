"use client";

import { PaymentsStatement } from "@/components/payments/statement";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

export default function PortalTransactionsPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  if (!token) return null;
  return (
    <PaymentsStatement
      scope={{ kind: "portal", token }}
      title="Transactions"
      subtitle="Your balance, cash-outs and every payment you received or sent - filter by date, search, export."
    />
  );
}
