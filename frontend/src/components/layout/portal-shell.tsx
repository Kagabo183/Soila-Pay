"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Zap, LayoutDashboard, Send, Rocket, UserCog, LogOut, History, Code2, Bell, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

const NAV = [
  { href: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/payments", label: "Collections", icon: CreditCard },
  { href: "/portal/disbursements", label: "Disbursements", icon: Send },
  { href: "/portal/transactions", label: "Transactions", icon: History },
  { href: "/portal/webhooks", label: "Webhooks", icon: Bell },
  { href: "/portal/dev-tools", label: "API Docs", icon: Code2 },
  { href: "/portal/go-live", label: "Go Live", icon: Rocket },
  { href: "/portal/account", label: "Account", icon: UserCog },
];

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const integrator = useIntegratorPortalStore((s) => s.integrator);
  const clearSession = useIntegratorPortalStore((s) => s.clearSession);

  function handleLogout() {
    clearSession();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-[68px] shrink-0 flex-col border-r-2 border-sidebar-border bg-sidebar md:w-56">
        <div className="flex h-14 items-center gap-2 border-b-2 border-sidebar-border px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border-2 border-[var(--nb-ink)] bg-[var(--bk-yellow)] text-[#111111] shadow-sm">
            <Zap className="h-4 w-4" />
          </span>
          <div className="hidden min-w-0 leading-tight md:block">
            <p className="truncate font-[family-name:var(--font-brutal)] text-sm font-bold text-sidebar-foreground">
              {integrator?.name ?? "Integrator Portal"}
            </p>
            <p className="text-[11px] text-muted-foreground">Soila Pay</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4">
          <div className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    "flex items-center gap-2.5 rounded-sm border-2 px-2.5 py-1.5 text-sm font-semibold transition-colors",
                    active
                      ? "border-[var(--nb-ink)] bg-[var(--bk-yellow)] text-[#111111] shadow-sm"
                      : "border-transparent text-sidebar-foreground/85 hover:border-[var(--nb-ink)] hover:bg-secondary hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="hidden truncate md:inline">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <button
          onClick={handleLogout}
          className="flex h-10 items-center gap-2.5 border-t-2 border-sidebar-border px-5 text-sm font-semibold text-foreground hover:bg-[var(--bk-red)] hover:text-[#111111]"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="hidden md:inline">Log out</span>
        </button>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
