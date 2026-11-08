import * as React from "react";
import { cn } from "@/lib/utils";

export type BkStatus = "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED";

const STATUS_STYLE: Record<BkStatus, { label: string; fill: string }> = {
  SUCCESS: { label: "Paid", fill: "bk-fill-green" },
  PENDING: { label: "Waiting", fill: "bk-fill-yellow" },
  FAILED: { label: "Failed", fill: "bk-fill-red" },
  CANCELLED: { label: "Cancelled", fill: "bk-fill-red" },
};

export function StatusStamp({ status, className }: { status: BkStatus; className?: string }) {
  const s = STATUS_STYLE[status];
  return <span className={cn("bk-tag", s.fill, className)}>{s.label}</span>;
}

export function rwf(value: number) {
  return new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(value) + " RWF";
}

/** Label + input + one line of help or error, sized for thumbs. */
export function BkField({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="bk-display text-sm font-bold uppercase">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm font-semibold text-[var(--bk-red)]" role="alert">
          ✕ {error}
        </p>
      ) : hint ? (
        <p className="bk-muted text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

export function BkPanel({
  title,
  action,
  children,
  className,
  tone = "bk-fill-paper",
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <section className={cn("bk-card", className)}>
      {title && (
        <header className={cn("flex flex-wrap items-center justify-between gap-2 border-b-2 border-[var(--bk-ink)] px-4 py-3", tone)}>
          <h2 className="bk-display text-base font-bold uppercase">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}
