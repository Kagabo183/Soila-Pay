"use client";

import * as React from "react";
import { Check, ChevronDown, Copy, Loader2, Play, PlayCircle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings-store";
import { toast } from "@/store/toast-store";
import { paymentLab, type PaymentScope, type RawCall } from "@/services/payment.service";
import { ChannelLogo, channelFill } from "./payment-logos";
import { BkPanel, StatusStamp } from "./brutal";

/** Test numbers and cards understood by Soila Pay's simulator (app/services/sandbox.py). */
export const TEST_PHONE = "0788123456";
const TEST_AIRTEL = "0731234567";
const DECLINE_PHONE = "0780000002";
const NO_FUNDS_PHONE = "0780000003";
const GOOD_CARD = "4242424242424242";
const GOOD_MASTERCARD = "5555555555554444";
const DECLINE_CARD = "4000000000000002";

type Final = "SUCCESS" | "FAILED";

interface Scenario {
  id: string;
  title: string;
  what: string;
  channel: string;
  /** momo: wait for the (simulated) phone; card: fill the (simulated) card page; block: Soila Pay must refuse it. */
  kind: "momo" | "card" | "block";
  /** The end result that counts as a pass. */
  want?: Final;
  card?: string;
  body: Record<string, unknown>;
}

const customer = { customer_name: "Test Customer", customer_email: "customer@example.com" };

const GO_THROUGH: Scenario[] = [
  {
    id: "visa",
    title: "Visa card",
    what: "Customer pays with a Visa card",
    channel: "VISA",
    kind: "card",
    want: "SUCCESS",
    card: GOOD_CARD,
    body: { channel: "VISA", amount_rwf: 100, ...customer, description: "Lab Visa" },
  },
  {
    id: "mastercard",
    title: "Mastercard",
    what: "Customer pays with a Mastercard",
    channel: "MASTERCARD",
    kind: "card",
    want: "SUCCESS",
    card: GOOD_MASTERCARD,
    body: { channel: "MASTERCARD", amount_rwf: 100, ...customer, description: "Lab Mastercard" },
  },
  {
    id: "mtn",
    title: "MTN MoMo",
    what: "Customer approves on their MTN phone",
    channel: "MTN_MOMO",
    kind: "momo",
    want: "SUCCESS",
    body: { channel: "MTN_MOMO", amount_rwf: 100, ...customer, customer_phone: TEST_PHONE, description: "Lab MTN MoMo" },
  },
  {
    id: "airtel",
    title: "Airtel Money",
    what: "Customer approves on their Airtel phone",
    channel: "AIRTEL_MONEY",
    kind: "momo",
    want: "SUCCESS",
    body: { channel: "AIRTEL_MONEY", amount_rwf: 100, ...customer, customer_phone: TEST_AIRTEL, description: "Lab Airtel Money" },
  },
];

const FAIL_PROPERLY: Scenario[] = [
  {
    id: "card-declined",
    title: "Card declined by the bank",
    what: "Must end as Failed - nothing counted as paid",
    channel: "VISA",
    kind: "card",
    want: "FAILED",
    card: DECLINE_CARD,
    body: { channel: "VISA", amount_rwf: 100, ...customer, description: "Lab declined card" },
  },
  {
    id: "mtn-declined",
    title: "Customer says no on the phone",
    what: "Must end as Failed",
    channel: "MTN_MOMO",
    kind: "momo",
    want: "FAILED",
    body: { channel: "MTN_MOMO", amount_rwf: 100, ...customer, customer_phone: DECLINE_PHONE, description: "Lab declined" },
  },
  {
    id: "mtn-no-funds",
    title: "Not enough money on the wallet",
    what: "Must end as Failed",
    channel: "MTN_MOMO",
    kind: "momo",
    want: "FAILED",
    body: { channel: "MTN_MOMO", amount_rwf: 100, ...customer, customer_phone: NO_FUNDS_PHONE, description: "Lab no funds" },
  },
];

const BLOCKED: Scenario[] = [
  {
    id: "airtel-on-mtn",
    title: "Airtel number sent as MTN",
    what: "Wrong network - refused before anyone is asked to pay",
    channel: "MTN_MOMO",
    kind: "block",
    body: { channel: "MTN_MOMO", amount_rwf: 100, ...customer, customer_phone: TEST_AIRTEL },
  },
  {
    id: "mtn-on-airtel",
    title: "MTN number sent as Airtel",
    what: "Wrong network - refused before anyone is asked to pay",
    channel: "AIRTEL_MONEY",
    kind: "block",
    body: { channel: "AIRTEL_MONEY", amount_rwf: 100, ...customer, customer_phone: TEST_PHONE },
  },
  {
    id: "no-phone",
    title: "MoMo without a phone number",
    what: "Phone number is required",
    channel: "MTN_MOMO",
    kind: "block",
    body: { channel: "MTN_MOMO", amount_rwf: 100, ...customer },
  },
  {
    id: "too-small",
    title: "Less than 100 RWF",
    what: "Minimum amount",
    channel: "VISA",
    kind: "block",
    body: { channel: "VISA", amount_rwf: 50, ...customer },
  },
  {
    id: "bad-email",
    title: "Broken email address",
    what: "Email must be valid",
    channel: "MASTERCARD",
    kind: "block",
    body: { channel: "MASTERCARD", amount_rwf: 100, customer_name: "Test Customer", customer_email: "not-an-email" },
  },
];

const ALL = [...GO_THROUGH, ...FAIL_PROPERLY, ...BLOCKED];

interface Step {
  text: string;
  ok: boolean | null; // null = still going
}

interface RunResult {
  passed: boolean;
  steps: Step[];
  calls: { label: string; call: RawCall }[];
  reference?: string;
  at: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorText(call: RawCall): string {
  const d = call.body?.detail;
  if (Array.isArray(d)) return d.map((x) => String(x?.msg ?? "").replace(/^Value error, /, "")).join(" ");
  if (typeof d === "string") return d;
  return call.body?.error ?? `HTTP ${call.httpStatus ?? "no response"}`;
}

const finalWord = (s: string) => (s === "SUCCESS" ? "Paid" : s === "FAILED" ? "Failed" : s === "CANCELLED" ? "Cancelled" : s);

/** Runs one test from start to finish, reporting each step as it happens. */
async function runScenario(scope: PaymentScope, s: Scenario, report: (r: Omit<RunResult, "at">) => void): Promise<Omit<RunResult, "at">> {
  const steps: Step[] = [];
  const calls: RunResult["calls"] = [];
  const ctx: { reference?: string } = {};
  const push = (text: string, ok: boolean | null) => {
    steps.push({ text, ok });
    report({ passed: false, steps: [...steps], calls: [...calls], reference: ctx.reference });
  };
  const done = (passed: boolean) => ({ passed, steps: [...steps], calls: [...calls], reference: ctx.reference });

  push("Sending the payment to Soila Pay…", null);
  const created = await paymentLab.create(scope, s.body);
  calls.push({ label: "Create payment", call: created });
  steps.pop();

  if (s.kind === "block") {
    const refused = !created.ok && (created.httpStatus === 400 || created.httpStatus === 422);
    push(refused ? `Blocked, as it should be: ${errorText(created)}` : `Not blocked - Soila Pay accepted it (HTTP ${created.httpStatus})`, refused);
    return done(refused);
  }
  if (!created.ok) {
    push(`Soila Pay refused it: ${errorText(created)}`, false);
    return done(false);
  }
  ctx.reference = created.body.reference_id;
  if (created.body.gateway !== "SANDBOX") {
    push("Stopped: this was not simulated", false);
    return done(false);
  }
  push(`Payment created · ${ctx.reference}`, true);

  let row = created.body;
  if (s.kind === "card") {
    if (!row.redirect_url) {
      push("No card page was opened for the customer", false);
      return done(false);
    }
    push("Card page opened - typing the test card…", null);
    const paid = await paymentLab.cardPage(ctx.reference!, s.card!);
    calls.push({ label: "Card page", call: paid });
    steps.pop();
    if (!paid.ok) {
      push(`Card page error: ${errorText(paid)}`, false);
      return done(false);
    }
    push(`Card ${s.card!.slice(-4)} entered on the card page`, true);
    row = paid.body;
  } else {
    push("Waiting for the customer to answer on the phone…", null);
    for (let i = 0; i < 15 && row.status === "PENDING"; i++) {
      await sleep(1500);
      const got = await paymentLab.get(scope, ctx.reference!);
      if (got.ok) row = got.body;
      if (i === 14 || row.status !== "PENDING") calls.push({ label: "Check status", call: got });
    }
    steps.pop();
    if (row.status === "PENDING") {
      push("No answer after 20 seconds - still waiting", false);
      return done(false);
    }
    push("The phone answered", true);
  }

  const passed = row.status === s.want;
  const why = row.status_message ? ` - ${String(row.status_message).replace(/^Sandbox: /, "")}` : "";
  push(`Result: ${finalWord(row.status)}${why}${passed ? "" : ` (expected ${finalWord(s.want!)})`}`, passed);
  return done(passed);
}

function curlFor(body: Record<string, unknown>, apiBase: string, integratorKey?: string) {
  return [
    `curl -X POST ${apiBase.replace(/\/$/, "")}/api/v1/payments \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Integrator-Key: ${integratorKey ?? "YOUR_SANDBOX_KEY"}" \\`,
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
              <Loader2 className="h-3 w-3 animate-spin" /> Testing
            </span>
          ) : result ? (
            <span className={cn("bk-tag", result.passed ? "bk-fill-green" : "bk-fill-red")}>
              {result.passed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {result.passed ? "Works" : "Broken"}
            </span>
          ) : (
            <span className="bk-tag bk-fill-paper">Not tested</span>
          )}
          <button type="button" onClick={onRun} disabled={running} className={cn("bk-btn min-h-9 px-3 text-xs", channelFill(s.channel))}>
            <Play className="h-3.5 w-3.5" /> Test
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={`Show technical details for ${s.title}`}
            title="Technical details (for developers)"
            className="bk-btn bk-fill-paper min-h-9 px-2"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {result && result.steps.length > 0 && (
        <ol className="flex flex-col gap-1 border-t-2 border-[var(--bk-ink)] px-3 py-2 text-xs">
          {result.steps.map((st, i) => (
            <li key={i} className="flex items-start gap-2 font-semibold">
              {st.ok === null ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : st.ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span>{st.text}</span>
            </li>
          ))}
          {result.at && <li className="bk-muted pl-5">{result.at}</li>}
        </ol>
      )}

      {open && (
        <div className="grid gap-3 border-t-2 border-[var(--bk-ink)] p-3 lg:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="bk-display text-xs font-bold uppercase">Same request from your code (cURL)</span>
              <CopyBtn text={curlFor(s.body, apiBase, integratorKey)} />
            </div>
            <pre className="bk-code max-h-64">{curlFor(s.body, apiBase, integratorKey)}</pre>
          </div>
          <div>
            <span className="bk-display mb-1 block text-xs font-bold uppercase">What Soila Pay answered</span>
            <pre className="bk-code max-h-64">
              {result?.calls.length
                ? result.calls.map((c) => `// ${c.label} · HTTP ${c.call.httpStatus ?? "-"} · ${c.call.ms} ms\n${JSON.stringify(c.call.body, null, 2)}`).join("\n\n")
                : "// Press TEST to see the answers"}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}

export function TestLab({
  scope,
  integratorKey,
  kitovuTest = false,
  onRan,
}: {
  scope: PaymentScope;
  /** Shown in the copy-paste cURL (portal: the integrator's sandbox key). */
  integratorKey?: string;
  /** Kept for callers; the lab is always simulated whatever the mode. */
  testMode?: boolean;
  /** Admin: show the Kitovu test panel (Kitovu's TEST gateway is set up). */
  kitovuTest?: boolean;
  onRan?: () => void;
}) {
  const apiBase = useSettingsStore((s) => s.baseUrl) || "http://localhost:8000";
  const [results, setResults] = React.useState<Record<string, RunResult>>({});
  const [running, setRunning] = React.useState<Set<string>>(new Set());
  const [busyAll, setBusyAll] = React.useState(false);
  const [ref, setRef] = React.useState("");
  const [lookup, setLookup] = React.useState<RawCall | null>(null);
  const [looking, setLooking] = React.useState(false);

  const ran = ALL.filter((s) => results[s.id] && !running.has(s.id));
  const passed = ran.filter((s) => results[s.id].passed).length;

  const run = React.useCallback(
    async (s: Scenario) => {
      setRunning((r) => new Set(r).add(s.id));
      const out = await runScenario(scope, s, (partial) => setResults((r) => ({ ...r, [s.id]: { ...partial, at: "" } })));
      setResults((r) => ({ ...r, [s.id]: { ...out, at: `Tested at ${new Date().toLocaleTimeString()}` } }));
      setRunning((r) => {
        const next = new Set(r);
        next.delete(s.id);
        return next;
      });
      if (out.reference) {
        setRef(out.reference);
        onRan?.();
      }
      return out.passed;
    },
    [scope, onRan]
  );

  async function runAll() {
    setBusyAll(true);
    // Everything at once: the phone tests each take a few seconds to answer.
    const outcomes = await Promise.all(ALL.map((s) => run(s)));
    setBusyAll(false);
    const ok = outcomes.filter(Boolean).length;
    toast({
      title: ok === ALL.length ? `All ${ALL.length} tests work` : `${ALL.length - ok} of ${ALL.length} tests are broken`,
      description: ok === ALL.length ? "Payments work from start to finish." : "Open the red ones to see where it stopped.",
      variant: ok === ALL.length ? "success" : "error",
    });
  }

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!ref.trim()) return;
    setLooking(true);
    setLookup(await paymentLab.get(scope, ref.trim()));
    setLooking(false);
  }

  const group = (title: string, list: Scenario[]) => (
    <>
      <h3 className="bk-display mt-6 text-sm font-bold uppercase first:mt-4">{title}</h3>
      <ul className="mt-2 flex flex-col gap-3">
        {list.map((s) => (
          <ScenarioRow
            key={s.id}
            s={s}
            result={results[s.id]}
            running={running.has(s.id)}
            onRun={() => run(s)}
            apiBase={apiBase}
            integratorKey={integratorKey}
          />
        ))}
      </ul>
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="bk-card bk-fill-yellow p-4 text-sm">
        <p className="bk-display text-base font-bold">🧪 What is the Test Lab?</p>
        <p className="mt-1">
          A practice area that checks payments work <b>from start to finish</b>. Each test pretends to be a customer paying - by card, MTN or Airtel -
          using Soila Pay&apos;s simulator. <b>Nobody is charged and no real money moves</b>, even when the account is live.
        </p>
        <p className="mt-2">
          Press <b>Test everything</b> and wait about 20 seconds. <b>Works</b> (green) means that part is fine. <b>Broken</b> (red) shows the step
          where it stopped. Test payments only appear under <b>Test money</b>.
        </p>
      </div>

      {kitovuTest && <KitovuTestPanel onRan={onRan} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <BkPanel
          title="Payment tests"
          tone="bk-fill-blue"
          action={
            <button type="button" onClick={runAll} disabled={busyAll} className="bk-btn bk-fill-ink min-h-9 px-3 text-xs">
              {busyAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Test everything ({ALL.length})
            </button>
          }
        >
          {ran.length > 0 && (
            <p className={cn("bk-box p-2 text-sm font-bold", passed === ran.length ? "bk-fill-green" : "bk-fill-red")}>
              {passed}/{ran.length} work{passed === ran.length ? " ✓" : ` · ${ran.length - passed} broken`}
            </p>
          )}
          {group("✅ Payments that should go through", GO_THROUGH)}
          {group("↩️ Payments that should fail cleanly", FAIL_PROPERLY)}
          {group("🛑 Mistakes Soila Pay must block", BLOCKED)}
        </BkPanel>

        <div className="flex flex-col gap-6">
          <BkPanel title="Test numbers & cards" tone="bk-fill-pink">
            <p className="bk-muted mb-3 text-xs">Use these with a sandbox key (or a Test Mode account) to test from your own code.</p>
            <dl className="flex flex-col gap-3 text-sm">
              {[
                ["MTN - approves", TEST_PHONE],
                ["Airtel - approves", TEST_AIRTEL],
                ["Customer says no", DECLINE_PHONE],
                ["Not enough money", NO_FUNDS_PHONE],
                ["Card - approved", GOOD_CARD],
                ["Card - declined", DECLINE_CARD],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="bk-display text-xs font-bold uppercase">{label}</dt>
                  <dd className="mt-0.5 flex items-center gap-2 font-mono font-bold">
                    {value} <CopyBtn text={value} />
                  </dd>
                </div>
              ))}
              <div>
                <dt className="bk-display text-xs font-bold uppercase">Timing</dt>
                <dd>Phone payments answer after about 5 seconds, like a real customer.</dd>
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
            <p className="bk-muted mt-2 text-xs">Shows the latest status of any payment. The last test fills this in for you.</p>
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

/** Admin: real requests to Kitovu Pay's TEST gateway with your own number -
 * check the name, take a payment, send a payout - and follow each one to the
 * end. Recorded as test money; real customers never use this gateway. */
function KitovuTestPanel({ onRan }: { onRan?: () => void }) {
  const [phone, setPhone] = React.useState("");
  const [amount, setAmount] = React.useState("100");
  const [busy, setBusy] = React.useState<null | "lookup" | "collect" | "payout">(null);
  const [steps, setSteps] = React.useState<Step[]>([]);
  const [last, setLast] = React.useState<RawCall | null>(null);
  const network = /^(\+?250|0)?7[23]/.test(phone.replace(/\s/g, "")) ? "AIRTEL_MONEY" : "MTN_MOMO";
  const amountNum = Number(amount) || 0;
  const ready = phone.replace(/\D/g, "").length >= 9 && amountNum >= 100;

  const say = (list: Step[]) => setSteps([...list]);

  async function follow(list: Step[], ref: string) {
    list.push({ text: "Waiting for Kitovu (approve the prompt on your phone)…", ok: null });
    say(list);
    let row: Record<string, unknown> | null = null;
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const got = await paymentLab.get({ kind: "admin" }, ref);
      setLast(got);
      if (got.ok && got.body.status !== "PENDING") {
        row = got.body;
        break;
      }
    }
    list.pop();
    if (!row) list.push({ text: "Still waiting after 2 minutes - check the reference later in Transactions (Test money)", ok: null });
    else
      list.push({
        text: `Kitovu says: ${finalWord(String(row.status))}${row.status_message ? ` - ${row.status_message}` : ""}`,
        ok: row.status === "SUCCESS",
      });
    say(list);
    onRan?.();
  }

  async function lookup() {
    setBusy("lookup");
    const list: Step[] = [{ text: "Asking Kitovu whose number this is…", ok: null }];
    say(list);
    const r = await paymentLab.kitovuLookup({ channel: network, phone, amount_rwf: amountNum });
    setLast(r);
    list.pop();
    if (!r.ok) list.push({ text: `Kitovu refused: ${errorText(r)}`, ok: false });
    else {
      list.push({ text: r.body.verified ? `Registered name: ${r.body.account_name}` : "Kitovu could not confirm a name for this number", ok: !!r.body.verified });
      list.push({ text: `Fee quote: customer pays ${r.body.total_to_pay_rwf} RWF`, ok: true });
    }
    say(list);
    setBusy(null);
  }

  async function collect() {
    setBusy("collect");
    const list: Step[] = [{ text: "Sending a payment request to Kitovu…", ok: null }];
    say(list);
    const r = await paymentLab.kitovuCollect({
      channel: network,
      amount_rwf: amountNum,
      customer_name: "Kitovu Test",
      customer_email: "test@example.com",
      customer_phone: phone,
      description: "Kitovu test",
    });
    setLast(r);
    list.pop();
    if (!r.ok) {
      list.push({ text: `Not sent: ${errorText(r)}`, ok: false });
      say(list);
    } else {
      list.push({ text: `Sent to Kitovu · ${r.body.reference_id}`, ok: true });
      if (r.body.status === "PENDING") await follow(list, r.body.reference_id);
      else {
        list.push({ text: `Kitovu says: ${finalWord(r.body.status)} - ${r.body.status_message ?? ""}`, ok: r.body.status === "SUCCESS" });
        say(list);
      }
    }
    setBusy(null);
  }

  async function payout() {
    setBusy("payout");
    const list: Step[] = [{ text: "Asking Kitovu to send the money…", ok: null }];
    say(list);
    const r = await paymentLab.kitovuPayout({ amount_rwf: amountNum, recipient_name: "Kitovu Test", recipient_phone: phone, description: "Kitovu test payout" });
    setLast(r);
    list.pop();
    if (!r.ok) {
      list.push({ text: `Not sent: ${errorText(r)}`, ok: false });
      say(list);
    } else {
      list.push({ text: `Payout sent to Kitovu · ${r.body.reference_id}`, ok: true });
      if (r.body.status === "PENDING") await follow(list, r.body.reference_id);
      else {
        list.push({ text: `Kitovu says: ${finalWord(r.body.status)} - ${r.body.status_message ?? ""}`, ok: r.body.status === "SUCCESS" });
        say(list);
      }
    }
    setBusy(null);
  }

  return (
    <BkPanel title="Kitovu test gateway" tone="bk-fill-orange">
      <p className="text-sm">
        Talks to <b>Kitovu Pay&apos;s test system</b> for real - not the simulator. Use <b>your own</b> MTN or Airtel number. It is saved as{" "}
        <b>test money</b>, and real customers never go through it.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-bold uppercase">
          Your phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="078… or 073…" inputMode="tel" className="bk-input w-44 font-mono text-sm normal-case" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold uppercase">
          Amount (RWF)
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="bk-input w-28 font-mono text-sm" />
        </label>
        <span className="bk-tag bk-fill-paper">{network === "AIRTEL_MONEY" ? "Airtel" : "MTN"}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!ready || busy !== null} onClick={lookup} className="bk-btn bk-fill-paper min-h-9 px-3 text-xs">
          {busy === "lookup" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} 1. Check the name
        </button>
        <button type="button" disabled={!ready || busy !== null} onClick={collect} className="bk-btn bk-fill-green min-h-9 px-3 text-xs">
          {busy === "collect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 2. Receive a payment
        </button>
        <button type="button" disabled={!ready || busy !== null} onClick={payout} className="bk-btn bk-fill-blue min-h-9 px-3 text-xs">
          {busy === "payout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} 3. Send a payout
        </button>
      </div>
      {steps.length > 0 && (
        <ol className="bk-box bk-fill-paper mt-3 flex flex-col gap-1 p-3 text-xs">
          {steps.map((st, i) => (
            <li key={i} className="flex items-start gap-2 font-semibold">
              {st.ok === null ? (
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : st.ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span>{st.text}</span>
            </li>
          ))}
        </ol>
      )}
      {last && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-bold">What Kitovu / Soila Pay answered (for developers)</summary>
          <pre className="bk-code mt-1 max-h-64">{`HTTP ${last.httpStatus ?? "-"} · ${last.ms} ms\n${JSON.stringify(last.body, null, 2)}`}</pre>
        </details>
      )}
    </BkPanel>
  );
}
