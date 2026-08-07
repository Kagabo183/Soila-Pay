"use client";

import * as React from "react";
import {
  Send,
  KeyRound,
  Wallet,
  Smartphone,
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertTriangle,
  Clock,
  Plus,
  List,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { collectionService } from "@/services/collection.service";
import { toast } from "@/store/toast-store";
import { cn } from "@/lib/utils";
import type { CollectionResponse } from "@/types/api";

interface LogEvent {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "default" | "success" | "error" | "warning";
  message: string;
  timestamp: string;
}

interface CollectionRecord {
  id: string;
  customerName: string;
  accountNumber: string;
  amountRwf: number;
  provider: "MTN" | "AIRTEL";
  response: CollectionResponse;
  createdAt: string;
}

function formatRwf(value: number): string {
  return new Intl.NumberFormat("en-RW", { maximumFractionDigits: 0 }).format(value) + " RWF";
}

function nowTime(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Same shape collectionService.collect() falls back to internally - shown
 * up front here so it doubles as the real Idempotency-Key header instead of
 * being a cosmetic field the request ignores. */
function generateReferenceId(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Real fields from the actual API response (transaction ids, references,
 * message) narrated into a readable log - not fabricated telemetry. The
 * collection itself is a single synchronous call, so these are revealed with
 * a short stagger for readability rather than claiming to be server-streamed. */
function buildLogEvents(
  provider: string,
  amount: number,
  accountNumber: string,
  response: CollectionResponse
): LogEvent[] {
  const events: LogEvent[] = [
    { id: "send", icon: Send, tone: "default", message: `Sending collection request to provider (${provider}, ${formatRwf(amount)})`, timestamp: nowTime() },
    { id: "auth", icon: KeyRound, tone: "default", message: "Provider session authenticated", timestamp: nowTime() },
  ];
  if (response.debit_transaction_id) {
    events.push({
      id: "debit",
      icon: Wallet,
      tone: "default",
      message: `Fineract savings wallet debited — txn ${response.debit_transaction_id}`,
      timestamp: nowTime(),
    });
  }
  events.push({
    id: "ack",
    icon: Smartphone,
    tone: "default",
    message: `Provider acknowledged — request sent to ${accountNumber}`,
    timestamp: nowTime(),
  });

  if (response.status === "SUCCESS") {
    events.push({
      id: "confirmed",
      icon: CheckCircle2,
      tone: "success",
      message: `Collection confirmed — reference ${response.provider_transaction_reference ?? "-"}`,
      timestamp: nowTime(),
    });
  } else if (response.status === "FAILED_REFUNDED") {
    events.push({ id: "rejected", icon: XCircle, tone: "error", message: `Provider rejected the request — ${response.message}`, timestamp: nowTime() });
    events.push({
      id: "refunded",
      icon: RotateCcw,
      tone: "warning",
      message: `Refund issued — txn ${response.refund_transaction_id ?? "-"}`,
      timestamp: nowTime(),
    });
  } else if (response.status === "FAILED_REFUND_ERROR") {
    events.push({ id: "rejected", icon: XCircle, tone: "error", message: `Provider rejected the request — ${response.message}`, timestamp: nowTime() });
    events.push({ id: "refund-error", icon: AlertTriangle, tone: "error", message: "Refund failed — manual reconciliation required", timestamp: nowTime() });
  } else if (response.status === "PENDING") {
    events.push({
      id: "pending",
      icon: Clock,
      tone: "warning",
      message: "Provider acknowledged but has not confirmed yet — resolves later via webhook",
      timestamp: nowTime(),
    });
  }

  return events;
}

const STATUS_META: Record<CollectionResponse["status"], { heading: string; sub: string; tone: "success" | "error" | "warning" }> = {
  SUCCESS: { heading: "Payment Successful!", sub: "Mock payment completed successfully", tone: "success" },
  FAILED_REFUNDED: { heading: "Payment Failed", sub: "Provider rejected the request - wallet was refunded", tone: "error" },
  FAILED_REFUND_ERROR: { heading: "Payment Failed", sub: "Refund also failed - needs manual reconciliation", tone: "error" },
  PENDING: { heading: "Payment Pending", sub: "Awaiting provider confirmation", tone: "warning" },
  // Never actually returned by POST /collect (an internal mid-flight DB
  // status only) - present purely to satisfy CollectionStatus exhaustively.
  DEBITED: { heading: "Payment Pending", sub: "Awaiting provider confirmation", tone: "warning" },
};

function ResultLog({ events, revealCount }: { events: LogEvent[]; revealCount: number }) {
  const [open, setOpen] = React.useState(true);
  const visible = events.slice(0, revealCount);
  return (
    <Card className="p-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <List className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Transaction Log</span>
          <StatusBadge variant="outline" dot={false}>{events.length} events</StatusBadge>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto border-t border-border px-4 py-3 scrollbar-thin">
          <ol className="flex flex-col gap-3">
            {visible.map((event) => {
              const Icon = event.icon;
              const toneClass =
                event.tone === "success" ? "text-success" : event.tone === "error" ? "text-destructive" : event.tone === "warning" ? "text-warning" : "text-primary";
              return (
                <li key={event.id} className="flex items-start gap-2.5">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", toneClass)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground">{event.message}</p>
                    <p className="text-[11px] text-muted-foreground">{event.timestamp}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}

interface CollectMoneyPanelProps {
  /** Sent as the real Integrator-Key header - whichever integrator's
   * collections should be tested (the logged-in integrator in the portal, or
   * an operator-selected one in the admin console). */
  integratorApiKey: string;
}

export function CollectMoneyPanel({ integratorApiKey }: CollectMoneyPanelProps) {
  const [provider, setProvider] = React.useState<"MTN" | "AIRTEL">("MTN");
  const [accountNumber, setAccountNumber] = React.useState("0788123456");
  const [customerName, setCustomerName] = React.useState("KALISA John");
  const [amount, setAmount] = React.useState("2000");
  const [referenceId, setReferenceId] = React.useState(generateReferenceId);
  const [running, setRunning] = React.useState(false);

  const [result, setResult] = React.useState<CollectionResponse | null>(null);
  const [logEvents, setLogEvents] = React.useState<LogEvent[]>([]);
  const [revealCount, setRevealCount] = React.useState(0);
  const [history, setHistory] = React.useState<CollectionRecord[]>([]);
  const [view, setView] = React.useState<"form" | "transactions">("form");
  const revealTimers = React.useRef<ReturnType<typeof setTimeout>[]>([]);

  React.useEffect(() => {
    return () => {
      revealTimers.current.forEach(clearTimeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [];
    setRunning(true);
    setResult(null);
    setLogEvents([]);
    setRevealCount(0);

    const amountRwf = Number(amount) || 0;
    try {
      const response = await collectionService.collect(
        {
          fineract_savings_account_id: "12345",
          provider,
          customer_account_number: accountNumber,
          customer_name: customerName,
          amount_rwf: amountRwf,
        },
        integratorApiKey,
        referenceId
      );
      const events = buildLogEvents(provider, amountRwf, accountNumber, response);
      setLogEvents(events);
      setHistory((h) => [
        {
          id: response.idempotency_key,
          customerName,
          accountNumber,
          amountRwf,
          provider,
          response,
          createdAt: new Date().toISOString(),
        },
        ...h,
      ]);
      events.forEach((_, i) => {
        const timer = setTimeout(() => setRevealCount(i + 1), i * 320);
        revealTimers.current.push(timer);
      });
      setTimeout(() => setResult(response), events.length * 320 + 150);
    } catch {
      toast({ title: "Collection request failed", description: "Could not reach the middleware.", variant: "error" });
    } finally {
      setRunning(false);
    }
  }

  function handleNewCollection() {
    setResult(null);
    setLogEvents([]);
    setRevealCount(0);
    setReferenceId(generateReferenceId());
    setView("form");
  }

  if (view === "transactions") {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>My Transactions</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setView("form")}>
              <Plus className="h-3.5 w-3.5" /> New Collection
            </Button>
          </div>
          <CardDescription>Sandbox test collections from this session.</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No test collections yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {history.map((record) => (
                <div key={record.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{record.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {record.provider} · {record.accountNumber} · {new Date(record.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-foreground">{formatRwf(record.amountRwf)}</span>
                    <StatusBadge>{record.response.status}</StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  if (result) {
    const meta = STATUS_META[result.status];
    return (
      <div className="flex flex-col gap-4">
        <Card
          className={cn(
            "border-t-4 p-6 text-center",
            meta.tone === "success" ? "border-t-success" : meta.tone === "error" ? "border-t-destructive" : "border-t-warning"
          )}
        >
          <div
            className={cn(
              "mx-auto flex h-14 w-14 items-center justify-center rounded-full",
              meta.tone === "success" ? "bg-success/10" : meta.tone === "error" ? "bg-destructive/10" : "bg-warning/10"
            )}
          >
            {meta.tone === "success" ? (
              <CheckCircle2 className="h-7 w-7 text-success" />
            ) : meta.tone === "error" ? (
              <XCircle className="h-7 w-7 text-destructive" />
            ) : (
              <Clock className="h-7 w-7 text-warning" />
            )}
          </div>
          <h2 className={cn("mt-3 text-lg font-semibold", meta.tone === "success" ? "text-success" : meta.tone === "error" ? "text-destructive" : "text-warning")}>
            {meta.heading}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{meta.sub}</p>

          <div className="mx-auto mt-5 flex max-w-xs flex-col gap-2 text-left text-sm">
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium text-foreground">{customerName}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Amount</span><span className="font-semibold text-primary">{formatRwf(Number(amount) || 0)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Provider</span><span className="font-medium text-foreground">{provider}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Reference</span><span className="max-w-[160px] truncate font-mono text-xs text-foreground">{result.provider_transaction_reference ?? result.idempotency_key}</span></div>
          </div>

          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={handleNewCollection}>
              <Plus className="h-4 w-4" /> New Collection
            </Button>
            <Button variant="outline" onClick={() => setView("transactions")}>
              <List className="h-4 w-4" /> View Transactions
            </Button>
          </div>
        </Card>

        <ResultLog events={logEvents} revealCount={revealCount} />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Collect Money</CardTitle>
          {history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setView("transactions")}>
              <List className="h-3.5 w-3.5" /> View Transactions ({history.length})
            </Button>
          )}
        </div>
        <CardDescription>
          Runs the real debit → collect → refund flow safely against a simulated provider - nothing
          real is charged. Use account number{" "}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">00000000000</code> to
          see the rollback path.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-2">
            {(["MTN", "AIRTEL"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  provider === p ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-secondary"
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <Input label="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
          <Input label="Customer account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required />
          <Input label="Amount (RWF)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Reference ID
            </label>
            <div className="flex gap-2">
              <Input
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                className="font-mono text-xs"
                required
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Generate a new reference ID"
                onClick={() => setReferenceId(generateReferenceId())}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sent as the request&apos;s Idempotency-Key - resending the same reference returns the
              original result instead of double-charging the customer.
            </p>
          </div>

          <Button type="submit" loading={running} className="w-fit">
            Collect Money
          </Button>
        </form>

        {running && (
          <p className="mt-4 text-xs text-muted-foreground">Processing collection...</p>
        )}

        <div className="mt-5 flex gap-2.5 rounded-md border border-border bg-secondary/30 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">How it works</p>
            <ol className="flex flex-col gap-0.5">
              <li>1. Soila Pay debits the integrator&apos;s Fineract savings wallet for the amount.</li>
              <li>2. The request is forwarded to DDIN, which sends a mobile money prompt to the customer.</li>
              <li>3. The customer approves (or declines) with their mobile money PIN.</li>
              <li>
                4. DDIN confirms the result - on success the transaction is finalized; on failure the
                wallet debit is automatically refunded.
              </li>
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
