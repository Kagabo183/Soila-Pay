"use client";

import { OverviewDashboard } from "@/components/payments/overview-dashboard";

export default function DashboardPage() {
  return (
    <div className="-m-6 min-h-full bg-[var(--bk-page)] p-4 text-[var(--bk-ink)] sm:p-6">
      <div className="mx-auto flex min-w-0 max-w-6xl flex-col gap-6">
        <header>
          <h1 className="bk-display text-3xl font-bold uppercase sm:text-4xl">Dashboard</h1>
          <p className="bk-muted mt-1 text-sm">Money in (cards and MoMo) and money out (payouts) across every integrator, live from LMBTech.</p>
        </header>
        <OverviewDashboard
          scope={{ kind: "admin" }}
          links={{ collections: "/payments", disbursements: "/disbursements", transactions: "/transactions" }}
        />
      </div>
    </div>
  );
}
