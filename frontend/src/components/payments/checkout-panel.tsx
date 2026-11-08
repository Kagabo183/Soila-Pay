"use client";

import * as React from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, Lock, RotateCcw, Smartphone, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast-store";
import {
  paymentErrorMessage,
  paymentService,
  type Payment,
  type PaymentChannel,
  type PaymentScope,
} from "@/services/payment.service";
import { MastercardLogo, MtnMomoLogo, OtherCardLogo, VisaLogo, channelFill, channelLabel } from "./payment-logos";
import { BkField, rwf } from "./brutal";

const METHODS: {
  id: PaymentChannel;
  title: string;
  hint: string;
  Logo: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "MTN_MOMO", title: "MTN MoMo", hint: "Approve on the phone with a PIN", Logo: MtnMomoLogo },
  { id: "VISA", title: "Visa", hint: "Debit or credit card", Logo: VisaLogo },
  { id: "MASTERCARD", title: "Mastercard", hint: "Debit or credit card", Logo: MastercardLogo },
  { id: "OTHER_CARD", title: "Other card", hint: "Any other bank card", Logo: OtherCardLogo },
];

const QUICK_AMOUNTS = [1000, 5000, 10000, 20000];
const MIN_AMOUNT = 100;
const POLL_MS = 3000;
const POLL_LIMIT = 60; // ~3 minutes

/** 0788123456 / 788123456 / +250788123456 -> null if fine, else a message. */
export function phoneProblem(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("250")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  if (d.length < 9) return `${9 - d.length} more digit${9 - d.length === 1 ? "" : "s"} needed`;
  if (d.length > 9 || !d.startsWith("7")) return "Use a Rwandan number like 0788 123 456";
  if (!/^7[89]/.test(d)) return "MTN numbers start with 078 or 079";
  return null;
}

type Step = "method" | "details" | "waiting" | "done";

interface CheckoutPanelProps {
  scope: PaymentScope;
  /** Gateway account in test mode - shows the stamp + "Fill test details". */
  testMode?: boolean;
  onChange?: (payment: Payment) => void;
}

