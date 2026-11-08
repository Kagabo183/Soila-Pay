"use client";

import * as React from "react";
import { Check, ChevronDown, Copy, Loader2, Play, PlayCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";
import { toast } from "@/store/toast-store";
import { paymentLab, type PaymentScope, type RawCall } from "@/services/payment.service";
import { ChannelLogo, channelFill } from "./payment-logos";
import { BkPanel, StatusStamp, type BkStatus } from "./brutal";

export const TEST_PHONE = "0780000000";

interface Scenario {
  id: string;
  title: string;
  what: string;
  channel: string;
  /** "pay" = should create a payment; "reject" = Soila Pay must refuse it. */
  expect: "pay" | "reject";
  body: Record<string, unknown>;
}

const customer = { customer_name: "Test Customer", customer_email: "customer@example.com" };

const PAY_SCENARIOS: Scenario[] = [
  {
    id: "visa",
    title: "Visa",
    what: "Card payment via the secure page",
    channel: "VISA",
    expect: "pay",
    body: { channel: "VISA", amount_rwf: 100, ...customer, description: "Lab: Visa" },
  },
  {
    id: "mastercard",
    title: "Mastercard",
    what: "Card payment via the secure page",
    channel: "MASTERCARD",
    expect: "pay",
    body: { channel: "MASTERCARD", amount_rwf: 100, ...customer, description: "Lab: Mastercard" },
  },
  {
    id: "other",
    title: "Other card",
    what: "Any other card brand",
    channel: "OTHER_CARD",
    expect: "pay",
    body: { channel: "OTHER_CARD", amount_rwf: 100, ...customer, description: "Lab: Other card" },
  },
  {
    id: "momo",
    title: "MTN MoMo",
    what: "Prompt to the MTN test number",
    channel: "MTN_MOMO",
    expect: "pay",
    body: { channel: "MTN_MOMO", amount_rwf: 100, ...customer, customer_phone: TEST_PHONE, description: "Lab: MTN MoMo" },
  },
];

const GUARD_SCENARIOS: Scenario[] = [
  {
    id: "wrong-network",
    title: "Airtel number on MTN",
    what: "0721… must be refused before charging",
    channel: "MTN_MOMO",
    expect: "reject",
    body: { channel: "MTN_MOMO", amount_rwf: 100, ...customer, customer_phone: "0721234567" },
  },
  {
    id: "no-phone",
    title: "MoMo without phone",
    what: "Phone is required for MoMo",
    channel: "MTN_MOMO",
    expect: "reject",
    body: { channel: "MTN_MOMO", amount_rwf: 100, ...customer },
  },
  {
    id: "too-small",
    title: "Amount below 100 RWF",
    what: "Minimum amount check",
    channel: "VISA",
    expect: "reject",
    body: { channel: "VISA", amount_rwf: 50, ...customer },
  },
  {
    id: "bad-email",
    title: "Broken email",
    what: "Email format check",
    channel: "MASTERCARD",
    expect: "reject",
    body: { channel: "MASTERCARD", amount_rwf: 100, customer_name: "Test Customer", customer_email: "not-an-email" },
  },
];

interface RunResult {
  call: RawCall;
  passed: boolean;
  summary: string;
  at: string;
}

function summarize(s: Scenario, call: RawCall): { passed: boolean; summary: string } {
  if (s.expect === "reject") {
    const refused = !call.ok && (call.httpStatus === 422 || call.httpStatus === 400);
    const detail = call.body?.detail;
    const msg = Array.isArray(detail) ? String(detail[0]?.msg ?? "").replace(/^Value error, /, "") : String(detail ?? "");
    return { passed: refused, summary: refused ? `Refused: ${msg}` : `Expected a refusal, got HTTP ${call.httpStatus}` };
  }
  if (!call.ok) {
    const d = call.body?.detail;
    return { passed: false, summary: typeof d === "string" ? d : `HTTP ${call.httpStatus ?? "no response"}` };
  }
  const status = call.body?.status as BkStatus;
  if (status === "SUCCESS") return { passed: true, summary: `Paid · ${call.body.gateway_transaction_id ?? call.body.reference_id}` };
  if (status === "PENDING")
    return {
      passed: true,
      summary: call.body.redirect_url ? "Waiting · customer must finish on the card page" : "Waiting · customer must approve on phone",
    };
  return { passed: false, summary: call.body?.status_message || "Gateway declined" };
}

function curlFor(body: Record<string, unknown>, apiBase: string, integratorKey?: string) {
  return [
    `curl -X POST ${apiBase.replace(/\/$/, "")}/api/v1/payments \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Integrator-Key: ${integratorKey ?? "YOUR_INTEGRATOR_KEY"}" \\`,
    `  -d '${JSON.stringify(body)}'`,
  ].join("\n");
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        })
      }
      className="bk-btn bk-fill-paper min-h-7 px-2 py-0.5 text-[10px]"
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {done ? "Copied" : "Copy"}
    </button>
  );
}

