"use client";

import * as React from "react";
import { Wallet, RefreshCw, ArrowDownToLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { toast } from "@/store/toast-store";
import { fineractAdminService } from "@/services/fineract-admin.service";

function formatRwf(amount: number) {
  return new Intl.NumberFormat("en-RW", { style: "currency", currency: "RWF", maximumFractionDigits: 0 }).format(amount);
}

export default function FineractFloatPage() {
  const [accountId, setAccountId] = React.useState("1");
  const [balance, setBalance] = React.useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = React.useState(false);

  const [amount, setAmount] = React.useState("");
  const [depositing, setDepositing] = React.useState(false);
  const [lastTx, setLastTx] = React.useState<string | null>(null);

  const fetchBalance = React.useCallback(async (id: string) => {
    if (!id.trim()) return;
    setBalanceLoading(true);
    setBalance(null);
    try {
      const result = await fineractAdminService.getBalance(id.trim());
      setBalance(result.balance_rwf);
    } catch {
      toast({ title: "Failed to fetch balance", variant: "error" });
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchBalance(accountId);
  }, []);

  async function handleDeposit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) {
      toast({ title: "Enter a valid amount", variant: "error" });
      return;
    }
    setDepositing(true);
    try {
      const result = await fineractAdminService.topup(accountId.trim(), parsed);
      setLastTx(result.transaction_id);
      toast({ title: `Deposited ${formatRwf(parsed)} — TX: ${result.transaction_id}`, variant: "default" });
      setAmount("");
      await fetchBalance(accountId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Deposit failed";
      toast({ title: msg, variant: "error" });
    } finally {
      setDepositing(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Breadcrumb items={[{ label: "Console" }, { label: "Fineract Float" }]} />
        <h1 className="mt-1 text-xl font-semibold text-foreground">Fineract Float Account</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Top up the Fineract savings account used as the collection float. Every
          collection debits this account first — it must hold sufficient RWF balance
          before any collection can go through to DDIN.
        </p>
      </div>

      {/* Account selector */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            The Fineract savings account ID linked to your collections. Default is{" "}
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">1</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Account ID</label>
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-9 w-36 rounded-md border border-input bg-card px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <button
              onClick={() => fetchBalance(accountId)}
              disabled={balanceLoading}
              className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${balanceLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3">
            <Wallet className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Current Balance</p>
              <p className="text-lg font-semibold text-foreground">
                {balanceLoading
                  ? "Loading…"
                  : balance !== null
                  ? formatRwf(balance)
                  : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top-up form */}
      <Card>
        <CardHeader>
          <CardTitle>Top Up Float</CardTitle>
          <CardDescription>
            Deposit RWF into the float account so collections can proceed. In sandbox
            testing, you can deposit any amount — use a large value like 500,000 RWF to
            avoid running out during tests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDeposit} className="flex flex-col gap-4">
            <div className="flex items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Amount (RWF)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 500000"
                  className="h-9 w-44 rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <button
                type="submit"
                disabled={depositing || !amount}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                {depositing ? "Depositing…" : "Deposit"}
              </button>
            </div>

            {/* Quick-fill buttons */}
            <div className="flex flex-wrap gap-2">
              {[100000, 500000, 1000000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(String(v))}
                  className="rounded-md border border-border bg-secondary px-3 py-1 text-xs font-medium text-foreground hover:bg-secondary/80"
                >
                  {formatRwf(v)}
                </button>
              ))}
            </div>

            {lastTx && (
              <p className="text-xs text-muted-foreground">
                Last transaction ID:{" "}
                <span className="font-mono text-foreground">{lastTx}</span>
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
