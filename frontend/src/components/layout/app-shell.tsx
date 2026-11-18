"use client";

import * as React from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { TopNav } from "@/components/layout/top-nav";
import { useMoneyView } from "@/store/money-view-store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const view = useMoneyView("admin");
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav />
        <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin p-6">
          {/* Remount the page when the Live/Test money switch flips so it reloads that ledger. */}
          <React.Fragment key={view}>{children}</React.Fragment>
        </main>
      </div>
    </div>
  );
}