function ScenarioRow({
  s,
  result,
  running,
  onRun,
  apiBase,
  integratorKey,
}: {
  s: Scenario;
  result?: RunResult;
  running: boolean;
  onRun: () => void;
  apiBase: string;
  integratorKey?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const curl = curlFor(s.body, apiBase, integratorKey);
  return (
    <li className="bk-box bk-fill-paper">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <ChannelLogo channel={s.channel} />
        <div className="min-w-0 flex-1">
          <p className="bk-display font-bold">{s.title}</p>
          <p className="bk-muted text-xs">{s.what}</p>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <span className="bk-tag bk-fill-yellow">
              <Loader2 className="h-3 w-3 animate-spin" /> Running
            </span>
          ) : result ? (
            <span className={cn("bk-tag", result.passed ? "bk-fill-green" : "bk-fill-red")}>
              {result.passed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {result.passed ? "Pass" : "Fail"}
            </span>
          ) : (
            <span className="bk-tag bk-fill-paper">Not run</span>
          )}
          <button type="button" onClick={onRun} disabled={running} className={cn("bk-btn min-h-9 px-3 text-xs", channelFill(s.channel))}>
            <Play className="h-3.5 w-3.5" /> Run
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={`Show request and response for ${s.title}`}
            className="bk-btn bk-fill-paper min-h-9 px-2"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {result && (
        <p className="border-t-2 border-[var(--bk-ink)] px-3 py-2 text-xs font-semibold">
          {result.summary} <span className="bk-muted font-normal">· HTTP {result.call.httpStatus ?? "-"} · {result.call.ms} ms · {result.at}</span>
        </p>
      )}

      {open && (
        <div className="grid gap-3 border-t-2 border-[var(--bk-ink)] p-3 lg:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="bk-display text-xs font-bold uppercase">Request (cURL)</span>
              <CopyBtn text={curl} />
            </div>
            <pre className="bk-code max-h-64">{curl}</pre>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="bk-display text-xs font-bold uppercase">Response</span>
              {result && <CopyBtn text={JSON.stringify(result.call.body, null, 2)} />}
            </div>
            <pre className="bk-code max-h-64">{result ? JSON.stringify(result.call.body, null, 2) : "// Press RUN to see the real response"}</pre>
          </div>
        </div>
      )}
    </li>
  );
}

