"use client";

import { PaymentsPage } from "@/components/payments/payments-page";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

export default function PortalCollectionsPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  if (!token) return null;
  return <PaymentsPage scope={{ kind: "portal", token }} integratorKey={integrator?.sandboxApiKey} />;
}
