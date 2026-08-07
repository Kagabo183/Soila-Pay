import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/20 bg-warning/10 text-warning",
        destructive: "border-destructive/20 bg-destructive/10 text-destructive",
        info: "border-primary/20 bg-primary/10 text-primary",
        outline: "border-border bg-transparent text-foreground",
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
            resolvedVariant === "success" && "bg-success",
            resolvedVariant === "warning" && "bg-warning",
            resolvedVariant === "destructive" && "bg-destructive",
            resolvedVariant === "info" && "bg-primary",
            (resolvedVariant === "default" || resolvedVariant === "outline") &&
              "bg-muted-foreground"
          )}
        />
      )}
      {children}
    </span>
  );
}