export function TestLab({
  scope,
  integratorKey,
  testMode,
  onRan,
}: {
  scope: PaymentScope;
  /** Shown in the copy-paste cURL (portal: the integrator's sandbox key). */
  integratorKey?: string;
  testMode: boolean;
  onRan?: () => void;
}) {
  const apiBase = useSettingsStore((s) => s.baseUrl) || "http://localhost:8000";
  const [results, setResults] = React.useState<Record<string, RunResult>>({});
  const [running, setRunning] = React.useState<Set<string>>(new Set());
  const [busyAll, setBusyAll] = React.useState(false);
  const [ref, setRef] = React.useState("");
  const [lookup, setLookup] = React.useState<RawCall | null>(null);
  const [looking, setLooking] = React.useState(false);

  const all = [...PAY_SCENARIOS, ...GUARD_SCENARIOS];
  const ran = all.filter((s) => results[s.id]);
  const passed = ran.filter((s) => results[s.id].passed).length;

  const run = React.useCallback(
    async (s: Scenario) => {
      setRunning((r) => new Set(r).add(s.id));
      const call = await paymentLab.create(scope, s.body);
      const { passed, summary } = summarize(s, call);
      setResults((r) => ({ ...r, [s.id]: { call, passed, summary, at: new Date().toLocaleTimeString() } }));
      setRunning((r) => {
        const next = new Set(r);
        next.delete(s.id);
        return next;
      });
      if (s.expect === "pay" && call.ok) {
        setRef(call.body.reference_id);
        onRan?.();
      }
    },
    [scope, onRan]
  );

  async function runAll() {
    setBusyAll(true);
    for (const s of all) await run(s);
    setBusyAll(false);
    toast({ title: "Test run finished", description: "Scroll down to see each result.", variant: "success" });
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!ref.trim()) return;
    setLooking(true);
    setLookup(await paymentLab.get(scope, ref.trim()));
    setLooking(false);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Test data + run all */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <BkPanel
          title="Run every payment method"
          tone="bk-fill-blue"
          action={
            <button type="button" onClick={runAll} disabled={busyAll} className="bk-btn bk-fill-ink min-h-9 px-3 text-xs">
              {busyAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Run all ({all.length})
            </button>
          }
        >
          <p className="text-sm">
            Each button sends a real request to Soila Pay, exactly as an integrator would.
            {ran.length > 0 && (
              <b className={cn("ml-1", passed === ran.length ? "text-[var(--bk-ink)]" : "")}>
                {" "}
                Score: {passed}/{ran.length} passed.
              </b>
            )}
          </p>
          <h3 className="bk-display mt-5 text-sm font-bold uppercase">✅ Should get paid</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {PAY_SCENARIOS.map((s) => (
              <ScenarioRow key={s.id} s={s} result={results[s.id]} running={running.has(s.id)} onRun={() => run(s)} apiBase={apiBase} integratorKey={integratorKey} />
            ))}
          </ul>
          <h3 className="bk-display mt-6 text-sm font-bold uppercase">🛑 Should be refused (safety checks)</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {GUARD_SCENARIOS.map((s) => (
              <ScenarioRow key={s.id} s={s} result={results[s.id]} running={running.has(s.id)} onRun={() => run(s)} apiBase={apiBase} integratorKey={integratorKey} />
            ))}
          </ul>
        </BkPanel>

        <div className="flex flex-col gap-6">
          <BkPanel title="Test data" tone="bk-fill-pink">
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="bk-display text-xs font-bold uppercase">MTN test number</dt>
                <dd className="mt-1 flex items-center gap-2 font-mono text-base font-bold">
                  {TEST_PHONE} <CopyBtn text={TEST_PHONE} />
                </dd>
              </div>
              <div>
                <dt className="bk-display text-xs font-bold uppercase">Amounts</dt>
                <dd>Use small amounts: 100 – 200 RWF.</dd>
              </div>
              <div>
                <dt className="bk-display text-xs font-bold uppercase">Cards</dt>
                <dd>Visa, Mastercard and other cards all open the same secure card page.</dd>
              </div>
              <div>
                <dt className="bk-display text-xs font-bold uppercase">What to expect</dt>
                <dd>
                  {testMode ? (
                    <>
                      Your gateway account is in <b>Test Mode</b>: every payment is approved instantly, no phone prompt or card page. Switch to Production
                      with LMBTech to get real prompts.
                    </>
                  ) : (
                    <>Live mode: MoMo sends a real phone prompt and cards open the real card page. Real money moves.</>
                  )}
                </dd>
              </div>
            </dl>
          </BkPanel>

          <BkPanel title="Check a reference" tone="bk-fill-green">
            <form onSubmit={check} className="flex gap-2">
              <label htmlFor="lab-ref" className="sr-only">
                Payment reference
              </label>
              <input id="lab-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="SP-20261108-…" className="bk-input font-mono text-sm" />
              <button type="submit" disabled={looking || !ref.trim()} className="bk-btn bk-fill-ink px-3" aria-label="Check status">
                {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </button>
            </form>
            <p className="bk-muted mt-2 text-xs">Asks the gateway for the latest status. The last run fills this in for you.</p>
            {lookup && (
              <div className="mt-3">
                <div className="mb-2 flex items-center gap-2">
                  {lookup.ok ? <StatusStamp status={lookup.body.status} /> : <span className="bk-tag bk-fill-red">HTTP {lookup.httpStatus ?? "-"}</span>}
                  <span className="bk-muted text-xs">{lookup.ms} ms</span>
                </div>
                <pre className="bk-code max-h-72">{JSON.stringify(lookup.body, null, 2)}</pre>
              </div>
            )}
          </BkPanel>
        </div>
      </div>
    </div>
  );
}
