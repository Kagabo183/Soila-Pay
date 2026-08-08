"use client";

import * as React from "react";
import {
  Wallet,
  Send,
  CheckCircle2,
  XCircle,
  Timer,
  Smartphone,
  Landmark,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCardSkeleton, Skeleton } from "@/components/ui/loading-skeleton";
import { TrendAreaChart, DistributionPieChart } from "@/components/ui/charts";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { collectionService } from "@/services/collection.service";
import { disbursementService } from "@/services/disbursement.service";
import { providerService } from "@/services/provider.service";
import { formatCurrency, formatNumber, formatDateTime, truncateMiddle } from "@/lib/utils";
import { collectionStatusLabel, collectionStatusTone } from "@/lib/collection-status";
import type { CollectionTransaction, Provider } from "@/types/api";

const PROVIDER_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  mtn: Smartphone,
  airtel: Smartphone,
  banks: Landmark,
};

export default function DashboardPage() {
  const [loading, setLoading] = React.useState(true);
  const [providers, setProviders] = React.useState<Provider[]>([]);
  const [series, setSeries] = React.useState<
    { date: string; collections: number; disbursements: number; failed: number }[]
  >([]);
  const [collectionSummary, setCollectionSummary] = React.useState({
    count: 0,
    totalAmount: 0,
    successRate: 0,
  });
  const [disbursementSummary, setDisbursementSummary] = React.useState({ count: 0, totalAmount: 0 });

  const [tableLoading, setTableLoading] = React.useState(true);
  const [rows, setRows] = React.useState<CollectionTransaction[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState("");
  const pageSize = 8;

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      const [p, s, collectionSummary, disbursementSummary] = await Promise.all([
        providerService.list(),
        providerService.dailyVolumeSeries(14),
        collectionService.summaryToday(),
        disbursementService.summaryToday(),
      ]);
      if (!mounted) return;
      setProviders(p);
      setSeries(s);
      setCollectionSummary(collectionSummary);
      setDisbursementSummary(disbursementSummary);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      setTableLoading(true);
      const result = await collectionService.list({ page, pageSize });
      if (!mounted) return;
      const filtered = search
        ? result.items.filter(
            (c) =>
              c.customerAccountNumber.includes(search) ||
              c.idempotencyKey.toLowerCase().includes(search.toLowerCase()) ||
              c.provider.toLowerCase().includes(search.toLowerCase())
          )
        : result.items;
      setRows(filtered);
      setTotal(result.total);
      setTableLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [page, search]);

  const columns: Column<CollectionTransaction>[] = [
    {
      key: "idempotencyKey",
      header: "Idempotency Key",
      render: (row) => <span className="font-mono text-xs">{truncateMiddle(row.idempotencyKey, 10)}</span>,
    },
    { key: "provider", header: "Provider" },
    {
      key: "customerName",
      header: "Customer",
      render: (row) => <span className="text-foreground">{row.customerName}</span>,
    },
    {
      key: "amountRwf",
      header: "Amount",
      align: "right",
      render: (row) => formatCurrency(row.amountRwf),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge variant={collectionStatusTone(row.status)}>
          {collectionStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row) => <span className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</span>,
    },
  ];

  const failedRate = 100 - collectionSummary.successRate;
  const avgProcessingMs = providers.length
    ? Math.round(providers.reduce((s, p) => s + p.avgResponseMs, 0) / providers.length)
    : 0;

  const channelDistribution = [
    { name: "MTN", value: providers.find((p) => p.id === "mtn")?.collectionsToday ?? 0 },
    { name: "Airtel", value: providers.find((p) => p.id === "airtel")?.collectionsToday ?? 0 },
    { name: "Banks", value: providers.find((p) => p.id === "banks")?.collectionsToday ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "Provider Dashboard" }]} />
        <h1 className="mt-1 text-xl font-semibold text-foreground">Provider Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Real-time view of collections, disbursements and mobile money / bank provider health.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              label="Collections Today"
              value={formatCurrency(collectionSummary.totalAmount)}
              change={4.2}
              changeLabel="vs yesterday"
              icon={Wallet}
              accent="primary"
            />
            <StatCard
              label="Disbursements Today"
              value={formatCurrency(disbursementSummary.totalAmount)}
              change={-1.8}
              changeLabel="vs yesterday"
              icon={Send}
              accent="primary"
            />
            <StatCard
              label="Success Rate"
              value={`${collectionSummary.successRate}%`}
              change={0.6}
              changeLabel="7-day trend"
              icon={CheckCircle2}
              accent="success"
            />
            <StatCard
              label="Failed Rate"
              value={`${failedRate.toFixed(1)}%`}
              change={-0.3}
              changeLabel="7-day trend"
              icon={XCircle}
              accent="destructive"
            />
            <StatCard
              label="Avg Processing Time"
              value={`${avgProcessingMs}ms`}
              change={-5.1}
              changeLabel="vs last week"
              icon={Timer}
              accent="warning"
            />
          </>
        )}
      </div>

      {/* Provider cards */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Provider Health</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-4 h-8 w-16" />
                </Card>
              ))
            : providers.map((provider) => {
                const Icon = PROVIDER_ICON[provider.id] ?? Smartphone;
                return (
                  <Card key={provider.id} className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">{provider.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {provider.type === "MOBILE_MONEY" ? "Mobile Money" : "Bank Rail"}
                          </p>
                        </div>
                      </div>
                      <StatusBadge variant={provider.health === "HEALTHY" ? "success" : provider.health === "DEGRADED" ? "warning" : "destructive"}>
                        {provider.health}
                      </StatusBadge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">Success rate</p>
                        <p className="text-sm font-semibold text-foreground">{provider.successRate}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Avg response</p>
                        <p className="text-sm font-semibold text-foreground">{provider.avgResponseMs}ms</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Collections today</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatNumber(provider.collectionsToday)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Disbursements today</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatNumber(provider.disbursementsToday)}
                        </p>
                      </div>
                    </div>
                  </Card>
                );
              })}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Collections vs Disbursements (14 days)</CardTitle>
            <CardDescription>Daily transaction volume across all providers</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <TrendAreaChart
                data={series}
                xKey="date"
                series={[
                  { key: "collections", label: "Collections", color: "#4f46e5" },
                  { key: "disbursements", label: "Disbursements", color: "#16a34a" },
                  { key: "failed", label: "Failed", color: "#dc2626" },
                ]}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Collections by Channel</CardTitle>
            <CardDescription>Today&apos;s volume split</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <DistributionPieChart data={channelDistribution} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent collections */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Recent Collections</CardTitle>
            <CardDescription>Latest collection transactions across all channels</CardDescription>
          </div>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search phone number, provider, key..."
            className="w-64"
          />
        </CardHeader>
        <CardContent className="p-0">
          <div className="px-5 pt-4">
            <DataTable
              columns={columns}
              data={rows}
              loading={tableLoading}
              rowKey={(row) => row.id}
              emptyMessage="No collection transactions match your search."
            />
          </div>
          <div className="px-5">
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
