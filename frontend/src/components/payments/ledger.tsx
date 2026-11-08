"use client";

import * as React from "react";
import { Download, Loader2, RefreshCw, Search } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import {
  paymentErrorMessage,
  paymentService,
  type Direction,
  type Payment,
  type PaymentScope,
  type PaymentStatus,
} from "@/services/payment.service";
import { ChannelLogo, channelLabel } from "./payment-logos";
import { StatusStamp, rwf } from "./brutal";

const PAGE_SIZE = 15;

const TYPES: { label: string; value?: Direction }[] = [
  { label: "All" },
  { label: "↓ Money in", value: "COLLECTION" },
  { label: "↑ Money out", value: "DISBURSEMENT" },
];
const STATUSES: { label: string; value?: PaymentStatus }[] = [
  { label: "Any status" },
  { label: "Paid", value: "SUCCESS" },
  { label: "Waiting", value: "PENDING" },
  { label: "Failed", value: "FAILED" },
];
const METHODS: { label: string; value?: "CARD" | "MOMO" }[] = [
  { label: "Cards + MoMo" },
  { label: "Cards", value: "CARD" },
  { label: "MoMo", value: "MOMO" },
];

function Chips<T>({ options, value, onChange }: { options: { label: string; value?: T }[]; value?: T; onChange: (v?: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("bk-btn min-h-8 px-2.5 py-0.5 text-[11px]", value === o.value ? "bk-fill-ink" : "bk-fill-paper")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One ledger for money in (collections) and money out (payouts), shared by
 * the admin console and the integrator portal. Admins also see LMBTech's
 * cost, the margin and which integrator each row belongs to. */
export function Ledger({ scope }: { scope: PaymentScope }) {
  const admin = scope.kind === "admin";
  const token = scope.kind === "portal" ? scope.token : null;
  const stableScope = React.useMemo<PaymentScope>(() => (token ? { kind: "portal", token } : { kind: "admin" }), [token]);

  const [direction, setDirection] = React.useState<Direction | undefined>();
  const [status, setStatus] = React.useState<PaymentStatus | undefined>();
  const [method, setMethod] = React.useState<"CARD" | "MOMO" | undefined>();
  const [search, setSearch] = React.useState("");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [rows, setRows] = React.useState<Payment[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);

  // Debounce typing so every keystroke doesn't hit the API.
  React.useEffect(() => {
    const id = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await paymentService.list(stableScope, { page, pageSize: PAGE_SIZE, direction, status, method, q });
      setRows(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(paymentErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [stableScope, page, direction, status, method, q]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function filter<T>(set: (v?: T) => void) {
    return (v?: T) => {
      set(v);
      setPage(1);
    };
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const all: Payment[] = [];
      for (let p = 1; p <= 10; p++) {
        const res = await paymentService.list(stableScope, { page: p, pageSize: 200, direction, status, method, q });
        all.push(...res.items);
        if (all.length >= res.total) break;
      }
      const header = ["date", "type", "status", "name", "phone", "method", "amount_rwf", "fee_rwf", ...(admin ? ["lmbtech_cost_rwf", "margin_rwf", "integrator"] : []), "reference", "gateway_transaction_id", "note"];
      const lines = all.map((r) =>
        [
          r.createdAt, r.direction, r.status, r.customerName, r.customerPhone, channelLabel(r.channel), r.amountRwf, r.feeAmountRwf,
          ...(admin ? [r.gatewayCostAmountRwf, r.marginAmountRwf, r.integratorName ?? "Console"] : []),
          r.referenceId, r.gatewayTransactionId, r.statusMessage,
        ].map(csvCell).join(",")
      );
      const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `soila-pay-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast({ title: "Export failed", description: paymentErrorMessage(e), variant: "error" });
    } finally {
      setExporting(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="bk-card min-w-0">
      <header className="flex flex-col gap-3 border-b-2 border-[var(--bk-ink)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <label htmlFor="ledger-q" className="sr-only">
              Search transactions
            </label>
            <input
              id="ledger-q"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, email or reference…"
              className="bk-input min-h-10 pl-9 text-sm"
            />
          </div>
          <button type="button" onClick={load} aria-label="Refresh" className="bk-btn bk-fill-paper min-h-10 px-3">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <button type="button" onClick={exportCsv} disabled={exporting || total === 0} className="bk-btn bk-fill-paper min-h-10 px-3 text-xs">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} CSV
          </button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Chips options={TYPES} value={direction} onChange={filter(setDirection)} />
          <Chips options={STATUSES} value={status} onChange={filter(setStatus)} />
          <Chips options={METHODS} value={method} onChange={filter(setMethod)} />
        </div>
      </header>

      {error ? (
        <p className="bk-fill-red m-4 bk-box p-3 text-sm font-semibold">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--bk-ink)] bg-secondary text-left">
                {["When", "Type", "Name", "Method", "Amount", "Fee", ...(admin ? ["LMBTech", "Margin", "Integrator"] : []), "Status"].map((h, i) => (
                  <th key={h} className={cn("bk-display whitespace-nowrap px-3 py-2.5 text-[11px] font-bold uppercase", i >= 4 && i <= (admin ? 7 : 5) && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={admin ? 10 : 7} className="px-3 py-10 text-center font-semibold">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={admin ? 10 : 7} className="px-3 py-10 text-center font-semibold">
                    No transactions match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.referenceId} className="border-b border-[var(--bk-ink)]/20 last:border-0 hover:bg-[var(--bk-yellow)]/20">
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs">{formatDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn("bk-tag", r.direction === "DISBURSEMENT" ? "bk-fill-blue" : "bk-fill-green")}>
                        {r.direction === "DISBURSEMENT" ? "↑ Out" : "↓ In"}
                      </span>
                    </td>
                    <td className="max-w-[14rem] px-3 py-2.5">
                      <p className="truncate font-semibold">{r.customerName}</p>
                      <p className="bk-muted truncate font-mono text-[10px]" title={r.referenceId}>
                        {r.referenceId}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2 whitespace-nowrap text-xs">
                        <ChannelLogo channel={r.channel} className="h-6 w-9 text-[8px]" />
                        {channelLabel(r.channel)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold">{rwf(r.amountRwf)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.feeAmountRwf === null ? "—" : rwf(r.feeAmountRwf)}</td>
                    {admin && (
                      <>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">{r.gatewayCostAmountRwf === null ? "—" : `−${rwf(r.gatewayCostAmountRwf)}`}</td>
                        <td className={cn("whitespace-nowrap px-3 py-2.5 text-right font-semibold", (r.marginAmountRwf ?? 0) < 0 && "text-destructive")}>
                          {r.marginAmountRwf === null ? "—" : rwf(r.marginAmountRwf)}
                        </td>
                        <td className="max-w-[9rem] truncate px-3 py-2.5 text-xs">{r.integratorName ?? "Console"}</td>
                      </>
                    )}
                    <td className="px-3 py-2.5">
                      <span title={[r.statusMessage, r.isTest ? "Test transaction" : null].filter(Boolean).join(" · ") || undefined}>
                        <StatusStamp status={r.status} />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-[var(--bk-ink)] px-4 py-3 text-xs font-semibold">
        <span>
          {total} transaction{total === 1 ? "" : "s"} · page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <button type="button" className="bk-btn bk-fill-paper min-h-8 px-3 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <button type="button" className="bk-btn bk-fill-paper min-h-8 px-3 text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      </footer>
    </section>
  );
}
