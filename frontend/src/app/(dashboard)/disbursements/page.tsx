"use client";

import { DisbursementsPage } from "@/components/payments/disbursements-page";

export default function AdminDisbursementsPage() {
  return <DisbursementsPage scope={{ kind: "admin" }} />;
}
