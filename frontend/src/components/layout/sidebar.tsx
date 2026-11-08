"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BookOpen, Users, Send, Zap, Receipt, ChevronsLeft, ChevronsRight, CreditCard } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/payments", label: "Collections", icon: CreditCard },
      { href: "/disbursements", label: "Disbursements", icon: Send },
      { href: "/transactions", label: "Transactions", icon: Receipt },
    ],
  },
  {
    label: "Business",
    items: [{ href: "/settings/integrators", label: "Integrators & Pricing", icon: Users }],
  },
  {
    label: "Developers",
    items: [{ href: "/developers", label: "API Docs", icon: BookOpen }],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r-2 border-sidebar-border bg-sidebar transition-[width] duration-200",
        // Phones always get the icon rail; the full sidebar from md up.
        collapsed ? "w-[68px]" : "w-[68px] md:w-64"
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b-2 border-sidebar-border px-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border-2 border-[var(--nb-ink)] bg-[var(--bk-yellow)] text-[#111111] shadow-sm">
          <Zap className="h-4 w-4" />
        </span>
        {!collapsed && (
          <div className="hidden leading-tight md:block">
            <p className="font-[family-name:var(--font-brutal)] text-sm font-bold uppercase text-sidebar-foreground">Soila Pay</p>
            <p className="text-[11px] text-muted-foreground">Aggregator Console</p>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-5">
            {!collapsed && (
              <p className="mb-1.5 hidden px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground md:block">
                {section.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
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
                    {!collapsed && <span className="hidden truncate md:inline">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="hidden h-10 items-center justify-center border-t-2 border-sidebar-border text-muted-foreground hover:bg-secondary hover:text-foreground md:flex"
      >
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
