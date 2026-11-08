"use client";

import { DisbursementsPage } from "@/components/payments/disbursements-page";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

export default function PortalDisbursementsPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  if (!token) return null;
  return <DisbursementsPage scope={{ kind: "portal", token }} />;
}
