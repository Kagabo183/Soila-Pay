"use client";

import * as React from "react";
import { Check, Copy, Download, Eye, Loader2, RefreshCw, Search, X } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import {
  paymentErrorMessage,
  paymentService,
  type Payment,
  type PaymentScope,
  type PaymentStatus,
} from "@/services/payment.service";
import { ChannelLogo, channelLabel } from "./payment-logos";
import { StatusStamp, rwf } from "./brutal";

const PAGE_SIZES = [10, 25, 50, 100];

type TypeFilter = "IN" | "OUT" | "CASHOUT";
const TYPES: { label: string; value?: TypeFilter }[] = [
  { label: "All" },
  { label: "↓ Collection", value: "IN" },
  { label: "↑ Disbursement", value: "OUT" },
  { label: "⇪ Cash-outs", value: "CASHOUT" },
];
const STATUSES: { label: string; value?: PaymentStatus }[] = [
  { label: "Any status" },
  { label: "Success", value: "SUCCESS" },
  { label: "Waiting", value: "PENDING" },
  { label: "Failed", value: "FAILED" },
];
const METHODS: { label: string; value?: "CARD" | "MOMO" | "BANK" }[] = [
  { label: "Any method" },
  { label: "Cards", value: "CARD" },
  { label: "MoMo", value: "MOMO" },
  { label: "Bank", value: "BANK" },
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

function typeLabel(r: Payment) {
  if (r.isCashout) return { text: "⇪ Cash-out", fill: "bk-fill-pink" };
  return r.direction === "DISBURSEMENT" ? { text: "↑ Out", fill: "bk-fill-blue" } : { text: "↓ In", fill: "bk-fill-green" };
}

/** What the integrator actually got (in) or what left their balance (out). */
function netOf(r: Payment) {
  const fee = r.feeAmountRwf ?? 0;
  return r.direction === "COLLECTION" ? r.amountRwf - fee : r.amountRwf + fee;
}

/** One ledger for money in, money out and cash-outs - shared by the admin
 * console and the integrator portal (LMBTech's "Payments" table). Admins
 * also see LMBTech's cost, the margin, the integrator, and can settle bank
 * cash-outs from the details panel. */
export function Ledger({
  scope,
  refreshKey = 0,
  dateFrom,
  dateTo,
  onChanged,
}: {
  scope: PaymentScope;
  refreshKey?: number;
  /** YYYY-MM-DD range (inclusive), controlled by the page's date bar. */
  dateFrom?: string;
  dateTo?: string;
  /** Called after an admin settles a cash-out, so totals refresh. */
  onChanged?: () => void;
}) {
  const admin = scope.kind === "admin";
  const token = scope.kind === "portal" ? scope.token : null;
  const stableScope = React.useMemo<PaymentScope>(() => (token ? { kind: "portal", token } : { kind: "admin" }), [token]);

  const [type, setType] = React.useState<TypeFilter | undefined>();
  const [status, setStatus] = React.useState<PaymentStatus | undefined>();
  const [method, setMethod] = React.useState<"CARD" | "MOMO" | "BANK" | undefined>();
  const [search, setSearch] = React.useState("");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [rows, setRows] = React.useState<Payment[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [detail, setDetail] = React.useState<Payment | null>(null);
  const [innerRefresh, setInnerRefresh] = React.useState(0);

  // Debounce typing so every keystroke doesn't hit the API.
  React.useEffect(() => {
    const id = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  // A new date range starts from page 1.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [dateFrom, dateTo]);

  const query = React.useMemo(
    () => ({
      direction: type === "IN" ? ("COLLECTION" as const) : type === "OUT" ? ("DISBURSEMENT" as const) : undefined,
      cashout: type === "CASHOUT" ? true : type === "OUT" ? false : undefined,
      status,
      method,
      q,
      dateFrom,
      dateTo,
    }),
    [type, status, method, q, dateFrom, dateTo]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await paymentService.list(stableScope, { ...query, page, pageSize });
      setRows(res.items);
      setTotal(res.total);
    } catch (e) {
      setError(paymentErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [stableScope, query, page, pageSize]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshKey, innerRefresh]);

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
        const res = await paymentService.list(stableScope, { ...query, page: p, pageSize: 200 });
        all.push(...res.items);
        if (all.length >= res.total) break;
      }
      const header = [
        "date", "type", "status", "name", "phone", "method", "amount_rwf", "fee_rwf", "net_rwf",
        ...(admin ? ["lmbtech_cost_rwf", "margin_rwf", "integrator", "lmbtech_reported_amount_rwf", "corrected", "imported"] : []),
        "reference", "transaction_id", "note",
      ];
      const lines = all.map((r) =>
        [
          r.createdAt, r.isCashout ? "CASHOUT" : r.direction, r.status, r.customerName, r.customerPhone, channelLabel(r.channel),
          r.amountRwf, r.feeAmountRwf, netOf(r),
          ...(admin ? [r.gatewayCostAmountRwf, r.marginAmountRwf, r.integratorName ?? "Console", r.gatewayAmountRwf, r.reconciled, r.imported] : []),
          r.referenceId, r.gatewayTransactionId, r.statusMessage,
        ].map(csvCell).join(",")
      );
      const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `soila-pay-transactions-${dateFrom ?? "all"}-${dateTo ?? "now"}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast({ title: "Export failed", description: paymentErrorMessage(e), variant: "error" });
    } finally {
      setExporting(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const headers = ["#", "Date", "Type", "Name", "Phone", "Amount", "Fee", "Net", ...(admin ? ["LMBTech", "Margin", "Integrator"] : []), "Status", "Action"];
  const rightCols = new Set(["Amount", "Fee", "Net", "LMBTech", "Margin"]);

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
              placeholder="Search name, phone, email, reference or transaction ID…"
              className="bk-input min-h-10 pl-9 text-sm"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-bold uppercase">
            Show
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="bk-input min-h-10 w-20 py-1 text-sm"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            entries
          </label>
          <button type="button" onClick={load} aria-label="Refresh" className="bk-btn bk-fill-paper min-h-10 px-3">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <button type="button" onClick={exportCsv} disabled={exporting || total === 0} className="bk-btn bk-fill-paper min-h-10 px-3 text-xs">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} CSV
          </button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Chips options={TYPES} value={type} onChange={filter(setType)} />
          <Chips options={STATUSES} value={status} onChange={filter(setStatus)} />
          <Chips options={METHODS} value={method} onChange={filter(setMethod)} />
        </div>
      </header>

      {error ? (
        <p className="bk-fill-red m-4 bk-box p-3 text-sm font-semibold">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--bk-ink)] bg-secondary text-left">
                {headers.map((h) => (
                  <th key={h} className={cn("bk-display whitespace-nowrap px-2 py-2.5 text-[11px] font-bold uppercase", rightCols.has(h) && "text-right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="px-3 py-10 text-center font-semibold">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={headers.length} className="px-3 py-10 text-center font-semibold">
                    No transactions match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const t = typeLabel(r);
                  return (
                    <tr key={r.referenceId} className="border-b border-[var(--bk-ink)]/20 last:border-0 hover:bg-[var(--bk-yellow)]/20">
                      <td className="px-2 py-2.5 text-xs font-semibold">{first + i}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-xs">{formatDateTime(r.createdAt)}</td>
                      <td className="px-2 py-2.5">
                        <span className={cn("bk-tag", t.fill)}>{t.text}</span>
                      </td>
                      <td className="max-w-[13rem] px-2 py-2.5">
                        <div className="flex items-center gap-2">
                          <span title={channelLabel(r.channel)}>
                            <ChannelLogo channel={r.channel} className="h-6 w-9 text-[8px]" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{r.customerName}</p>
                            {(r.reconciled || r.imported) && (
                              <span className="bk-tag bk-fill-yellow" title={r.reconciled ? "Corrected after checking LMBTech" : "Added from LMBTech"}>
                                {r.reconciled ? "Corrected" : "Imported"}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 font-mono text-xs">{r.customerPhone ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right">{rwf(r.amountRwf)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right">{r.feeAmountRwf === null ? "—" : rwf(r.feeAmountRwf)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right font-bold">{rwf(netOf(r))}</td>
                      {admin && (
                        <>
                          <td className="whitespace-nowrap px-2 py-2.5 text-right">{r.gatewayCostAmountRwf ? `−${rwf(r.gatewayCostAmountRwf)}` : "—"}</td>
                          <td className={cn("whitespace-nowrap px-2 py-2.5 text-right font-semibold", (r.marginAmountRwf ?? 0) < 0 && "text-destructive")}>
                            {r.marginAmountRwf === null ? "—" : rwf(r.marginAmountRwf)}
                          </td>
                          <td className="max-w-[8rem] truncate px-2 py-2.5 text-xs">{r.integratorName ?? "Console"}</td>
                        </>
                      )}
                      <td className="px-2 py-2.5">
                        <StatusStamp status={r.status} />
                      </td>
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          onClick={() => setDetail(r)}
                          aria-label={`View ${r.referenceId}`}
                          className={cn("bk-btn min-h-8 px-2 py-0.5 text-[11px]", admin && r.method === "BANK" && r.status === "PENDING" ? "bk-fill-yellow" : "bk-fill-paper")}
                        >
                          <Eye className="h-3.5 w-3.5" /> {admin && r.method === "BANK" && r.status === "PENDING" ? "Settle" : "View"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-[var(--bk-ink)] px-4 py-3 text-xs font-semibold">
        <span>
          Showing {first} to {last} of {total} entries
        </span>
        <div className="flex items-center gap-2">
          <button type="button" className="bk-btn bk-fill-paper min-h-8 px-3 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Previous
          </button>
          <span className="bk-tag bk-fill-ink">
            {page} / {pages}
          </span>
          <button type="button" className="bk-btn bk-fill-paper min-h-8 px-3 text-xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      </footer>

      {detail && (
        <TransactionDetail
          payment={detail}
          admin={admin}
          onClose={() => setDetail(null)}
          onSettled={(p) => {
            setDetail(p);
            setInnerRefresh((k) => k + 1);
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}

function CopyText({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      aria-label="Copy"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1000);
        })
      }
      className="ml-1 inline-flex align-middle"
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** The "Action → View" panel: every detail of one transaction, and for
 * admins the Mark paid / Reject decision on a pending bank cash-out. */
function TransactionDetail({
  payment: p,
  admin,
  onClose,
  onSettled,
}: {
  payment: Payment;
  admin: boolean;
  onClose: () => void;
  onSettled: (p: Payment) => void;
}) {
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"pay" | "reject" | null>(null);
  const t = typeLabel(p);
  const settleable = admin && p.method === "BANK" && p.status === "PENDING";

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function settle(paid: boolean) {
    if (note.trim().length < 2) {
      toast({ title: paid ? "Enter the bank transfer reference" : "Enter a reason", variant: "error" });
      return;
    }
    setBusy(paid ? "pay" : "reject");
    try {
      onSettled(await paymentService.settleCashout(p.referenceId, paid, note.trim()));
      toast({ title: paid ? "Marked as paid" : "Cash-out rejected - money returned to their balance", variant: "success" });
    } catch (e) {
      toast({ title: "Not saved", description: paymentErrorMessage(e), variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  const rows: [string, React.ReactNode][] = [
    ["Reference", <span key="r" className="font-mono text-xs">{p.referenceId}<CopyText text={p.referenceId} /></span>],
    ["Type", <span key="t" className={cn("bk-tag", t.fill)}>{t.text}</span>],
    ["Status", <StatusStamp key="s" status={p.status} />],
    ["Method", channelLabel(p.channel)],
    [p.direction === "COLLECTION" ? "Paid by" : "Paid to", p.customerName],
    ["Phone", p.customerPhone ?? "—"],
    ["Email", p.customerEmail || "—"],
    ["Description", p.description],
    ["Amount", <b key="a">{rwf(p.amountRwf)}</b>],
    ["Fee", p.feeAmountRwf === null ? "—" : `${rwf(p.feeAmountRwf)}${p.feePercentage !== null ? ` (${p.feePercentage}%)` : ""}`],
    [p.direction === "COLLECTION" ? "Net to you" : "Taken from balance", <b key="n">{rwf(netOf(p))}</b>],
    ...(admin
      ? ([
          ["LMBTech cost", p.gatewayCostAmountRwf ? `−${rwf(p.gatewayCostAmountRwf)}` : "—"],
          ["Margin", p.marginAmountRwf === null ? "—" : rwf(p.marginAmountRwf)],
          ["LMBTech reported", p.gatewayAmountRwf === null ? "—" : rwf(p.gatewayAmountRwf)],
          ["Integrator", p.integratorName ?? "Console"],
        ] as [string, React.ReactNode][])
      : []),
    ["Transaction ID", p.gatewayTransactionId ? <span key="g" className="font-mono text-xs">{p.gatewayTransactionId}<CopyText text={p.gatewayTransactionId} /></span> : "—"],
    ["Created", formatDateTime(p.createdAt)],
    ["Completed", p.completedAt ? formatDateTime(p.completedAt) : "—"],
    ["Note", p.statusMessage ?? "—"],
    ["Mode", p.isTest ? "Test" : "Live"],
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Transaction details" onClick={onClose}>
      <div className="bk-card max-h-[92vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className={cn("sticky top-0 flex items-center justify-between gap-2 border-b-2 border-[var(--bk-ink)] px-4 py-3", t.fill)}>
          <h2 className="bk-display text-base font-bold uppercase">Transaction details</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="bk-btn bk-fill-paper min-h-8 px-2">
            <X className="h-4 w-4" />
          </button>
        </header>
        <dl className="divide-y divide-[var(--bk-ink)]/20 px-4 py-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-2">
              <dt className="bk-display shrink-0 text-xs font-bold uppercase">{k}</dt>
              <dd className="min-w-0 break-words text-right">{v}</dd>
            </div>
          ))}
        </dl>

        {settleable && (
          <div className="border-t-2 border-[var(--bk-ink)] bg-[var(--bk-yellow)]/30 p-4">
            <p className="bk-display text-sm font-bold uppercase">Settle this bank cash-out</p>
            <p className="mt-1 text-xs">
              Send {rwf(p.amountRwf)} to <b>{p.description.replace(/^Cash-out to /, "")}</b>, then mark it paid with the bank&apos;s transfer reference. Rejecting
              returns the money to their balance.
            </p>
            <label htmlFor="settle-note" className="mt-3 block text-[11px] font-bold uppercase">
              Bank reference (paid) or reason (reject)
            </label>
            <input id="settle-note" value={note} onChange={(e) => setNote(e.target.value)} className="bk-input mt-1 min-h-10 text-sm" placeholder="e.g. FT2611080001" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => settle(true)} disabled={!!busy} className="bk-btn bk-fill-green">
                {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Mark as paid
              </button>
              <button type="button" onClick={() => settle(false)} disabled={!!busy} className="bk-btn bk-fill-red">
                {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Reject
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