export function CheckoutPanel({ scope, testMode = true, onChange }: CheckoutPanelProps) {
  const [step, setStep] = React.useState<Step>("method");
  const [channel, setChannel] = React.useState<PaymentChannel>("MTN_MOMO");
  const [amount, setAmount] = React.useState("");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [payment, setPayment] = React.useState<Payment | null>(null);
  const [checking, setChecking] = React.useState(false);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const isMomo = channel === "MTN_MOMO";
  const amountNum = Math.floor(Number(amount) || 0);
  const errors = {
    amount: amountNum < MIN_AMOUNT ? (amount ? `Minimum is ${rwf(MIN_AMOUNT)}` : "Enter an amount") : null,
    name: name.trim().length < 2 ? "Enter the customer's name" : null,
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) ? null : "Enter a valid email, e.g. name@example.com",
    phone: isMomo ? (phone ? phoneProblem(phone) : "Enter the MTN number") : null,
  };
  const canPay = !Object.values(errors).some(Boolean);
  // Show errors only after the first try (or as the user fixes a field).
  const show = (key: keyof typeof errors, value: string) => (touched || value ? errors[key] : null);

  const update = React.useCallback((p: Payment) => {
    setPayment(p);
    onChangeRef.current?.(p);
    if (p.status !== "PENDING") setStep("done");
  }, []);

  React.useEffect(() => {
    if (step !== "waiting" || !payment) return;
    let tries = 0;
    let stopped = false;
    const id = setInterval(async () => {
      tries += 1;
      if (tries > POLL_LIMIT) return clearInterval(id);
      try {
        const latest = await paymentService.get(scope, payment.referenceId);
        if (!stopped && latest.status !== "PENDING") {
          clearInterval(id);
          update(latest);
        }
      } catch {
        /* transient - next tick */
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [step, payment, scope, update]);

  function chooseMethod(id: PaymentChannel) {
    setChannel(id);
    setTouched(false);
    setStep("details");
  }

  function fillTestDetails() {
    setAmount("1000");
    setName("Test Customer");
    setEmail("customer@example.com");
    setPhone("0780000000");
    setDescription("Test payment");
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canPay) return;
    setSubmitting(true);
    try {
      const p = await paymentService.create(scope, {
        channel,
        amountRwf: amountNum,
        customerName: name.trim(),
        customerEmail: email.trim(),
        customerPhone: isMomo ? phone : undefined,
        description: description.trim() || undefined,
      });
      setPayment(p);
      onChangeRef.current?.(p);
      if (p.status === "PENDING") {
        setStep("waiting");
        if (p.redirectUrl) window.open(p.redirectUrl, "_blank", "noopener");
      } else {
        setStep("done");
      }
    } catch (error) {
      toast({ title: "Payment not started", description: paymentErrorMessage(error), variant: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function checkNow() {
    if (!payment) return;
    setChecking(true);
    try {
      const latest = await paymentService.get(scope, payment.referenceId);
      if (latest.status === "PENDING") {
        toast({ title: "Not confirmed yet", description: "Give it a few more seconds.", variant: "default" });
      }
      update(latest);
    } catch (error) {
      toast({ title: "Could not check", description: paymentErrorMessage(error), variant: "error" });
    } finally {
      setChecking(false);
    }
  }

  function startOver(keepCustomer: boolean) {
    setPayment(null);
    setTouched(false);
    setStep("method");
    if (!keepCustomer) {
      setAmount("");
      setName("");
      setEmail("");
      setPhone("");
      setDescription("");
    }
  }

  const selected = METHODS.find((m) => m.id === channel)!;

  return (
    <section className="bk-card min-w-0">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-[var(--bk-ink)] bk-fill-yellow px-4 py-3">
        <h2 className="bk-display text-lg font-bold uppercase">Take a payment</h2>
        {testMode && <span className="bk-tag bk-fill-paper">🧪 Test mode</span>}
      </header>

      <div className="p-4 sm:p-6">
        <Stepper step={step} />

        {step === "method" && (
          <div className="mt-6">
            <p className="bk-display text-2xl font-bold">How will they pay?</p>
            <p className="bk-muted mt-1 text-sm">Tap one.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {METHODS.map(({ id, title, hint, Logo }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseMethod(id)}
                  className={cn("bk-tile flex items-center gap-3 p-4 text-left", channelFill(id))}
                >
                  <Logo />
                  <span className="min-w-0">
                    <span className="bk-display block text-lg font-bold leading-tight">{title}</span>
                    <span className="block text-xs font-medium opacity-80">{hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="bk-muted mt-5 flex items-start gap-1.5 text-xs">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Card numbers are typed on the bank&apos;s secure page. Soila Pay never sees them.
            </p>
          </div>
        )}

        {step === "details" && (
          <form onSubmit={pay} noValidate className="mt-6 flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setStep("method")} className="bk-btn bk-fill-paper px-3 text-xs">
                <ArrowLeft className="h-4 w-4" /> Back
              </button>
              {testMode && (
                <button type="button" onClick={fillTestDetails} className="bk-btn bk-fill-pink px-3 text-xs">
                  <Sparkles className="h-4 w-4" /> Fill test details
                </button>
              )}
            </div>

            <div className={cn("bk-box flex items-center gap-3 p-3", channelFill(channel))}>
              <selected.Logo />
              <div>
                <p className="bk-display text-base font-bold">{selected.title}</p>
                <p className="text-xs font-medium opacity-80">{selected.hint}</p>
              </div>
            </div>

            <BkField label="Amount" htmlFor="pay-amount" error={show("amount", amount)}>
              <div className="relative">
                <input
                  id="pay-amount"
                  inputMode="numeric"
                  autoFocus
                  value={amount}
                  aria-invalid={!!show("amount", amount)}
                  onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 7))}
                  placeholder="0"
                  className="bk-input bk-display h-16 pr-16 text-3xl font-bold"
                />
                <span className="bk-display pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold">RWF</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                {QUICK_AMOUNTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    className={cn("bk-btn min-h-9 px-3 py-1 text-xs", amountNum === v ? "bk-fill-ink" : "bk-fill-paper")}
                  >
                    {rwf(v)}
                  </button>
                ))}
              </div>
            </BkField>

            <div className="grid gap-5 sm:grid-cols-2">
              <BkField label="Customer name" htmlFor="pay-name" error={show("name", name)}>
                <input id="pay-name" className="bk-input" value={name} aria-invalid={!!show("name", name)} onChange={(e) => setName(e.target.value)} placeholder="Aline Uwase" autoComplete="name" />
              </BkField>
              <BkField label="Email" htmlFor="pay-email" hint="The receipt goes here" error={show("email", email)}>
                <input id="pay-email" type="email" className="bk-input" value={email} aria-invalid={!!show("email", email)} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" />
              </BkField>
            </div>

            {isMomo && (
              <BkField label="MTN phone number" htmlFor="pay-phone" hint="They get a prompt on this phone" error={show("phone", phone)}>
                <div className="flex min-w-0">
                  <span className="bk-box bk-fill-yellow bk-display flex shrink-0 items-center border-r-0 px-3 text-sm font-bold">+250</span>
                  <input
                    id="pay-phone"
                    inputMode="tel"
                    className="bk-input"
                    value={phone}
                    aria-invalid={!!show("phone", phone)}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d+ ]/g, "").slice(0, 16))}
                    placeholder="078 123 4567"
                    autoComplete="tel"
                  />
                </div>
              </BkField>
            )}

            <BkField label="What is it for? (optional)" htmlFor="pay-desc">
              <input id="pay-desc" className="bk-input" value={description} onChange={(e) => setDescription(e.target.value.slice(0, 60))} placeholder="Order #1024" />
            </BkField>

            <button type="submit" disabled={submitting} className="bk-btn bk-fill-green h-14 w-full text-lg">
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" /> Starting...
                </>
              ) : (
                <>Pay {amountNum >= MIN_AMOUNT ? rwf(amountNum) : ""} →</>
              )}
            </button>
          </form>
        )}

        {step === "waiting" && payment && (
          <div className="mt-6 flex flex-col items-center text-center">
            <div className="bk-box bk-fill-yellow flex h-24 w-24 items-center justify-center shadow-[var(--bk-shadow)]">
              {payment.method === "MOMO" ? <Smartphone className="h-11 w-11 animate-pulse" /> : <Lock className="h-11 w-11 animate-pulse" />}
            </div>
            {payment.method === "MOMO" ? (
              <>
                <p className="bk-display mt-6 text-3xl font-bold">Check your phone 📱</p>
                <p className="mt-2 max-w-sm text-sm">
                  We sent a request for <b>{rwf(payment.amountRwf)}</b> to <b>{payment.customerPhone}</b>.
                </p>
                <ol className="bk-box mt-5 w-full max-w-sm divide-y-2 divide-[var(--bk-ink)] text-left text-sm font-medium">
                  <li className="px-3 py-2">1. Open the MTN MoMo prompt</li>
                  <li className="px-3 py-2">2. Enter your MoMo PIN</li>
                  <li className="px-3 py-2">3. This screen updates by itself</li>
                </ol>
                <p className="bk-muted mt-3 text-xs">No prompt? Dial *182*7*1# to see pending approvals.</p>
              </>
            ) : (
              <>
                <p className="bk-display mt-6 text-3xl font-bold">Finish on the card page</p>
                <p className="mt-2 max-w-sm text-sm">The secure card page opened in a new tab. This screen updates when the bank confirms.</p>
                {payment.redirectUrl && (
                  <a href={payment.redirectUrl} target="_blank" rel="noopener noreferrer" className="bk-btn bk-fill-blue mt-5">
                    <ExternalLink className="h-4 w-4" /> Open card page
                  </a>
                )}
              </>
            )}
            <p className="mt-6 flex items-center gap-2 text-sm font-semibold">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for confirmation...
            </p>
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={checkNow} disabled={checking} className="bk-btn bk-fill-paper text-xs">
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Check now
              </button>
              <button type="button" onClick={() => startOver(true)} className="bk-btn bk-fill-paper text-xs">
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "done" && payment && <Receipt payment={payment} onAgain={() => startOver(false)} onRetry={() => startOver(true)} />}
      </div>
    </section>
  );
}

