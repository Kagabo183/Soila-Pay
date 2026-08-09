"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { integratorPortalService } from "@/services/integrator-portal.service";
import { useIntegratorPortalStore } from "@/store/integrator-portal-store";
import { collectionStatusLabel, collectionStatusTone } from "@/lib/collection-status";
import type { CollectionTransaction } from "@/types/api";

const PAGE_SIZE = 20;

function formatRwf(value: number): string {
  return new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(value) + " RWF";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-RW", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TransactionsPage() {
  const token = useIntegratorPortalStore((s) => s.token);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);
  const [transactions, setTransactions] = React.useState<CollectionTransaction[]>([]);
  const [total, setTotal] = React.useState(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function load(p: number) {
    if (!token) return;
    setLoading(true);
    try {
      const result = await integratorPortalService.listTransactions(token, p, PAGE_SIZE);
      setTransactions(result.items);
      setTotal(result.total);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Transaction History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All collections made with your sandbox key, newest first.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">Collections</CardTitle>
            <CardDescription>{total} total</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => load(page)} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16">
              <p className="text-sm text-muted-foreground">No transactions yet.</p>
              <p className="text-xs text-muted-foreground">
                Submit a collection from the Collections tab to see it here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Network</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">DDIN Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(tx.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {tx.customerName}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground">
                        {tx.customerAccountNumber}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {tx.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-foreground">
                        {formatRwf(tx.amountRwf)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={collectionStatusTone(tx.status)}>
                          {collectionStatusLabel(tx.status)}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {tx.providerTransactionReference ?? (
                          <span className="italic text-muted-foreground/50">pending</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages} &mdash; {total} transactions
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page <= 1}
                  onClick={() => load(page - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page >= totalPages}
                  onClick={() => load(page + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
