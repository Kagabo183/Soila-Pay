"use client";

import * as React from "react";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { integratorsService } from "@/services/integrators.service";
import { useIntegratorFilterStore } from "@/store/integrator-filter-store";

/** Admin top bar: "All integrators / Soila Pay console / <integrator>" - every
 * money screen (dashboard, collections, payouts, transactions, reconciliation,
 * integrators) then shows only that one. */
export function IntegratorFilter({ className }: { className?: string }) {
  const id = useIntegratorFilterStore((s) => s.id);
  const set = useIntegratorFilterStore((s) => s.set);
  const [options, setOptions] = React.useState<{ id: number; name: string }[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    integratorsService
      .list()
      .then((list) => {
        if (!cancelled) setOptions(list.map((i) => ({ id: Number(i.id), name: i.name })).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const active = id !== null;
  return (
    <label
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border-2 border-[var(--nb-ink)] px-2 py-1 text-xs font-bold shadow-sm",
        active ? "bg-[var(--bk-blue)] text-[#111111]" : "bg-card",
        className
      )}
    >
      <Filter className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="sr-only">Show transactions of</span>
      <select
        value={id === null ? "" : String(id)}
        onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}
        className="max-w-[11rem] cursor-pointer bg-transparent font-bold outline-none"
      >
        <option value="">All integrators</option>
        <option value="0">Soila Pay console (own)</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
