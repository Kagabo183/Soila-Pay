"use client";

import { PaymentsPage } from "@/components/payments/payments-page";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

export default function PortalPaymentsPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  if (!token) return null;
  return (
    <PaymentsPage
      scope={{ kind: "portal", token }}
      integratorKey={integrator?.sandboxApiKey}
      title="Accept Payments"
      subtitle="Get paid by MTN Mobile Money, Visa or Mastercard. Pick a method, enter the amount, done."
    />
  );
}
