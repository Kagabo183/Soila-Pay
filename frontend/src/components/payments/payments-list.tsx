"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import {
  paymentErrorMessage,
  paymentService,
  type Payment,
  type PaymentScope,
  type PaymentStatus,
  type PaymentSummary,
} from "@/services/payment.service";
import { ChannelLogo, channelLabel } from "./payment-logos";
import { BkPanel, StatusStamp, rwf } from "./brutal";

const FILTERS: { label: string; status?: PaymentStatus }[] = [
  { label: "All" },
  { label: "Paid", status: "SUCCESS" },
  { label: "Waiting", status: "PENDING" },
  { label: "Failed", status: "FAILED" },
];

export function PaymentSummaryTiles({ summary }: { summary: PaymentSummary | null }) {
  const tiles = [
    { label: "Received", value: summary ? rwf(summary.collectedRwf) : "—", sub: summary ? `${summary.successCount} paid` : "", fill: "bk-fill-green" },
    { label: "MTN MoMo", value: summary ? rwf(summary.momoRwf) : "—", sub: "Mobile money", fill: "bk-fill-yellow" },
    { label: "Cards", value: summary ? rwf(summary.cardRwf) : "—", sub: "Visa · Mastercard · other", fill: "bk-fill-blue" },
    {
      label: "Waiting / failed",
      value: summary ? `${summary.pendingCount} / ${summary.failedCount}` : "—",
      sub: summary ? `of ${summary.totalCount} total` : "",
      fill: "bk-fill-pink",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={cn("bk-card p-4", t.fill)}>
          <p className="bk-display text-xs font-bold uppercase">{t.label}</p>
          <p className="bk-display mt-1 truncate text-xl font-bold sm:text-2xl">{t.value}</p>
          <p className="text-[11px] font-medium opacity-80">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}

interface PaymentsListProps {
  scope: PaymentScope;
  refreshKey?: number;
  showIntegrator?: boolean;
  compact?: boolean;
  onSummary?: (summary: PaymentSummary) => void;
}

export function PaymentsList({ scope, refreshKey = 0, showIntegrator = false, compact = false, onSummary }: PaymentsListProps) {
  const [items, setItems] = React.useState<Payment[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<PaymentStatus | undefined>();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const pageSize = compact ? 6 : 12;
  const onSummaryRef = React.useRef(onSummary);
  React.useEffect(() => {
    onSummaryRef.current = onSummary;
  }, [onSummary]);
  const token = scope.kind === "portal" ? scope.token : null;
  const stableScope = React.useMemo<PaymentScope>(() => (token ? { kind: "portal", token } : { kind: "admin" }), [token]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, summary] = await Promise.all([
        paymentService.list(stableScope, { page, pageSize, status }),
        paymentService.summary(stableScope),
      ]);
      setItems(list.items);
      setTotal(list.total);
      onSummaryRef.current?.(summary);
    } catch (e) {
      setError(paymentErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, status, stableScope]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <BkPanel
      title={compact ? "Latest payments" : "All payments"}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {!compact &&
            FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => {
                  setStatus(f.status);
                  setPage(1);
                }}
                aria-pressed={status === f.status}
                className={cn("bk-btn min-h-8 px-2.5 py-0.5 text-[11px]", status === f.status ? "bk-fill-ink" : "bk-fill-paper")}
              >
                {f.label}
              </button>
            ))}
          <button type="button" onClick={load} aria-label="Refresh" title="Refresh" className="bk-btn bk-fill-paper min-h-8 px-2 py-0.5">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      }
    >
      {error ? (
        <p className="bk-box bk-fill-red p-3 text-sm font-semibold">{error}</p>
      ) : !loading && items.length === 0 ? (
        <div className="bk-box border-dashed p-8 text-center">
          <p className="bk-display text-lg font-bold">No payments yet</p>
          <p className="bk-muted mt-1 text-sm">Take one, or press “Run all” in the Test Lab.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((p) => (
            <li key={p.referenceId} className="bk-box flex items-center gap-3 p-3">
              {!compact && <ChannelLogo channel={p.channel} className="hidden sm:inline-flex" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {p.customerName}
                  {!compact && p.description && p.description !== "payment" && (
                    <span className="bk-muted font-normal"> · {p.description}</span>
                  )}
                </p>
                <p className="bk-muted truncate text-xs">
                  {channelLabel(p.channel)} · {formatDateTime(p.createdAt)}
                  {showIntegrator && ` · ${p.integratorName ?? "Console"}`}
                </p>
                {p.status === "FAILED" && p.statusMessage && <p className="truncate text-xs font-semibold">✕ {p.statusMessage}</p>}
                <p className="bk-muted truncate font-mono text-[11px]">{p.referenceId}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="bk-display font-bold">{rwf(p.amountRwf)}</span>
                <div className="flex items-center gap-1">
                  {p.isTest && <span className="bk-tag bk-fill-paper">Test</span>}
                  <StatusStamp status={p.status} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
          <span>
            Page {page} of {pages} · {total} payments
          </span>
          <div className="flex gap-2">
            <button type="button" className="bk-btn bk-fill-paper min-h-8 px-3 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <button type="button" className="bk-btn bk-fill-paper min-h-8 px-3 text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </div>
      )}
    </BkPanel>
  );
}