function Stepper({ step }: { step: Step }) {
  const order: Step[] = ["method", "details", "waiting"];
  const current = step === "done" ? 3 : order.indexOf(step);
  const labels = ["Method", "Details", "Pay"];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Progress">
      {labels.map((label, i) => (
        <li
          key={label}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "bk-box bk-display flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-bold uppercase",
            i < current ? "bk-fill-green" : i === current ? "bk-fill-ink" : "bk-fill-paper"
          )}
        >
          {i < current ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}.</span>} {label}
        </li>
      ))}
    </ol>
  );
}

function Receipt({ payment, onAgain, onRetry }: { payment: Payment; onAgain: () => void; onRetry: () => void }) {
  const ok = payment.status === "SUCCESS";
  function copyRef() {
    navigator.clipboard?.writeText(payment.referenceId).then(
      () => toast({ title: "Reference copied", variant: "success" }),
      () => undefined
    );
  }
  return (
    <div className="mt-6 flex flex-col items-center text-center">
      <div className={cn("bk-box flex h-24 w-24 items-center justify-center shadow-[var(--bk-shadow)]", ok ? "bk-fill-green" : "bk-fill-red")}>
        {ok ? <Check className="h-14 w-14" strokeWidth={3} /> : <X className="h-14 w-14" strokeWidth={3} />}
      </div>
      <p className="bk-display mt-5 text-3xl font-bold uppercase">
        {ok ? "Paid!" : payment.status === "CANCELLED" ? "Cancelled" : "Not paid"}
      </p>
      <p className="mt-1 max-w-sm text-sm">
        {ok
          ? payment.isTest
            ? "Test payment. Simulated by the gateway, no real money moved."
            : "The money is on its way to your account."
          : payment.statusMessage || "The payment did not go through. Nothing was charged."}
      </p>

      <dl className="bk-box mt-5 w-full max-w-sm divide-y-2 divide-[var(--bk-ink)] text-left text-sm">
        <Row label="Amount" value={<b className="bk-display text-base">{rwf(payment.amountRwf)}</b>} />
        <Row label="Paid with" value={channelLabel(payment.channel)} />
        <Row label="Customer" value={payment.customerName} />
        {payment.description && payment.description !== "payment" && <Row label="For" value={payment.description} />}
        <Row
          label="Reference"
          value={
            <button type="button" onClick={copyRef} className="inline-flex items-center gap-1 font-mono text-xs underline decoration-2 underline-offset-2">
              {payment.referenceId} <Copy className="h-3 w-3" />
            </button>
          }
        />
        {payment.gatewayTransactionId && <Row label="Transaction" value={<span className="font-mono text-xs">{payment.gatewayTransactionId}</span>} />}
      </dl>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {!ok && (
          <button type="button" onClick={onRetry} className="bk-btn bk-fill-paper">
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        )}
        <button type="button" onClick={onAgain} className="bk-btn bk-fill-green">
          New payment
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="bk-display shrink-0 text-xs font-bold uppercase">{label}</dt>
      <dd className="min-w-0 truncate text-right">{value}</dd>
    </div>
  );
}
