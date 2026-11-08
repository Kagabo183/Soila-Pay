import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // Flat sticker: ink outline, solid bright fill, ink text (contrast holds
  // in both themes because the fills are light and the text is always #111).
  "inline-flex items-center gap-1.5 rounded-sm border-[1.5px] border-[var(--nb-ink)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        success: "bg-[var(--bk-green)] text-[#111111]",
        warning: "bg-[var(--bk-yellow)] text-[#111111]",
        destructive: "bg-[var(--bk-red)] text-[#111111]",
        info: "bg-[var(--bk-blue)] text-[#111111]",
        outline: "bg-transparent text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

const STATUS_MAP: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
  SUCCESS: "success",
  SUCCESSFUL: "success",
  COMPLETED: "success",
  ACTIVE: "success",
  APPROVED: "success",
  HEALTHY: "success",
  PENDING: "warning",
  PROCESSING: "warning",
  IN_PROGRESS: "warning",
  RETRYING: "warning",
  FAILED: "destructive",
  DEBIT_FAILED: "destructive",
  FAILED_REFUNDED: "warning",
  FAILED_REFUND_ERROR: "destructive",
  REJECTED: "destructive",
  ERROR: "destructive",
  EXPIRED: "destructive",
  DRAFT: "outline",
  INACTIVE: "outline",
};

export function statusToVariant(status: string) {
  return STATUS_MAP[status.toUpperCase()] ?? "default";
}

export function StatusBadge({ className, variant, dot = true, children, ...props }: StatusBadgeProps) {
  const resolvedVariant =
    variant ?? (typeof children === "string" ? statusToVariant(children) : "default");
  return (
    <span className={cn(badgeVariants({ variant: resolvedVariant }), className)} {...props}>
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            resolvedVariant === "default" || resolvedVariant === "outline" ? "bg-current" : "bg-[#111111]"
          )}
        />
      )}
      {children}
    </span>
  );
}
