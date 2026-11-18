"use client";

import { cn } from "@/lib/utils";
import { useMoneyView, useMoneyViewStore, type MoneyView } from "@/store/money-view-store";

/** "Live money | Test money" - picks which ledger every money screen shows. */
export function MoneyViewToggle({ kind, className }: { kind: "admin" | "portal"; className?: string }) {
  const view = useMoneyView(kind);
  const set = useMoneyViewStore((s) => s.set);
  const options: { v: MoneyView; label: string; on: string }[] = [
    { v: "live", label: "Live money", on: "bg-[var(--bk-green)] text-[#111111]" },
    { v: "test", label: "Test money", on: "bg-[var(--bk-yellow)] text-[#111111]" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Show live or test money"
      className={cn("inline-flex overflow-hidden rounded-sm border-2 border-[var(--nb-ink)] shadow-sm", className)}
    >
      {options.map((o, i) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={view === o.v}
          onClick={() => set(kind, o.v)}
          className={cn(
            "px-3 py-1 text-xs font-bold",
            i > 0 && "border-l-2 border-[var(--nb-ink)]",
            view === o.v ? o.on : "bg-card text-muted-foreground hover:text-foreground"
          )}
        >
          {view === o.v ? "● " : ""}
          {o.label}
        </button>
      ))}
    </div>
  );
}
