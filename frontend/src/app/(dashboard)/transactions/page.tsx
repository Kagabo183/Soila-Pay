"use client";

import * as React from "react";
import { Banknote, Percent, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { Button } from "@/components/ui/button";
import { collectionService } from "@/services/collection.service";
import type { AdminTransactionTotals, CollectionTransaction } from "@/types/api";

const PAGE_SIZE = 20;

const STATUS_FILTERS = [
  { label: "All", value: "" },
  { label: "Success", value: "SUCCESS" },
  { label: "Pending", value: "PENDING" },
  { label: "Debited", value: "DEBITED" },
  { label: "Refunded", value: "FAILED_REFUNDED" },
  { label: "Refund error", value: "FAILED_REFUND_ERROR" },
  { label: "Debit failed", value: "DEBIT_FAILED" },
];

const PROVIDER_FILTERS = [
  { label: "All networks", value: "" },
  { label: "MTN", value: "MTN" },
  { label: "Airtel", value: "AIRTEL" },
];

/** Money is shown to 2dp here, unlike the dashboard's rounded figures: fees and
 *  margins are frequently under 1 RWF (a 2.2% fee on a 100 RWF collection is
 *  2.20, its margin 0.20), so rounding to whole RWF would render most of this
 *  table as "0" and make it useless for reconciliation. */
function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-RW", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(2)}%`;
}

export default function TransactionsPage() {
  const [rows, setRows] = React.useState<CollectionTransaction[]>([]);
  const [totals, setTotals] = React.useState<AdminTransactionTotals | null>(null);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState("");
  const [provider, setProvider] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await collectionService.listWithTotals({
        page,
        pageSize: PAGE_SIZE,
        status: status ? [status] : [],
        channel: provider ? [provider] : [],
      });
      setRows(res.items);
      setTotal(res.total);
      setTotals(res.totals);
    } catch {
      setError("Could not load transactions. Please try again.");
      setRows([]);
      setTotals(null);
    } finally {
      setLoading(false);
    }
  }, [page, status, provider]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Changing a filter must reset to page 1 -- otherwise filtering while on
  // page 4 can land on an empty page and look like "no transactions".
  const onFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const columns: Column<CollectionTransaction>[] = [
    {
      key: "created_at",
      header: "Date",
      render: (r) => (
        <span className="whitespace-nowrap text-xs">
          {new Date(r.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "integrator",
      header: "Integrator",
      render: (r) => (
        <span className="text-xs">{r.integratorName ?? <span className="text-muted-foreground">—</span>}</span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{r.customerName}</div>
          <div className="truncate text-[11px] text-muted-foreground">{r.customerAccountNumber}</div>
        </div>
      ),
    },
    { key: "provider", header: "Network", render: (r) => <span className="text-xs">{r.provider}</span> },
    {
      key: "amount_rwf",
      header: "Amount",
      align: "right",
      render: (r) => <span className="whitespace-nowrap text-xs font-semibold">{money(r.amountRwf)}</span>,
    },
    {
      key: "fee",
      header: "Fee charged",
      align: "right",
      render: (r) => (
        <div className="whitespace-nowrap">
          <div className="text-xs">{money(r.feeAmountRwf)}</div>
          <div className="text-[11px] text-muted-foreground">{percent(r.integratorFeePercentage)}</div>
        </div>
      ),
    },
    {
      key: "ddin_cost",
      header: "DDIN cost",
      align: "right",
      render: (r) => (
        <div className="whitespace-nowrap">
          <div className="text-xs">{money(r.ddinCostAmountRwf)}</div>
          <div className="text-[11px] text-muted-foreground">{percent(r.ddinCostPercentage)}</div>
        </div>
      ),
    },
    {
      key: "margin",
      header: "Margin",
      align: "right",
      render: (r) => (
        <span
          className={
            "whitespace-nowrap text-xs font-semibold " +
            (r.marginAmountRwf === null || r.marginAmountRwf === undefined
              ? "text-muted-foreground"
              : "text-emerald-600")
          }
        >
          {money(r.marginAmountRwf)}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge>{r.status}</StatusBadge> },
    {
      key: "reference",
      header: "Reference",
      render: (r) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {r.providerTransactionReference ?? r.idempotencyKey.slice(0, 12)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "Transactions" }]} />
        <h1 className="mt-1 text-xl font-semibold">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Every collection across all integrators, with what was charged, what DDIN cost, and what Soila Pay kept.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Collected" value={money(totals?.collectedRwf ?? 0) + " RWF"} icon={Banknote} accent="primary" />
        <StatCard label="Fees charged" value={money(totals?.feesRwf ?? 0) + " RWF"} icon={Percent} accent="warning" />
        <StatCard label="DDIN cost" value={money(totals?.ddinCostRwf ?? 0) + " RWF"} icon={Wallet} accent="destructive" />
        <StatCard label="Margin kept" value={money(totals?.marginRwf ?? 0) + " RWF"} icon={TrendingUp} accent="success" />
      </div>

      {totals && (
        <p className="text-xs text-muted-foreground">
          Totals cover all {totals.countedRows} transaction{totals.countedRows === 1 ? "" : "s"} matching the current
          filter (not just this page), counting the {totals.successCount} successful one
          {totals.successCount === 1 ? "" : "s"} — refunded collections earned no margin.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All collections</CardTitle>
          <CardDescription>Newest first.</CardDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.value || "all"}
                size="sm"
                variant={status === f.value ? "default" : "outline"}
                onClick={() => onFilter(setStatus)(f.value)}
              >
                {f.label}
              </Button>
            ))}
            <span className="mx-1 w-px bg-border" aria-hidden />
            {PROVIDER_FILTERS.map((f) => (
              <Button
                key={f.value || "all-networks"}
                size="sm"
                variant={provider === f.value ? "default" : "outline"}
                onClick={() => onFilter(setProvider)(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="py-8 text-center text-sm text-destructive">
              {error}
              <div className="mt-3">
                <Button size="sm" variant="outline" onClick={load}>
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <>
              <DataTable
                columns={columns}
                data={rows}
                loading={loading}
                rowKey={(r) => r.id}
                emptyMessage="No transactions match this filter."
              />
              <div className="mt-3">
                <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
