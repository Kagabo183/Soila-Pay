import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  icon?: LucideIcon;
  accent?: "primary" | "success" | "warning" | "destructive";
}

const ACCENT_MAP: Record<NonNullable<StatCardProps["accent"]>, string> = {
  primary: "bg-[var(--bk-blue)] text-[#111111]",
  success: "bg-[var(--bk-green)] text-[#111111]",
  warning: "bg-[var(--bk-yellow)] text-[#111111]",
  destructive: "bg-[var(--bk-red)] text-[#111111]",
};

export function StatCard({ label, value, change, changeLabel, icon: Icon, accent = "primary" }: StatCardProps) {
  const positive = (change ?? 0) >= 0;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <span className={cn("flex h-9 w-9 items-center justify-center rounded-sm border-2 border-[var(--nb-ink)]", ACCENT_MAP[accent])}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-2 font-[family-name:var(--font-brutal)] text-2xl font-bold tracking-tight text-foreground">{value}</p>
      {change !== undefined && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          <span
            className={cn(
              "flex items-center gap-0.5 font-medium",
              positive ? "text-success" : "text-destructive"
            )}
          >
            {positive ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {Math.abs(change)}%
          </span>
          {changeLabel && <span className="text-muted-foreground">{changeLabel}</span>}
        </div>
      )}
    </Card>
  );
}
