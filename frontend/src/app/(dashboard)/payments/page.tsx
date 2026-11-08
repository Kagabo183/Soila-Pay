"use client";

import { PaymentsPage } from "@/components/payments/payments-page";

export default function AdminPaymentsPage() {
  return (
    <PaymentsPage
      scope={{ kind: "admin" }}
      title="Accept Payments"
      subtitle="Take MTN Mobile Money, Visa and Mastercard payments, and see every payment across all integrators."
      showIntegrator
    />
  );
}
