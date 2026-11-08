"use client";

import { PaymentsPage } from "@/components/payments/payments-page";

export default function AdminCollectionsPage() {
  return <PaymentsPage scope={{ kind: "admin" }} showIntegrator pricingHref="/settings/integrators#pricing" />;
}
