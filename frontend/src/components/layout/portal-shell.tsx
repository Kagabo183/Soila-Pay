"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Zap, LayoutDashboard, Send, Rocket, UserCog, LogOut, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";

const NAV = [
  { href: "/portal/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/portal/collections", label: "Collections", icon: Send },
  { href: "/portal/transactions", label: "Transactions", icon: History },
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
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Zap className="h-4 w-4" />
          </span>
          <div className="leading-tight min-w-0">
            <p className="truncate text-sm font-semibold text-sidebar-foreground">
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
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-sidebar-foreground/80 hover:bg-secondary hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>

        <button
          onClick={handleLogout}
          className="flex h-10 items-center gap-2.5 border-t border-sidebar-border px-5 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Log out
        </button>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
